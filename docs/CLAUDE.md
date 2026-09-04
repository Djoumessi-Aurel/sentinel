# CLAUDE.md — Instructions projet : plateforme de monitoring de logs

Ce fichier est le point d'entrée pour tout outil agentique travaillant sur ce dépôt.
Lis-le en entier avant de coder. Les autres documents (`docs/*.md`) sont référencés
ci-dessous et doivent être consultés selon la tâche en cours.

## 1. Objectif du projet

Détecter automatiquement les problèmes (erreurs, dégradations de service) sur un
parc d'applications hétérogènes, **avant** qu'un utilisateur ne les signale.
L'application collecte les logs de plusieurs applications déployées sur des
serveurs différents, les centralise, les affiche (temps réel + historique),
et déclenche des alertes configurables (visuelle, sonore, email, SMS) selon
des règles paramétrables par application.

## 2. Documents de référence

| Document | Contenu |
|---|---|
| `docs/ARCHITECTURE.md` | Vue d'ensemble des composants, flux de données, choix techniques |
| `docs/DATA_MODEL.md` | Schéma MySQL, mapping OpenSearch, migrations |
| `docs/API.md` | Contrat API REST + événements WebSocket |
| `docs/LOG_PARSERS.md` | Interface des parseurs de logs, implémentation par type d'appli, guide d'extension |
| `docs/ALERTING.md` | Moteur de règles, notificateurs, anti-spam, détection de silence |
| `docs/CONFIG_MANAGEMENT.md` | Logique config globale / config par appli, bouton « généraliser » |
| `docs/AUTH.md` | Authentification Active Directory, comptes techniques, rôles ; conception de la 2FA restant à faire |
| `docs/AGENT_SETUP.md` | Guide pas-à-pas de création et déploiement des agents (logs + vérification de statut des services) |
| `docs/FRONTEND.md` | Structure de l'application Next.js |
| `docs/DEPLOYMENT.md` | Docker Compose, agents de collecte, variables d'environnement |
| `docs/SECURITY.md` | Conformité OWASP Top 10 : mesures concrètes par catégorie |
| `docs/DECISIONS.md` | Journal des décisions d'architecture prises en cours de construction |

**Règle impérative** : avant d'implémenter une fonctionnalité touchant à la config,
aux alertes, aux parseurs ou à l'auth, relire le document correspondant. Ces
documents font foi ; en cas de conflit apparent avec ce fichier, ils priment sur
le détail d'implémentation (ce fichier reste la source pour les conventions
générales et l'organisation du dépôt).

## 3. Stack technique (imposée)

- **Frontend** : Next.js 16 (App Router), TypeScript, Tailwind CSS — voir `docs/DECISIONS.md` D006
- **Backend** : NestJS, TypeScript
- **Stockage logs** : OpenSearch (ou Elasticsearch, API compatible)
- **Stockage métier/config** : MySQL 8 (via Prisma ou TypeORM — voir `docs/DATA_MODEL.md`)
- **Temps réel** : WebSocket (Socket.IO côté NestJS)
- **Agents de collecte** : Vector (config déclarative TOML/YAML, pas de code applicatif à écrire dans ce dépôt sauf templates de config)
- **Containerisation** : Docker + Docker Compose

Ne pas dévier de cette stack sans validation explicite de l'utilisateur.

## 4. Organisation du dépôt (monorepo)

```
/
├── apps/
│   ├── backend/              # NestJS
│   └── frontend/             # Next.js
├── packages/
│   ├── shared-types/         # Types TS partagés (DTO, enums, contrats WS)
│   └── log-parsers/          # Parseurs de logs (voir LOG_PARSERS.md), consommé par backend
├── agents/
│   └── vector-templates/     # Templates de config Vector par type d'appli
├── docker/
│   ├── docker-compose.yml
│   └── docker-compose.dev.yml
├── docs/                     # Ce document et les autres .md
└── package.json               # workspace root (pnpm ou npm workspaces)
```

Utiliser un monorepo avec workspaces (pnpm recommandé) pour partager les types
entre `backend` et `frontend` via `packages/shared-types`. Cela évite la
duplication de DTO et garantit la cohérence des contrats API/WebSocket.

## 5. Principes de conception à respecter strictement

1. **Extensibilité par plugin, pas par branchement conditionnel.**
   Tout ce qui varie selon le type d'appli (parsing de logs, découverte de
   fichiers, etc.) doit passer par une interface + un registre, jamais par des
   `if (type === 'spring-boot') ... else if (type === 'nodejs') ...` dispersés
   dans le code métier. Voir `docs/LOG_PARSERS.md`.

2. **Config globale ≠ config appli.** Ce sont deux entités stockées
   séparément. Aucune relation de lecture dynamique (pas de "fallback" vers le
   global à l'affichage). La propagation ne se fait que par copie explicite
   (création d'appli, bouton "généraliser"). Voir `docs/CONFIG_MANAGEMENT.md`.

3. **Aucune route sans garde.** Toutes les routes passent par `AuthGuard`, et
   les écritures par `RolesGuard`. Une route publique doit être marquée
   explicitement `@Public()` — l'oubli d'un garde ne doit jamais pouvoir passer
   pour un choix. Voir `docs/AUTH.md`.

4. **Tout ce qui peut échouer silencieusement doit avoir un mécanisme de
   détection.** En particulier : un agent qui cesse d'envoyer des logs, ou un
   service dont le statut n'est plus vérifié, doit déclencher une alerte de
   silence (voir `docs/ALERTING.md`, règles `silence` et `service-silence`),
   pas juste arrêter de remonter de l'information sans bruit.

5. **Pas de secret en dur.** Toute donnée sensible (identifiants SMTP, clé API
   SMS, credentials OpenSearch/MySQL) passe par variables d'environnement,
   jamais commitée.

6. **Conformité OWASP Top 10.** L'application supervise une production
   monétique : ses logs peuvent contenir des données de porteurs. Toute
   fonctionnalité doit être conçue et relue au regard de `docs/SECURITY.md`,
   qui traduit chaque catégorie du OWASP Top 10 en mesures concrètes. En
   particulier : validation systématique des entrées, aucune route sans garde,
   limites de ressources sur l'ingestion, masquage des données sensibles avant
   persistance, et aucune divulgation de détail interne dans les réponses
   d'erreur.

## 6. Conventions de code

- TypeScript strict (`strict: true` dans tous les `tsconfig.json`)
- Backend NestJS : architecture modulaire standard (module / controller /
  service / repository), DTO validés avec `class-validator`
- Nommage : `camelCase` en TS, `snake_case` pour les colonnes SQL, noms
  d'entités au singulier (`Application`, `LogEntry`, `AlertRule`)
- Tests : Jest pour le backend (unitaire sur les services, en particulier le
  moteur de règles et les parseurs), Playwright ou Testing Library pour le
  frontend sur les parcours critiques (config, généralisation, affichage temps
  réel)
- Commits atomiques par fonctionnalité, messages en français ou anglais au
  choix mais cohérents dans tout le dépôt

## 7. Ordre de développement recommandé (roadmap)

**Phase 1 — MVP** — livrée
1. Squelette monorepo + Docker Compose (MySQL, OpenSearch, backend, frontend)
2. Modèle de données `Application`, `Server`, `GlobalConfig`, `AppConfig`
3. Un agent Vector de test envoyant des logs vers un endpoint d'ingestion HTTP du backend
4. Parseur générique (niveau + message) + parseur Spring Boot
5. Stockage des `LogEntry` dans OpenSearch
6. Vue frontend : liste des applis, viewer de logs temps réel (WebSocket), couleurs par niveau
7. Règle générique "ERROR → alerte" + alerte visuelle uniquement
8. `MonitoredService` + script de vérification de statut (systemd), règles
   `service-status`/`service-silence`, badge de statut agrégé par appli

**Phase 2** — livrée
1. Parseurs Java simple, Node/PM2, React/Nginx
2. Analyseurs personnalisés (règles à seuil, comme l'exemple distribcard)
3. Recherche historique par plage de dates
4. Canal email + canal SMS
5. Écran de configuration globale + config par appli
6. Bouton "généraliser les configs"

**Phase 3** — livrée
1. Détection de silence (watchdog par appli)
2. Anti-spam / cooldown / regroupement d'alertes
3. Heures creuses (mise en pause de canaux selon horaire)
4. Masquage de données sensibles, appliqué **avant persistance** et non
   seulement à l'affichage : une donnée écrite en clair le reste dans les
   sauvegardes (voir `SECURITY.md` A09)
5. Politique de rétention / purge automatique (voir `DATA_MODEL.md §4`)
6. Bouton de test d'alerte (déclenchement manuel par canal)

**Phase 4** — livrée, sauf la 2FA
1. Authentification Active Directory : aucun mot de passe d'utilisateur n'est
   stocké, et l'accès demande à la fois un compte AD valide et d'avoir été
   déclaré utilisateur par un administrateur (voir `docs/AUTH.md`)
2. Deux comptes techniques hors annuaire : `sentineluser` (écran d'open space)
   et `sentineladmin` (super administrateur)
3. Trois rôles — `viewer`, `superviseur`, `admin` — aux droits déclarés en un
   seul endroit (`ROLE_PERMISSIONS`). Le superviseur résout les alertes et voit
   les chemins des fichiers de logs, que le lecteur ne reçoit pas
4. 2FA TOTP — **reste à faire**, conception dans `docs/AUTH.md §10`

La préparation faite dès la Phase 1 a tenu sa promesse : seul le contenu
d'`AuthGuard` a changé, aucune route existante n'a eu à être reprise.

## 8. Ce qu'il ne faut jamais faire

- Ne pas coder de logique spécifique à une appli dans le moteur de règles
  générique : toute variation passe par la config de l'appli (`AnalyzerRule`)
- Ne pas faire dépendre l'affichage des couleurs d'un calcul dynamique
  complexe : c'est une simple lecture de `AppConfig` (ou `GlobalConfig` si pas
  encore initialisée), stockée telle quelle
- Ne pas stocker les logs bruts uniquement en base relationnelle (volume
  incompatible avec MySQL à moyen terme) : MySQL = métadonnées/config,
  OpenSearch = logs
- Ne pas bloquer l'ingestion sur l'évaluation des règles : l'ingestion écrit
  d'abord, l'évaluation des règles est asynchrone (job séparé ou consumer)
