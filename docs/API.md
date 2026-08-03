# API.md

Toutes les routes sont préfixées `/api`. Format JSON. Toutes les routes
passent par le guard d'autorisation (stub en Phase 1-3, voir `AUTH.md`) — ne
jamais créer de route sans `@UseGuards(AuthGuard)` même provisoire.

## 1. Ingestion (machine-à-machine, agents)

```
POST /api/ingestion/logs
Authorization: Bearer <agent_token>
Body: {
  applicationId: string,
  server: string,
  lines: [{ raw: string, receivedAt: string }]
}
→ 202 Accepted
```

L'agent envoie par lot (batch) plutôt que ligne par ligne, pour limiter le
nombre de requêtes. Le backend parse chaque ligne via le registre de parseurs
(`docs/LOG_PARSERS.md`), écrit dans OpenSearch, publie sur le bus interne.

## 2. Applications

```
GET    /api/applications                 liste
POST   /api/applications                 création { name, type, serverId, logPath }
GET    /api/applications/:id
PATCH  /api/applications/:id             { name?, logPath?, status? }
DELETE /api/applications/:id

GET    /api/servers
POST   /api/servers                      { name, host }
```

À la création d'une application (`POST /api/applications`), le backend
initialise automatiquement son `AppConfig` par copie de la `GlobalConfig`
courante (voir `CONFIG_MANAGEMENT.md`).

## 3. Configuration

```
GET    /api/config/global
PATCH  /api/config/global                { displayColors?, alertChannelsDefault?, analyzerDefaults? }

GET    /api/config/applications/:appId
PATCH  /api/config/applications/:appId   { displayColors?, alertChannels?, quietHours? }

POST   /api/config/generalize
Body: { applicationIds: string[] }
→ écrase AppConfig.displayColors / alertChannels / quietHours des applis
  listées avec les valeurs courantes de GlobalConfig, en transaction
  (tout ou rien)
```

## 4. Règles d'alerte (analyseurs)

```
GET    /api/applications/:appId/rules
POST   /api/applications/:appId/rules     { type, name, enabled, params }
PATCH  /api/rules/:id                     { enabled?, params? }
DELETE /api/rules/:id

POST   /api/rules/:id/test                déclenche une évaluation immédiate
                                           à titre de test (ne crée pas de
                                           vrai AlertEvent, retourne le résultat)
```

Voir `docs/ALERTING.md` pour la structure de `params` selon `type`.

## 5. Alertes

```
GET    /api/alerts?applicationId=&from=&to=&severity=&status=
GET    /api/alerts/:id
PATCH  /api/alerts/:id/resolve

POST   /api/alerts/test-channel
Body: { applicationId: string, channel: 'email' | 'sms' | 'visual' | 'sound' }
→ envoie une notification de test sur le canal choisi, pour vérifier la
  configuration (SMTP, SMS...) sans attendre un vrai incident
```

## 6. Recherche de logs (historique)

```
GET /api/logs?applicationId=&from=&to=&level=&query=&page=&pageSize=
→ {
  total: number,
  items: [{ timestamp, level, message, metadata }]
}
```

Traduit en requête OpenSearch (`bool` query : filtre `applicationId`, range
`timestamp`, filtre `level`, `match` full-text sur `query` si fourni).

## 7. WebSocket (Socket.IO)

Namespace `/realtime`. Le client s'abonne par appli :

```
Client → Server:  join { applicationId }
Client → Server:  leave { applicationId }

Server → Client:  log:new     { applicationId, entry: LogEntry }
Server → Client:  alert:new   { applicationId, alert: AlertEvent }
Server → Client:  alert:resolved { applicationId, alertId }
```

Le client s'abonne aux applis affichées dans l'écran courant (pas de
diffusion globale non filtrée, pour limiter la charge côté navigateur si
beaucoup d'applis).

## 8. Types partagés

Tous les DTO/interfaces ci-dessus doivent être définis une seule fois dans
`packages/shared-types` et importés à la fois par le backend (validation
`class-validator`/Zod) et le frontend (typage des appels API et des payloads
WebSocket), pour éviter toute divergence de contrat.
