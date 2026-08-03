# ARCHITECTURE.md

## 1. Composants

```
[Serveurs applicatifs]
   Spring Boot | Java simple | Node.js (PM2) | React (Nginx) | ... (extensible)
        │  (agent Vector local, tail des fichiers de log)
        ▼
[Ingestion HTTP/gRPC] ──► backend NestJS, module `ingestion`
        │
        ▼
[Normalisation] ──► registre de parseurs (packages/log-parsers)
        │
        ├──► [OpenSearch] (stockage des LogEntry, recherche, agrégations)
        │        │
        │        └──► lu par le frontend (recherche historique) et par le
        │             moteur de règles (évaluation périodique/streaming)
        │
        └──► [WebSocket Gateway] ──► push temps réel vers le frontend
                                          │
[Moteur de règles] ──► [AlertEvent] ──► [Notifier(s)] : email, SMS, visuel (WS), son (client)
```

## 2. Agents de collecte

- Un agent **Vector** par serveur applicatif (ou un agent centralisé qui va
  chercher les logs via SSH si l'installation d'un agent local n'est pas
  possible — à éviter en priorité, préférer l'agent local qui *pousse*).
- Chaque agent est configuré avec :
  - le ou les chemins de fichiers à suivre
  - les métadonnées statiques à injecter : `app_id`, `app_type`, `server_name`
  - l'endpoint HTTP du backend (`POST /ingestion/logs`) ou un sink Kafka/NATS
    si le volume justifie plus tard l'ajout d'une file de messages (non
    nécessaire en Phase 1/2 : appel HTTP direct suffisant)
- Templates de config dans `agents/vector-templates/`, un par type d'appli
  (voir `docs/LOG_PARSERS.md` pour la liste des types et les chemins de log
  typiques).
- Authentification agent → backend : token statique par agent (variable
  d'environnement sur le serveur source), vérifié par un guard NestJS dédié
  (indépendant du futur module utilisateur — c'est une authentification
  machine-à-machine, pas une session utilisateur).

## 3. Backend NestJS — modules

| Module | Responsabilité |
|---|---|
| `IngestionModule` | Reçoit les logs bruts des agents, les fait passer par le registre de parseurs, écrit dans OpenSearch, publie sur le bus interne (pour WS + moteur de règles) |
| `ApplicationsModule` | CRUD des applications et serveurs monitorés |
| `ConfigModule` | Config globale + config par appli (voir `CONFIG_MANAGEMENT.md`) |
| `AlertingModule` | Règles, évaluation, `AlertEvent`, orchestration des notificateurs (voir `ALERTING.md`) |
| `LogsQueryModule` | Recherche historique (requêtes OpenSearch) exposée en REST |
| `RealtimeModule` | Gateway WebSocket (Socket.IO), diffusion des logs live et des alertes |
| `AuthModule` (stub en Phase 1-3) | Guard générique qui laisse tout passer, prêt à être remplacé (voir `AUTH.md`) |

Chaque module suit le pattern standard NestJS : `*.module.ts`, `*.controller.ts`,
`*.service.ts`, DTO dans `dto/`, entités dans `entities/` (ou `schema.prisma`
si Prisma).

## 4. Frontend Next.js — vue d'ensemble

Voir `docs/FRONTEND.md` pour le détail des pages. Le frontend consomme :
- l'API REST NestJS pour tout ce qui est CRUD/config/recherche historique
- le WebSocket pour le flux temps réel et les alertes

## 5. Stockage : pourquoi deux bases

- **OpenSearch** : volumétrie potentiellement importante, besoin de
  recherche full-text et d'agrégations rapides par plage de dates/niveau —
  c'est son cas d'usage natif. Index par mois ou par appli selon le volume
  réel observé (à ajuster en Phase 2 selon la volumétrie constatée).
- **PostgreSQL** : données structurées, relationnelles, peu volumineuses
  (applis, configs, règles, historique d'alertes). Transactions nécessaires
  pour les opérations comme "généraliser les configs" (tout ou rien sur les
  applis cochées).

## 6. Flux temps réel

1. L'ingestion écrit dans OpenSearch **et** publie l'événement sur un
   `EventEmitter` interne NestJS (`@nestjs/event-emitter` suffit en Phase 1 —
   pas besoin de Redis pub/sub tant qu'il n'y a qu'une seule instance
   backend ; prévoir Redis adapter pour Socket.IO uniquement si scaling
   horizontal du backend en Phase 3+).
2. La `RealtimeModule` écoute ces événements et les diffuse aux clients
   abonnés à l'appli concernée (room Socket.IO par `app_id`).
3. Le moteur de règles écoute les mêmes événements pour l'évaluation en
   streaming des règles simples (ex : ERROR immédiat), et tourne aussi en job
   planifié (cron, ex. toutes les 5 min) pour les règles à fenêtre glissante
   (ex : taux de succès SMS sur 1 jour).

## 7. Déploiement

Voir `docs/DEPLOYMENT.md`. Résumé : Docker Compose pour l'environnement
central (backend, frontend, Postgres, OpenSearch), agents Vector installés
individuellement sur chaque serveur source via un script d'installation
fourni dans `agents/`.

## 8. Points de vigilance transverses (rappel)

- Détection de silence par appli (absence de logs reçus) → voir `ALERTING.md`
- Masquage des données sensibles avant stockage/affichage (numéros de carte,
  tokens...) → filtre appliqué dans le pipeline de normalisation, configurable
  par type d'appli (liste de regex de masquage dans le parseur ou dans une
  étape dédiée `RedactionModule`)
- Rétention : politique ILM OpenSearch (ex. 90 jours en indices "chauds",
  purge au-delà) — paramétrable globalement, à exposer en config plus tard si
  besoin
- Fuseaux horaires : tous les timestamps sont normalisés en UTC dès
  l'ingestion (le parseur convertit le format source vers UTC ISO 8601) ;
  l'affichage frontend convertit vers le fuseau du navigateur
