# Guide de déploiement

Ce guide décrit l'installation complète de **Sentinel** — supervision des logs et de l'état des
services du parc monétique — depuis la récupération du code jusqu'à la mise à disposition en HTTPS,
puis l'équipement des serveurs applicatifs à superviser.

Chaque commande est précédée du répertoire depuis lequel elle doit être lancée. Les commandes
préfixées de `sudo` demandent un compte disposant des droits d'administration.

Convention utilisée dans tout le document :

- `sentinel.gie.local` — nom DNS de l'application, à remplacer par le vôtre ;
- `/opt/sentinel` — répertoire d'installation sur le serveur central ;
- `sentinel` — compte système, base de données et utilisateur MySQL de l'application.

Deux machines interviennent, et il ne faut pas les confondre :

- le **serveur central**, qui héberge Sentinel (sections 1 à 9) ;
- les **serveurs applicatifs**, qui hébergent les applications supervisées et sur lesquels on
  installe un agent de collecte (section 10).

---

## 1. Prérequis

### Matériel et système — serveur central

| Élément | Minimum | Recommandé |
|---|---|---|
| Processeur | 4 cœurs | 8 cœurs |
| Mémoire vive | 8 Go | 16 Go si OpenSearch tourne sur la même machine |
| Disque | 100 Go | Dimensionner selon la rétention des logs (section 13) |
| Système | Red Hat Enterprise Linux 8 ou équivalent | — |

Le disque est le point à ne pas sous-estimer : c'est le volume de logs conservés qui commande, pas
la taille de l'application. Dix applications produisant chacune 200 Mo de logs par jour, conservés
90 jours, représentent environ 180 Go avant compression.

### Logiciels sur le serveur central

| Logiciel | Version | Rôle |
|---|---|---|
| Node.js | 22 LTS ou 24 | Exécution du backend et de l'interface |
| MySQL | 8.0 ou 8.4 LTS | Données métier et configuration |
| OpenSearch | 2.x | Stockage des logs (facultatif au démarrage, voir §4) |
| Nginx | 1.20+ | Terminaison HTTPS et relais |

### Logiciels sur chaque serveur applicatif

| Logiciel | Version | Rôle |
|---|---|---|
| Vector | 0.44.0 | Collecte et envoi des logs — **installé automatiquement** par le script d'agent |
| systemd | — | Vérification de l'état des services |

### Accès réseau

| Origine | Destination | Port | Usage |
|---|---|---|---|
| Serveur central | Contrôleur de domaine Active Directory | 389 | Vérification des mots de passe |
| Serveur central | Relais SMTP interne | 25 | Alertes par courriel |
| Serveur central | Passerelle SMS | 80/443 | Alertes par SMS |
| Serveurs applicatifs | Serveur central | 443 | Envoi des logs et de l'état des services |
| Postes utilisateurs | Serveur central | 443 | Interface web |

Le sens du quatrième flux mérite attention : ce sont les **agents qui poussent** vers Sentinel.
Sentinel ne se connecte jamais aux serveurs applicatifs, et n'a donc besoin d'aucun compte sur eux.

### Accès nécessaires

- Un compte SSH avec droits `sudo` sur le serveur central et sur chaque serveur applicatif.
- Le **compte technique Active Directory** (identifiant et mot de passe) utilisé pour les
  recherches d'annuaire. Il ne sert jamais à authentifier les utilisateurs : uniquement à
  retrouver leurs noms lors de l'ajout. Un droit de lecture suffit.
- Les identifiants MySQL, fournis par l'administrateur de base de données.

---

## 2. Récupérer et compiler

La compilation peut se faire sur le serveur central ou sur un poste, le résultat étant identique.

**Répertoire : `/opt`**

```
sudo git clone <url-du-depot> sentinel
sudo chown -R $USER: /opt/sentinel
```

**Répertoire : `/opt/sentinel`**

```
npm ci
npm run build
```

`npm ci` installe l'ensemble du monorepo — backend, interface et paquets partagés — à partir du
fichier de verrouillage. Contrairement à `npm install`, il n'accepte aucune version différente de
celle qui a été testée : c'est ce qu'on veut sur un serveur.

La compilation produit `apps/backend/dist` et `apps/frontend/.next`.

> **Vérification** — `npm run build` doit se terminer sans erreur. En cas d'échec sur les paquets
> partagés, lancer `npm run build --workspace @sentinel/shared-types` seul pour isoler le message.

---

## 3. Base de données

### 3.1 Créer la base et l'utilisateur

**Répertoire : indifférent**

```
sudo mysql -u root -p
```

Puis, dans l'invite MySQL :

```sql
CREATE DATABASE sentinel
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER 'sentinel'@'localhost' IDENTIFIED BY '<mot de passe>';
GRANT ALL PRIVILEGES ON sentinel.* TO 'sentinel'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Le jeu de caractères `utf8mb4` est explicite et non négociable : l'`utf8` historique de MySQL est
limité à trois octets et tronquerait silencieusement les messages de log contenant un caractère sur
quatre octets.

### 3.2 Base d'ombre pour les migrations

Prisma a besoin d'une seconde base, vide, pour valider les migrations avant de les appliquer.

```sql
CREATE DATABASE sentinel_shadow
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON sentinel_shadow.* TO 'sentinel'@'localhost';
FLUSH PRIVILEGES;
```

Elle n'est utilisée qu'au moment des migrations et reste vide entre-temps.

---

## 4. Choisir le stockage des logs

Sentinel sait écrire ses logs dans MySQL ou dans OpenSearch. Le choix se fait par une seule
variable (`LOG_STORE`) et n'a aucune incidence sur le reste de l'application.

| | `mysql` | `opensearch` |
|---|---|---|
| Infrastructure | aucune de plus | une instance OpenSearch |
| Volume supporté | quelques dizaines de Go | le parc complet, sur la durée |
| Recherche plein texte | limitée | native |
| Recommandation | démarrage, pilote | cible |

Démarrer en `mysql` est un choix raisonnable : la bascule ultérieure ne demande qu'un changement de
variable et un redémarrage. Les logs déjà écrits en MySQL n'étant pas migrés automatiquement, la
bascule est d'autant plus simple qu'elle est faite tôt.

> **À savoir** — l'adaptateur OpenSearch est écrit mais n'a jamais été exercé contre une instance
> réelle, faute d'environnement disponible pendant le développement. Sa première mise en service
> doit être validée sur un environnement de test avant la production.

---

## 5. Fichier d'environnement

C'est ici que sont renseignés les mots de passe et les adresses des services. Le fichier n'est
jamais placé dans le dépôt de code — il y est explicitement exclu.

**Répertoire : `/opt/sentinel`**

```
cp .env.example .env
nano .env
```

Le fichier d'exemple est complet et commenté : il suffit de remplacer les valeurs. Protégez-le
ensuite, il contient plusieurs mots de passe :

```
sudo chown root:sentinel /opt/sentinel/.env
sudo chmod 640 /opt/sentinel/.env
```

### Variables reconnues

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `DATABASE_URL` | oui | — | Connexion MySQL |
| `SHADOW_DATABASE_URL` | migrations | — | Base d'ombre Prisma |
| `LOG_STORE` | non | `mysql` | `mysql` ou `opensearch` |
| `OPENSEARCH_URL` | si `opensearch` | — | Adresse de l'instance |
| `OPENSEARCH_INDEX` | non | `sentinel-logs` | Nom de l'index |
| `PORT` | non | `3001` | Port d'écoute du backend |
| `NODE_ENV` | oui | `development` | `production` sur le serveur |
| `CORS_ORIGINS` | oui | — | Origines autorisées, séparées par des virgules. **Jamais `*`** |
| `TRUST_PROXY` | non | vide | Adresses des proxies dont `X-Forwarded-For` est cru (§9.2) |
| `AGENT_TOKEN_SECRET` | oui | — | Sel de hachage des tokens d'agent |
| `LOG_SOURCE_UTC_OFFSET_MINUTES` | non | `0` | Décalage du fuseau dans lequel les applications écrivent leurs logs. **60** pour les serveurs du GIE |
| `AUTH_MODE` | oui | `dev` | `ldap` en production |
| `AUTH_JWT_SECRET` | oui | — | Signature des cookies de session, 32 caractères minimum |
| `AUTH_SESSION_HOURS` | non | `12` | Durée de session d'une personne |
| `AUTH_VIEWER_SESSION_DAYS` | non | `30` | Durée de session de l'écran d'open space |
| `SENTINEL_ADMIN_PASSWORD_HASH` | oui | — | Empreinte du super administrateur (§6) |
| `SENTINEL_USER_PASSWORD_HASH` | non | — | Empreinte du compte d'affichage |
| `LDAP_URL` | si `ldap` | — | Contrôleur de domaine |
| `LDAP_BASE_DN` | si `ldap` | — | Racine de recherche |
| `LDAP_DOMAIN` | si `ldap` | — | Suffixe UPN, préfixe `@` compris |
| `LDAP_USERNAME` | si `ldap` | — | Compte technique de recherche |
| `LDAP_PASSWORD` | si `ldap` | — | Mot de passe du compte technique |
| `LDAP_TIMEOUT_MS` | non | `10000` | Délai d'attente de l'annuaire |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` | non | — | Canal courriel |
| `SMS_GATEWAY_URL` / `SMS_GATEWAY_API_KEY` | non | — | Canal SMS |
| `NEXT_PUBLIC_API_URL` | oui | — | URL publique du backend, lue par le navigateur |
| `NEXT_PUBLIC_WS_URL` | oui | — | Idem pour le WebSocket |

Une variable obligatoire absente empêche le démarrage, avec un message indiquant laquelle. C'est
volontaire : mieux vaut un refus de démarrer qu'une application qui tourne à moitié.

Deux garde-fous méritent d'être connus, parce qu'ils bloquent un démarrage qu'on croyait correct :

- `AUTH_MODE=dev` est **refusé** quand `NODE_ENV=production`. Ce mode ne vérifie pas les mots de
  passe ; l'activer en production ouvrirait l'application à quiconque connaît un identifiant
  déclaré.
- `CORS_ORIGINS` ne peut pas valoir `*` en production.

> **Les variables `NEXT_PUBLIC_*` sont lues à la compilation**, pas au démarrage : elles sont
> incorporées dans le JavaScript envoyé au navigateur. Les modifier impose de relancer
> `npm run build` sur l'interface, un redémarrage ne suffit pas.

---

## 6. Comptes techniques

Deux comptes n'existent pas dans l'Active Directory et sont définis par la configuration :

- `sentineladmin` — super administrateur. Il permet le tout premier accès, et de reprendre la main
  si plus aucun compte nominatif ne peut administrer. **Obligatoire.**
- `sentineluser` — lecteur, destiné au grand écran de l'open space. Sa session dure trente jours,
  pour que l'affichage ne se déconnecte pas tout seul.

**Répertoire : `/opt/sentinel`**

```
npm run auth:hash-password --workspace @sentinel/backend
```

Le mot de passe est demandé sans écho, puis confirmé. Il n'est jamais accepté en argument de ligne
de commande : il se retrouverait dans l'historique du shell et dans la liste des processus, visible
par les autres utilisateurs de la machine.

La commande affiche une ligne à recopier dans `.env` :

```
SENTINEL_ADMIN_PASSWORD_HASH='scrypt$32768$8$1$...'
```

Les apostrophes sont nécessaires : l'empreinte contient des caractères `$`.

Recommencez pour `SENTINEL_USER_PASSWORD_HASH`.

> **C'est une empreinte, pas un chiffré.** Le mot de passe ne peut pas être retrouvé à partir de
> cette valeur — y compris par vous. Notez-le dans le gestionnaire de mots de passe de l'équipe au
> moment où vous le choisissez ; le regénérer plus tard est simple, mais le retrouver est
> impossible.

Ces comptes sont des filets de sécurité, pas des comptes de travail. Utiliser `sentineladmin` au
quotidien reviendrait à partager un mot de passe unique entre plusieurs personnes, ce que la
gestion nominative existe précisément pour éviter.

---

## 7. Active Directory

### 7.1 Renseigner la configuration

Dans `.env` :

```
AUTH_MODE=ldap
LDAP_URL=ldap://dc01.gie.local:389
LDAP_BASE_DN=dc=gie,dc=local
LDAP_DOMAIN=@gie.local
LDAP_USERNAME=<compte technique>
LDAP_PASSWORD=<mot de passe du compte technique>
```

### 7.2 Vérifier avant de démarrer

**Répertoire : `/opt/sentinel`**

```
npm run auth:test-ldap --workspace @sentinel/backend -- kamga --login jdupont
```

Le script contrôle les trois points, dans cet ordre :

1. le serveur répond et le compte technique s'y connecte ;
2. le compte technique peut lire l'annuaire — la recherche affiche les personnes trouvées ;
3. l'identifiant fourni après `--login` peut s'authentifier. Son mot de passe est demandé à la
   saisie, sans écho.

Chaque échec est accompagné de sa cause probable : serveur injoignable, compte technique refusé,
`LDAP_BASE_DN` incorrect, droits de lecture insuffisants. Les codes d'erreur de l'Active Directory
sont traduits en clair — mot de passe expiré, compte verrouillé, connexion interdite à cette heure.

> **À faire avant le premier démarrage.** Ce script n'a besoin ni de la base de données, ni de
> l'application démarrée : c'est le moyen le plus rapide de séparer un problème d'annuaire d'un
> problème applicatif.

---

## 8. Démarrer l'application

Deux options. La première est plus simple si Docker est disponible ; la seconde ne demande rien de
plus que Node.

### Option A — Docker Compose

**Répertoire : `/opt/sentinel/docker`**

```
sudo docker compose --env-file ../.env up -d
sudo docker compose ps
```

La composition démarre MySQL, OpenSearch, le backend et l'interface. MySQL et OpenSearch ne sont
pas publiés sur l'hôte : ils ne sont joignables que par le réseau interne de la composition.

> **Deux points à traiter avant la production** : le fichier désactive le plugin de sécurité
> d'OpenSearch (`plugins.security.disabled=true`), ce qui rend l'index accessible sans
> authentification à quiconque atteint ce réseau ; et cette composition n'a jamais été exécutée,
> le poste de développement ne disposant pas de Docker. Traitez-la comme un point de départ à
> valider, pas comme une recette éprouvée.

### Option B — services systemd

#### 8.1 Compte système et migrations

**Répertoire : `/opt/sentinel`**

```
sudo useradd --system --home /opt/sentinel --shell /sbin/nologin sentinel
npm run db:deploy --workspace @sentinel/backend
```

`db:deploy` applique les migrations en attente. Contrairement à `db:migrate`, il n'en crée aucune
et ne pose aucune question : c'est la commande de production.

#### 8.2 Service du backend

**Répertoire : indifférent**

```
sudo nano /etc/systemd/system/sentinel-backend.service
```

```ini
[Unit]
Description=Sentinel — backend
After=network.target mysqld.service
Wants=mysqld.service

[Service]
Type=simple
User=sentinel
WorkingDirectory=/opt/sentinel/apps/backend
EnvironmentFile=/opt/sentinel/.env
ExecStart=/usr/bin/node dist/main.js
Restart=on-failure
RestartSec=5

# Durcissement : le service n'a besoin d'écrire nulle part sur le disque.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

#### 8.3 Service de l'interface

```
sudo nano /etc/systemd/system/sentinel-frontend.service
```

```ini
[Unit]
Description=Sentinel — interface web
After=network.target sentinel-backend.service
Wants=sentinel-backend.service

[Service]
Type=simple
User=sentinel
WorkingDirectory=/opt/sentinel/apps/frontend
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/node /opt/sentinel/node_modules/next/dist/bin/next start -p 3000
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

#### 8.4 Activer et démarrer

```
sudo systemctl daemon-reload
sudo systemctl enable --now sentinel-backend sentinel-frontend
sudo systemctl status sentinel-backend
```

Le backend annonce au démarrage le mode d'authentification actif. Si vous lisez
`Authentification : MODE DÉVELOPPEMENT`, arrêtez-vous : `AUTH_MODE` n'a pas été basculé sur `ldap`.

---

## 9. Nginx en frontal

### 9.1 Déclarer le site

**Répertoire : indifférent**

```
sudo nano /etc/nginx/conf.d/sentinel.conf
```

```nginx
server {
    listen 80;
    server_name sentinel.gie.local;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name sentinel.gie.local;

    ssl_certificate     /etc/pki/tls/certs/sentinel.crt;
    ssl_certificate_key /etc/pki/tls/private/sentinel.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Interface web.
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API et WebSocket.
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Indispensable au temps réel : sans ces trois lignes, la connexion
        # WebSocket est refusée et les logs cessent de défiler.
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Les agents envoient des lots volumineux.
        client_max_body_size 10m;
        proxy_read_timeout   300s;
    }
}
```

### 9.2 Déclarer le proxy à l'application

Nginx renseigne `X-Forwarded-For`. Pour que Sentinel s'y fie — et compte correctement les
tentatives de connexion — il faut le lui dire explicitement, dans `.env` :

```
TRUST_PROXY=loopback
```

> **Ne mettez jamais un nombre de sauts à la place.** Un nombre fait confiance au pair immédiat
> quel qu'il soit : si le backend reste joignable directement, un client peut alors annoncer
> l'adresse de son choix et échapper à la limitation des tentatives de connexion en changeant
> d'en-tête à chaque essai. L'application refuse d'ailleurs de démarrer si `TRUST_PROXY` contient
> un nombre.
>
> Laissez cette variable **vide** si aucun proxy n'est placé devant le backend.

### 9.3 Ouvrir le pare-feu et démarrer

```
sudo setsebool -P httpd_can_network_connect 1
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
sudo nginx -t
sudo systemctl enable --now nginx
```

Le `setsebool` est nécessaire sur Red Hat : sans lui, SELinux interdit à Nginx d'ouvrir une
connexion sortante, et le relais échoue avec une erreur 502 dont la cause n'apparaît que dans le
journal d'audit.

---

## 10. Équiper les serveurs applicatifs

Chaque application supervisée demande deux choses : être déclarée dans Sentinel, et voir un agent
installé sur son serveur.

### 10.1 Déclarer l'application

Dans l'interface, connecté en administrateur : **Applications → Ajouter une application**.
Renseignez le nom, le type, le serveur et le chemin du fichier de logs.

À la validation, Sentinel affiche un **token d'agent** et la commande d'installation
correspondante. Ce token n'est affiché **qu'une seule fois** : la base n'en conserve que
l'empreinte. Copiez-le avant de fermer le panneau — en cas d'oubli, il suffit d'en émettre un
nouveau depuis la même page, les anciens restant valides tant qu'ils ne sont pas révoqués.

### 10.2 Installer l'agent

Copiez le dossier `agents/` du dépôt sur le serveur applicatif, puis :

**Répertoire : le dossier `agents/` copié**

```
sudo ./install.sh <type> <id-application> https://sentinel.gie.local <token> \
     /chemin/vers/le/fichier.log \
     --services file-manager.service,httpd.service,mysqld.service
```

Exemple réel, pour filemanager :

```
sudo ./install.sh spring-boot 3f2a8c1e-... https://sentinel.gie.local eyJhbGc... \
     /fmanager/logs/manager.log \
     --services file-manager.service,mysqld.service,httpd.service
```

Le script :

1. installe Vector 0.44.0 s'il est absent, **après vérification de l'empreinte SHA-256** du binaire
   téléchargé ;
2. dépose la configuration correspondant au type d'application, en y substituant l'identifiant, le
   token et le chemin des logs ;
3. installe le script de vérification des services et sa minuterie ;
4. enregistre le tout en services systemd, actifs au démarrage.

Types reconnus : `spring-boot`, `java-simple`, `distribcard`, `nodejs-pm2`, `react-nginx`.

### 10.3 Vérifier la remontée

Sur le serveur applicatif :

```
sudo systemctl status vector
sudo journalctl -u vector -n 50
```

Dans l'interface, l'application doit apparaître avec des logs qui défilent dans les secondes qui
suivent. Le badge d'état passe au vert dès la première vérification de services reçue.

> **Si rien ne remonte** : vérifiez d'abord que le serveur applicatif joint bien le serveur central
> sur le port 443 (`curl -sS https://sentinel.gie.local/api/health`). C'est la cause la plus
> fréquente, et la plus rapide à écarter.

---

## 11. Premier accès

Ouvrez `https://sentinel.gie.local` et connectez-vous avec `sentineladmin` et le mot de passe
choisi à la section 6.

Première chose à faire : **vous déclarer comme administrateur nominatif**.

1. **Utilisateurs → Ajouter une personne** ;
2. cherchez-vous dans l'annuaire par nom ou identifiant ;
3. choisissez-vous dans les résultats, avec le rôle `administrateur` ;
4. déconnectez-vous, puis reconnectez-vous avec votre compte Windows.

Déclarez ensuite les autres utilisateurs, en choisissant leur rôle :

| Rôle | Pour qui |
|---|---|
| `lecteur` | L'écran de l'open space, et toute personne qui consulte sans agir |
| `superviseur` | L'exploitation : consulte tout, acquitte les alertes |
| `administrateur` | Ceux qui configurent applications, règles et utilisateurs |

Le compte `sentineluser` n'a pas à être déclaré : il existe par la configuration. Connectez l'écran
de l'open space avec lui — sa session de trente jours évite qu'il se déconnecte tout seul.

---

## 12. Recette après installation

À dérouler dans l'ordre, avant d'annoncer la mise en service.

| # | Vérification | Attendu |
|---|---|---|
| 1 | `curl -sS https://sentinel.gie.local/api/health` | `{"status":"ok","database":true,...}` |
| 2 | Connexion avec un compte Active Directory déclaré | Accès au tableau de bord |
| 3 | Connexion avec un compte AD **non déclaré** | Refus : « Identifiants incorrects ou accès non autorisé » |
| 4 | Connexion en `lecteur` | Aucune colonne « Fichier suivi », aucun bouton d'action |
| 5 | Logs en temps réel sur une application | Les lignes défilent |
| 6 | Recherche dans l'historique sur une plage passée | Résultats cohérents |
| 7 | Arrêter un service non critique sur un serveur applicatif | Alerte en moins d'une minute, badge dégradé |
| 8 | Redémarrer ce service | Retour au vert |
| 9 | **Applications → une application → Configuration → Tester** sur le canal courriel | Message reçu |
| 10 | Idem pour le canal SMS | Message reçu |
| 11 | Six tentatives de connexion avec un mauvais mot de passe | La sixième est refusée en 429 |
| 12 | Redémarrer le serveur central | Tout remonte seul |

Le point 11 mérite d'être fait : c'est la seule façon de vérifier que la limitation des tentatives
est effectivement active derrière le proxy, et donc que `TRUST_PROXY` est correctement réglé.

---

## 13. Exploitation courante

### Consulter les journaux

```
sudo journalctl -u sentinel-backend -f
sudo journalctl -u sentinel-backend --since "1 hour ago" | grep -i error
```

Les erreurs internes sont journalisées avec un **identifiant de corrélation**, également renvoyé à
l'utilisateur. Devant une erreur signalée par quelqu'un, demandez cet identifiant et cherchez-le
dans le journal : il mène directement à la trace complète.

### Mettre à jour

**Répertoire : `/opt/sentinel`**

```
sudo systemctl stop sentinel-frontend sentinel-backend
git pull
npm ci
npm run build
npm run db:deploy --workspace @sentinel/backend
sudo systemctl start sentinel-backend sentinel-frontend
```

Les agents n'ont pas à être mis à jour en même temps : le contrat d'ingestion est stable, un agent
d'une version antérieure continue d'émettre.

### Sauvegarder

```
mysqldump -u sentinel -p --single-transaction --routines sentinel \
  | gzip > /sauvegardes/sentinel-$(date +%F).sql.gz
```

`--single-transaction` évite de verrouiller les tables pendant la sauvegarde : l'ingestion continue
sans interruption.

Sauvegardez également `/opt/sentinel/.env` — il contient des valeurs qu'on ne retrouve pas, en
particulier `AGENT_TOKEN_SECRET`, sans lequel **tous les tokens d'agent existants deviennent
invalides** et tous les agents doivent être réinstallés.

Les logs ne sont pas sauvegardés : ils sont volumineux, reconstituables depuis les serveurs
d'origine, et soumis à une rétention limitée.

### Restaurer

```
gunzip < /sauvegardes/sentinel-2026-09-04.sql.gz | mysql -u sentinel -p sentinel
```

### Rétention

**Configuration → Rétention** fixe les durées de conservation : logs, alertes résolues, événements
de service. La purge s'exécute automatiquement, et peut être déclenchée à la main depuis le même
écran.

Une alerte **active** n'est jamais purgée, quel que soit son âge. Une alerte ouverte depuis
quatre-cents jours signale un problème que personne n'a traité : c'est exactement celle qu'il ne
faut pas faire disparaître.

---

## 14. En cas de problème

| Symptôme | Cause la plus fréquente | Vérification |
|---|---|---|
| Le backend refuse de démarrer | Variable obligatoire absente | Le message indique laquelle : `journalctl -u sentinel-backend -n 30` |
| `AUTH_MODE=dev refusé` au démarrage | `AUTH_MODE` non basculé sur `ldap` | Section 7.1 |
| Toutes les connexions échouent | Annuaire injoignable | `npm run auth:test-ldap` (§7.2) |
| Un compte AD valide est refusé | Utilisateur non déclaré, ou désactivé | Écran **Utilisateurs** |
| L'interface affiche « Backend injoignable » | `NEXT_PUBLIC_API_URL` incorrect | Cette variable est lue **à la compilation** : recompiler, pas redémarrer |
| Les logs ne défilent plus en temps réel | WebSocket non relayé | Les trois lignes `Upgrade` dans Nginx (§9.1) |
| Erreur 502 sur Nginx | SELinux bloque la connexion sortante | `sudo setsebool -P httpd_can_network_connect 1` |
| Un agent n'envoie rien | Pare-feu, ou token révoqué | `curl https://sentinel.gie.local/api/health` depuis le serveur applicatif |
| Un agent reçoit des 429 | Quota d'ingestion atteint | Normal en cas de rafale ; persistant, c'est un fichier de log anormalement bavard |
| Un service reste « inconnu » | Le nom déclaré ne correspond pas | `systemctl list-units --type=service` sur le serveur applicatif |
| Le son ne se déclenche pas sur l'écran mural | Politique de lecture automatique du navigateur | Autoriser le son pour le site dans les paramètres du navigateur |

### Repartir de zéro sur l'authentification

Si plus aucun administrateur ne peut se connecter — départ non anticipé, erreur de manipulation —
le compte `sentineladmin` reste la porte d'entrée. Si son mot de passe a lui aussi été perdu :

```
npm run auth:hash-password --workspace @sentinel/backend
```

Remplacez `SENTINEL_ADMIN_PASSWORD_HASH` dans `.env`, redémarrez le backend, connectez-vous, et
rétablissez les comptes nominatifs. Aucune intervention en base n'est nécessaire.
