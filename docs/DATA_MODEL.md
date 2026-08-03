# DATA_MODEL.md

ORM recommandé : **Prisma** (migrations déclaratives, types générés
directement consommables par `packages/shared-types`). TypeORM est une
alternative acceptable si préférée par l'outil agentique, mais rester cohérent
dans tout le projet.

## 1. Schéma PostgreSQL (métadonnées / config / alertes)

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
  analyzerDefaults   Json     // liste des analyseurs activés par défaut (ex: generic-error)
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

## 3. Politique de rétention (ILM OpenSearch)

À définir en config globale (Phase 3) : nombre de jours en index "chaud"
(recherche rapide), puis purge ou passage en froid/archive. Valeur par défaut
recommandée pour démarrer : 90 jours, ajustable sans redéploiement (paramètre
stocké en base, appliqué par un job qui met à jour la policy ILM).
