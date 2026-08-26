# AGENT_SETUP.md

Ce document détaille, étape par étape, comment un agent de collecte de logs
est créé puis déployé. Il complète `DEPLOYMENT.md` (config Docker Compose,
liste des variables d'environnement) et `LOG_PARSERS.md` (format des logs par
type d'appli).

Deux catégories d'étapes bien distinctes :
- **Étapes 1 et 2** : faites **une seule fois**, dans le dépôt du projet (par
  l'outil agentique en construisant le projet).
- **Étapes 3 à 7** : refaites **à chaque nouvelle appli ou nouveau serveur** à
  surveiller.

## Étape 1 — Écrire le template `.toml` (une fois, dans le dépôt)

Rien n'existe par défaut sur les serveurs. Le fichier
`agents/vector-templates/<type>.toml` (un par type d'appli, voir
`LOG_PARSERS.md` pour la liste) est écrit une fois dans le dépôt, avec des
variables à trous (`${AGENT_TOKEN}`, chemin de log, etc.) qui ne seront
remplies que plus tard, sur le serveur cible.

Exemple pour Spring Boot (`agents/vector-templates/spring-boot.toml`) :

```toml
[sources.app_logs]
type = "file"
include = ["${LOG_PATH}"]
read_from = "end"

[transforms.add_metadata]
type = "remap"
inputs = ["app_logs"]
source = '''
.application_id = "${APPLICATION_ID}"
.app_type = "spring-boot"
.server = "${SERVER_NAME}"
'''

[sinks.backend]
type = "http"
inputs = ["add_metadata"]
uri = "${BACKEND_URL}/api/ingestion/logs"
method = "post"
encoding.codec = "json"
batch.max_bytes = 1048576
batch.timeout_secs = 2
request.headers.Authorization = "Bearer ${AGENT_TOKEN}"
```

## Étape 2 — Écrire `install.sh` (une fois, dans le dépôt)

Script bash rangé dans `agents/install.sh`. Il installe Vector, choisit le
bon template, remplace les variables par les vraies valeurs, et démarre le
service. Signature d'appel :

```bash
./install.sh <app_type> <application_id> <backend_url> <agent_token> [log_path]
```

Responsabilités du script (détaillées à l'étape 6 ci-dessous).

## Étape 3 — Déclarer l'application dans l'interface web

Pour chaque appli à surveiller (ex. distribcard) : écran "Applications" →
"Ajouter une application" → nom, type, serveur, chemin de log. Le backend
enregistre l'appli en base **et génère à cet instant un token unique**
(`IngestionAgentToken`), affiché une seule fois à l'écran.

## Étape 4 — Copier les 2 fichiers sur le serveur cible

Le template `.toml` et `install.sh` doivent se retrouver physiquement sur le
serveur où tourne l'appli (pas sur le serveur central) :

```bash
scp agents/install.sh agents/vector-templates/spring-boot.toml \
    user@srv-prod-01:/tmp/
```

## Étape 5 — Exécuter `install.sh` sur ce serveur, avec le token

En SSH sur le serveur cible :

```bash
./install.sh spring-boot distribcard https://monitoring.exemple.com <token>
```

C'est cette commande, exécutée une fois par serveur/appli, qui déclenche
tout le reste automatiquement.

## Étape 6 — Ce que fait `install.sh` concrètement

1. Installe le binaire Vector s'il n'est pas déjà présent sur ce serveur.
2. Prend le template correspondant au type passé en paramètre, remplace
   `${AGENT_TOKEN}`, `${APPLICATION_ID}`, `${BACKEND_URL}`, `${LOG_PATH}` par
   les valeurs fournies.
3. Écrit le résultat dans `/etc/vector/vector.toml`.
4. Enregistre et démarre le service systemd `vector` (démarrage automatique
   au redémarrage du serveur).

## Étape 7 — Le token sert à partir de maintenant, à chaque envoi

Une fois démarré, Vector lit en continu le fichier de log et envoie chaque
lot de lignes vers l'API, avec l'en-tête `Authorization: Bearer <token>`. Le
backend vérifie ce token avant d'accepter les logs — sans token valide, la
requête est rejetée. Le token authentifie l'agent (machine-à-machine), pas
un utilisateur humain.

## À refaire pour chaque nouvelle appli/serveur

Seules les étapes 3 à 8 sont répétées à chaque ajout. Les étapes 1 et 2 ne
sont refaites que si un nouveau **type** d'appli apparaît (voir la section
"Ajouter un nouveau type d'appli" dans `LOG_PARSERS.md`). L'étape 8 (services
à vérifier) n'est nécessaire que si l'application dépend de services
systemd/pm2 dont vous voulez suivre l'état — une appli purement basée sur les
logs peut s'en passer.

## Étape 8 — Le script de vérification des services (statut up/down)

En plus de l'agent Vector (qui suit les fichiers de log), un **second
script**, indépendant, vérifie périodiquement l'état des services dont
dépend l'application (ex. `file-manager.service`, `httpd.service`,
`mysqld.service` pour `filemanager`). Il est installé par le même
`install.sh` (ou un script compagnon `install-status-checker.sh`), sur le
même serveur, et réutilise le même token d'agent.

### Ce que fait ce script

`agents/check-services.sh`, exécuté par un timer systemd toutes les
**30 secondes par défaut** (valeur reprise de
`GlobalConfig.serviceCheckDefaults.checkInterval`, ajustable par service) :

```bash
#!/bin/bash
# Lit la liste des services à vérifier depuis le cache local
SERVICES_FILE="/etc/monitoring-agent/services.conf"
PAYLOAD="[]"

while read -r service; do
  state=$(systemctl is-active "$service" 2>/dev/null || echo "unknown")
  PAYLOAD=$(echo "$PAYLOAD" | jq --arg name "$service" --arg state "$state" \
    '. + [{serviceName: $name, state: $state, checkedAt: now | todate}]')
done < "$SERVICES_FILE"

curl -s -X POST "${BACKEND_URL}/api/ingestion/status" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"applicationId\": \"${APPLICATION_ID}\", \"server\": \"${SERVER_NAME}\", \"checks\": ${PAYLOAD}}"
```

Un second timer, plus espacé (**toutes les 5 minutes par défaut**), exécute
`agents/refresh-services.sh` : il appelle
`GET /api/applications/<id>/services`, avec le même token, et régénère
`/etc/monitoring-agent/services.conf`. C'est ce qui permet d'ajouter ou
retirer un service surveillé depuis l'interface web **sans repasser par le
serveur** — le script s'auto-met-à-jour au prochain rafraîchissement.

### Installation

```bash
./install.sh spring-boot filemanager https://monitoring.exemple.com <token> \
  --services file-manager.service,httpd.service,mysqld.service
```

Le paramètre `--services` sert uniquement d'amorce (premier peuplement du
cache avant le premier rafraîchissement automatique) — la liste de référence
reste toujours celle déclarée dans l'interface web via
`POST /api/applications/:id/services`.

### Deux timers systemd installés

| Timer | Fréquence | Rôle |
|---|---|---|
| `monitoring-status-check.timer` | 30 s (par défaut) | exécute `check-services.sh`, envoie l'état courant |
| `monitoring-status-refresh.timer` | 5 min (par défaut) | exécute `refresh-services.sh`, resynchronise la liste des services à vérifier |

## Point de vigilance : PM2 et permissions

Pour le type `nodejs-pm2`, l'agent doit lire `~/.pm2/logs/*.log`, ce qui
suppose un accès en lecture au dossier de l'utilisateur système sous lequel
PM2 tourne. Si les apps Node tournent sous des utilisateurs différents selon
le serveur, lancer l'agent sous le même utilisateur ou ajuster les
permissions du dossier de logs — à valider serveur par serveur.
