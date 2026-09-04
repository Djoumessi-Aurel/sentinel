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

## 2. Statut des services (up/down)

```
POST /api/ingestion/status
Authorization: Bearer <agent_token>
Body: {
  applicationId: string,
  server: string,
  checks: [{ serviceName: string, state: 'active' | 'inactive' | 'failed' | 'unknown', checkedAt: string }]
}
→ 202 Accepted
```

Envoyé par le script de vérification (voir `AGENT_SETUP.md`), en général
toutes les 30 s. Le backend met à jour `MonitoredService.lastState` /
`lastCheckedAt` pour chaque service listé, et n'écrit un `ServiceStatusEvent`
que si l'état a changé depuis la dernière vérification connue.

```
GET    /api/applications/:appId/services              liste des services surveillés
POST   /api/applications/:appId/services               { name, checkType?, critical? }
                                                         (critical: true par défaut)
PATCH  /api/services/:id                                { name?, checkType?, critical?, checkInterval? }
DELETE /api/services/:id

GET    /api/applications/:appId/services/status         état courant agrégé de l'appli
                                                         + détail par service, pour le dashboard
```

Le script de vérification installé sur le serveur applicatif appelle
`GET /api/applications/:appId/services` périodiquement (toutes les 5 min par
défaut) pour rafraîchir sa liste locale de services à checker, afin qu'un
ajout/retrait de service dans l'interface n'exige pas de réinstallation
manuelle sur le serveur (voir `AGENT_SETUP.md`).

## 3. Applications

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

## 4. Configuration

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

## 5. Règles d'alerte (analyseurs)

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

## 6. Alertes

```
GET    /api/alerts?applicationId=&from=&to=&severity=&status=
GET    /api/alerts/:id
PATCH  /api/alerts/:id/resolve

POST   /api/alerts/test-channel
Body: { applicationId: string, channel: 'email' | 'sms' | 'visual' | 'sound' }
→ envoie une notification de test sur le canal choisi, pour vérifier la
  configuration (SMTP, SMS...) sans attendre un vrai incident
```

## 7. Recherche de logs (historique)

```
GET /api/logs?applicationId=&from=&to=&level=&query=&page=&pageSize=
→ {
  total: number,
  items: [{ timestamp, level, message, metadata }]
}
```

Traduit en requête OpenSearch (`bool` query : filtre `applicationId`, range
`timestamp`, filtre `level`, `match` full-text sur `query` si fourni).

## 8. WebSocket (Socket.IO)

Namespace `/realtime`. Le client s'abonne par appli :

```
Client → Server:  join { applicationId }
Client → Server:  leave { applicationId }
Client → Server:  joinGlobalAlerts          abonnement aux alertes de TOUT le parc
Client → Server:  leaveGlobalAlerts

Server → Client:  log:new     { applicationId, entry: LogEntry }
Server → Client:  alert:new   { applicationId, applicationName, alert: AlertEvent, health }
Server → Client:  alert:resolved { applicationId, alertId, health }
Server → Client:  service:status { applicationId, serviceId, serviceName, previousState, newState, health }
```

**Flux global d'alertes.** Le filtrage par application vaut pour les *logs*,
dont le volume interdit une diffusion non filtrée. Les alertes, elles, sont
rares — quelques dizaines par jour — et doivent parvenir au poste quel que soit
l'écran affiché : sans cela, une alerte n'est signalée que si quelqu'un se
trouve précisément sur la page temps réel de l'application concernée, ce qui
n'arrive presque jamais. Les événements `alert:new` et `alert:resolved` sont
donc émis à la fois dans la room de l'application et dans `alerts:all`. Un
client abonné aux deux ne les reçoit qu'une seule fois.

Le client s'abonne aux applis affichées dans l'écran courant (pas de
diffusion globale non filtrée, pour limiter la charge côté navigateur si
beaucoup d'applis).

## 9. Types partagés

Tous les DTO/interfaces ci-dessus doivent être définis une seule fois dans
`packages/shared-types` et importés à la fois par le backend (validation
`class-validator`/Zod) et le frontend (typage des appels API et des payloads
WebSocket), pour éviter toute divergence de contrat.
