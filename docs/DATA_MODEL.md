# DATA_MODEL.md

ORM recommandé : **Prisma** (migrations déclaratives, types générés
directement consommables par `packages/shared-types`). TypeORM est une
alternative acceptable si préférée par l'outil agentique, mais rester cohérent
dans tout le projet.

## 1. Schéma MySQL 8 (métadonnées / config / alertes)

Datasource Prisma :
```prisma
datasource db {
  provider = "mysql"
  url      = env("DATABASE_URL") // mysql://user:password@host:3306/monitoring
}
```

Base créée avec le jeu de caractères `utf8mb4` (voir `DEPLOYMENT.md`) — les
types `Json` ci-dessous sont mappés sur des colonnes `JSON` natives, prises
en charge nativement par MySQL 8.

```prisma
model Server {
  id        String   @id @default(uuid())
  name      String
  host      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  applications Application[]
}

model Application {
  id         String   @id @default(uuid())
  name       String
  type       String   // 'spring-boot' | 'java-simple' | 'nodejs-pm2' | 'react-nginx' | ... (extensible, pas d'enum strict en DB)
  serverId   String
  server     Server   @relation(fields: [serverId], references: [id])
  logPath    String   // chemin(s) de log, JSON si plusieurs sources
  status     String   @default("active") // active | paused | archived
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
  // préparation auth (voir AUTH.md) — non exploité avant Phase 4
  createdBy  String?
  updatedBy  String?

  config     AppConfig?
  rules      AnalyzerRule[]
  alerts     AlertEvent[]
}

model GlobalConfig {
  id                String   @id @default("singleton") // ligne unique
  displayColors      Json     // { background, text, levelColors: { INFO, WARN, ERROR, ... } }
  alertChannelsDefault Json   // { visual: true, sound: true, email: false, sms: false }
  analyzerDefaults   Json     // liste des analyseurs activés par défaut (ex: generic-error, silence)
  serviceCheckDefaults Json   // { checkInterval: 30, criticalByDefault: true } — voir CONFIG_MANAGEMENT.md
  updatedAt          DateTime @updatedAt
}

model AppConfig {
  id                 String   @id @default(uuid())
  applicationId      String   @unique
  application        Application @relation(fields: [applicationId], references: [id])
  displayColors      Json     // copie initialisée depuis GlobalConfig, puis modifiable indépendamment
  alertChannels      Json     // { visual, sound, email: { enabled, recipients }, sms: { enabled, recipients } }
  quietHours         Json?    // { enabled, start, end, mutedChannels: ['sound','sms'] }
  updatedAt          DateTime @updatedAt
}

model AnalyzerRule {
  id             String   @id @default(uuid())
  applicationId  String
  application    Application @relation(fields: [applicationId], references: [id])
  type           String   // 'level-threshold' | 'pattern-rate' | 'silence' | ...
  name           String
  enabled        Boolean  @default(true)
  params         Json     // voir ALERTING.md pour le détail par type
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
}

model AlertEvent {
  id             String   @id @default(uuid())
  applicationId  String
  application    Application @relation(fields: [applicationId], references: [id])
  ruleId         String?
  rule           AnalyzerRule? @relation(fields: [ruleId], references: [id])
  severity       String   // 'warning' | 'critical'
  message        String
  triggeredAt    DateTime @default(now())
  resolvedAt     DateTime?
  channelsNotified Json   // { visual: true, email: true, sms: false, ... } + statut d'envoi par canal
}

model MonitoredService {
  id             String   @id @default(uuid())
  applicationId  String
  application    Application @relation(fields: [applicationId], references: [id])
  name           String   // nom de l'unité à vérifier, ex: "httpd.service"
  checkType      String   @default("systemd") // extensible : 'systemd' | 'pm2' | 'tcp-port' | 'http'
  critical       Boolean  @default(true)       // true par défaut : impacte le statut global de l'appli si down
  checkInterval  Int      @default(30)         // secondes ; hérité de la config globale par défaut (voir CONFIG_MANAGEMENT.md)
  lastState      String?  // 'active' | 'inactive' | 'failed' | 'unknown'
  lastCheckedAt  DateTime?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  events         ServiceStatusEvent[]
}

model ServiceStatusEvent {
  id                 String   @id @default(uuid())
  monitoredServiceId String
  monitoredService   MonitoredService @relation(fields: [monitoredServiceId], references: [id])
  previousState      String?
  newState           String
  changedAt          DateTime @default(now())
}

model IngestionAgentToken {
  id         String   @id @default(uuid())
  serverId   String
  token      String   @unique // hashé en base, jamais stocké en clair
  createdAt  DateTime @default(now())
  revokedAt  DateTime?
}
```

Notes :
- `Json` est utilisé volontairement pour les configs afin de rester flexible
  sans multiplier les migrations à chaque ajustement de structure de config.
  Valider la forme de ces JSON via des schémas Zod côté backend (partagés
  avec le frontend via `packages/shared-types`).
- Aucune table `User`/`Role` n'est créée en Phase 1-3, mais les colonnes
  `createdBy`/`updatedBy` sont prévues sur les entités clés pour éviter une
  migration lourde plus tard (voir `AUTH.md`).
- Spécificité MySQL : les colonnes `String` uniques (ex. `AppConfig.applicationId`,
  `IngestionAgentToken.token`, `User.email` en Phase 4) sont générées par
  Prisma en `VARCHAR(191)` avec `utf8mb4` par défaut, pour rester sous la
  limite d'index de MySQL (767 octets max en InnoDB/utf8mb4) — ne pas
  surcharger ces champs avec `@db.VarChar(...)` au-delà sans vérifier
  l'impact sur les index uniques.

## 2. Mapping OpenSearch (logs)

Index nommé par exemple `logs-{application_id}-{yyyy.MM}` (rotation mensuelle),
ou `logs-{yyyy.MM}` unique avec `application_id` en champ filtrable si le
nombre d'applis reste modéré — trancher selon la volumétrie réelle observée en
Phase 1 (commencer par un index unique, séparer si besoin).

```json
{
  "mappings": {
    "properties": {
      "timestamp":      { "type": "date" },
      "applicationId":  { "type": "keyword" },
      "applicationType":{ "type": "keyword" },
      "server":         { "type": "keyword" },
      "level":          { "type": "keyword" },
      "message":        { "type": "text" },
      "raw":            { "type": "text", "index": false },
      "metadata":       { "type": "object", "enabled": true }
    }
  }
}
```

- `raw` (ligne brute non parsée) est stocké mais non indexé en full-text, pour
  garder la possibilité d'audit sans alourdir l'index de recherche.
- `metadata` accueille les champs spécifiques extraits par un parseur (ex :
  `smsType: 'card' | 'pin'`, `outcome: 'success' | 'failure'` pour distribcard).

## 3. Statut des services (up/down)

`MonitoredService` est distinct de `Application` : une application peut
dépendre de plusieurs services (ex. `filemanager` → `file-manager.service`,
`httpd.service`, `mysqld.service`), chacun vérifié et suivi indépendamment.

- `lastState` / `lastCheckedAt` sont mis à jour à **chaque** vérification
  reçue (toutes les 30 s par défaut), pour permettre la détection de silence
  (absence de vérification = agent ou serveur potentiellement down).
- `ServiceStatusEvent` n'enregistre en revanche que les **transitions**
  d'état (ex. `active` → `failed`), pas chaque vérification — le volume
  reste donc faible même avec un intervalle court, contrairement aux logs qui
  vont dans OpenSearch.
- `critical: true` par défaut à la création d'un `MonitoredService` : un
  service tout juste ajouté est considéré comme bloquant pour le statut
  global de l'application tant qu'on ne l'a pas explicitement marqué comme
  secondaire.
- `checkInterval: 30` (secondes) par défaut, copié depuis
  `GlobalConfig.serviceCheckDefaults.checkInterval` à la création — modifiable
  ensuite service par service, même logique de copie explicite que le reste
  de la config (voir `CONFIG_MANAGEMENT.md`).

## 4. Politique de rétention — livrée

`GlobalConfig.retention` porte **trois durées distinctes**, parce que les trois
natures de données n'ont ni le même volume ni la même valeur dans le temps :

| Donnée | Défaut | Pourquoi |
|---|---|---|
| `logsDays` | 90 j | massifs, perdent vite leur intérêt |
| `resolvedAlertsDays` | 365 j | peu volumineux, servent au bilan annuel |
| `serviceEventsDays` | 365 j | rares, racontent la fiabilité d'un service sur la durée |

Appliquée par `RetentionService`, chaque nuit à 3 h — heure creuse choisie
délibérément : une suppression massive sollicite le stockage, et la lancer en
journée ralentirait l'ingestion et les recherches au moment où l'outil sert le
plus. `POST /api/retention/purge` permet de l'appliquer immédiatement, ce qui
évite d'attendre le lendemain pour vérifier qu'un réglage a bien été pris en
compte.

**Les alertes encore actives ne sont jamais purgées**, quel que soit leur âge :
une alerte non résolue décrit un incident en cours.

Côté stockage des logs, la purge passe par le port `LogStore` : `DELETE` Prisma
pour l'adaptateur MySQL, `_delete_by_query` pour OpenSearch. Ce dernier a été
préféré à une politique ILM afin que la rétention reste un réglage modifiable
depuis l'interface, sans reconfiguration du cluster ni redéploiement.
