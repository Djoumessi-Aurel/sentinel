# API.md

Toutes les routes sont préfixées `/api`. Format JSON.

Toutes les routes passent par `AuthGuard` et exigent une session valide, sauf
celles explicitement marquées `@Public()` — aujourd'hui la sonde de
disponibilité, l'état de l'authentification, la connexion et la déconnexion. Ne
jamais créer de route sans garde.

Les lectures sont ouvertes à tout utilisateur authentifié ; les écritures
demandent le rôle `admin`, à une exception près : **résoudre une alerte** est
également ouvert au `superviseur` (voir `AUTH.md §7`). Les routes d'ingestion
font exception à tout cela : elles s'authentifient par token d'agent, pas par
session.

Certaines réponses dépendent du rôle. `Application.logPath` vaut `null` pour un
`viewer` : la donnée n'est pas envoyée, pas seulement masquée à l'affichage.

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

## 2 bis. Authentification et utilisateurs

Détail du principe et des règles dans `AUTH.md`.

```
GET    /api/auth/status                  public — { mode, directoryReachable }
POST   /api/auth/login                   public — { username, password }
                                         → CurrentUser (session ouverte, cookie déposé)
                                         → { requiresTwoFactor: true, challengeToken } sinon
                                         5 tentatives/minute
POST   /api/auth/logout                  public — efface le cookie
GET    /api/auth/me                      utilisateur connecté
```

Double authentification (`AUTH.md §10`) :

```
POST   /api/auth/2fa/challenge           public — { challengeToken, code } → CurrentUser
                                         accepte un code TOTP ou un code de récupération
                                         5 tentatives/minute, limite propre
GET    /api/auth/2fa/status              { enabled, enforced, recoveryCodesRemaining }
POST   /api/auth/2fa/setup               prépare un appairage → { secret, otpauthUri, qrCode }
POST   /api/auth/2fa/confirm             { code } → { codes } (récupération, affichés une fois)
POST   /api/auth/2fa/recovery-codes      régénère les codes
POST   /api/auth/2fa/disable             refusé si la 2FA est imposée globalement

GET    /api/auth/settings                { twoFactorEnforced }
PATCH  /api/auth/settings                admin — { twoFactorEnforced }
```

Quand la double authentification est **imposée** et qu'un compte ne l'a pas
encore appairée, la session délivrée est **restreinte** : seules les routes
`/api/auth/me`, `/api/auth/logout`, `/api/auth/settings` et `/api/auth/2fa/*`
répondent, tout le reste renvoie `403`.

```
GET    /api/users                        admin — liste des utilisateurs déclarés
GET    /api/users/directory?q=...        admin — recherche dans l'annuaire (2 caractères min)
POST   /api/users                        admin — { username, role } ; username doit exister dans l'annuaire
PATCH  /api/users/:id                    admin — { role?, enabled?, twoFactorEnabled? }
```

`twoFactorEnabled` n'accepte que `false` : un administrateur **réinitialise** la
double authentification de quelqu'un qui a perdu son téléphone, il ne l'active
pas à sa place — l'appairage suppose de scanner un QR code.

**Il n'y a pas de suppression d'utilisateur** : on retire l'accès en passant
`enabled: false`. Voir `AUTH.md §2`.

La session voyage dans un cookie `sentinel_session` **HttpOnly**, jamais dans
un en-tête que le JavaScript de la page pourrait lire. Les appels du frontend
doivent donc passer `credentials: 'include'`, y compris la poignée de main du
WebSocket.

Un échec de connexion renvoie toujours `401` avec le même message, quelle qu'en
soit la cause. Une requête sans session valide renvoie `401`, une requête
authentifiée mais sans le rôle nécessaire renvoie `403`.

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
