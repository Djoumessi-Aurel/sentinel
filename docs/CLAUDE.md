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
| `docs/DATA_MODEL.md` | Schéma PostgreSQL, mapping OpenSearch, migrations |
| `docs/API.md` | Contrat API REST + événements WebSocket |
| `docs/LOG_PARSERS.md` | Interface des parseurs de logs, implémentation par type d'appli, guide d'extension |
| `docs/ALERTING.md` | Moteur de règles, notificateurs, anti-spam, détection de silence |
| `docs/CONFIG_MANAGEMENT.md` | Logique config globale / config par appli, bouton « généraliser » |
| `docs/AUTH.md` | Conception du futur module d'authentification (2FA), et comment le code actuel doit s'y préparer |
| `docs/FRONTEND.md` | Structure de l'application Next.js |
| `docs/DEPLOYMENT.md` | Docker Compose, agents de collecte, variables d'environnement |
| `docs/AGENT_SETUP.md` | Détaille, étape par étape, comment un agent de collecte de logs est créé puis déployé |

**Règle impérative** : avant d'implémenter une fonctionnalité touchant à la config,
aux alertes, aux parseurs ou à l'auth, relire le document correspondant. Ces
documents font foi ; en cas de conflit apparent avec ce fichier, ils priment sur
le détail d'implémentation (ce fichier reste la source pour les conventions
générales et l'organisation du dépôt).

## 3. Stack technique (imposée)

- **Frontend** : Next.js 16+ (App Router), TypeScript, Tailwind CSS
- **Backend** : NestJS, TypeScript
- **Stockage logs** : OpenSearch (ou Elasticsearch, API compatible)
- **Stockage métier/config** : PostgreSQL (via Prisma ou TypeORM — voir `docs/DATA_MODEL.md`)
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

3. **Auth-ready dès le premier commit.** Le module d'authentification n'est
   pas codé maintenant, mais toutes les routes API passent par un guard
   d'autorisation (même s'il autorise tout pour l'instant), et le schéma de
   données prévoit les colonnes nécessaires. Voir `docs/AUTH.md`. Ne jamais
   coder une route "en dur" sans guard, même provisoire.

4. **Tout ce qui peut échouer silencieusement doit avoir un mécanisme de
   détection.** En particulier : un agent qui cesse d'envoyer des logs doit
   déclencher une alerte de silence (voir `docs/ALERTING.md`), pas juste
   arrêter de logguer sans bruit.

5. **Pas de secret en dur.** Toute donnée sensible (identifiants SMTP, clé API
   SMS, credentials OpenSearch/Postgres) passe par variables d'environnement,
   jamais commitée.

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

**Phase 1 — MVP**
1. Squelette monorepo + Docker Compose (Postgres, OpenSearch, backend, frontend)
2. Modèle de données `Application`, `Server`, `GlobalConfig`, `AppConfig`
3. Un agent Vector de test envoyant des logs vers un endpoint d'ingestion HTTP du backend
4. Parseur générique (niveau + message) + parseur Spring Boot
5. Stockage des `LogEntry` dans OpenSearch
6. Vue frontend : liste des applis, viewer de logs temps réel (WebSocket), couleurs par niveau
7. Règle générique "ERROR → alerte" + alerte visuelle uniquement

**Phase 2**
1. Parseurs Java simple, Node/PM2, React/Nginx
2. Analyseurs personnalisés (règles à seuil, comme l'exemple distribcard)
3. Recherche historique par plage de dates
4. Canal email + canal SMS
5. Écran de configuration globale + config par appli
6. Bouton "généraliser les configs"

**Phase 3**
1. Détection de silence (watchdog par appli)
2. Anti-spam / cooldown / regroupement d'alertes
3. Heures creuses (mise en pause de canaux selon horaire)
4. Masquage de données sensibles dans les logs affichés
5. Politique de rétention / purge automatique
6. Bouton de test d'alerte (déclenchement manuel par canal)

**Phase 4 (plus tard, hors périmètre immédiat)**
1. Module d'authentification complet + 2FA (voir `docs/AUTH.md` pour la
   préparation à faire dès maintenant)
2. Gestion des rôles/permissions

Ne pas anticiper la Phase 4 en code fonctionnel, mais respecter les points de
préparation listés dans `docs/AUTH.md` dès la Phase 1.

## 8. Ce qu'il ne faut jamais faire

- Ne pas coder de logique spécifique à une appli dans le moteur de règles
  générique : toute variation passe par la config de l'appli (`AnalyzerRule`)
- Ne pas faire dépendre l'affichage des couleurs d'un calcul dynamique
  complexe : c'est une simple lecture de `AppConfig` (ou `GlobalConfig` si pas
  encore initialisée), stockée telle quelle
- Ne pas stocker les logs bruts uniquement en base relationnelle (volume
  incompatible avec Postgres à moyen terme) : Postgres = métadonnées/config,
  OpenSearch = logs
- Ne pas bloquer l'ingestion sur l'évaluation des règles : l'ingestion écrit
  d'abord, l'évaluation des règles est asynchrone (job séparé ou consumer)
