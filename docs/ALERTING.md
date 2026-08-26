# ALERTING.md

## 1. Types d'analyseurs (`AnalyzerRule.type`)

### 1.1 `level-threshold` (générique, activé par défaut sur toute appli)
Déclenche une alerte si un niveau donné apparaît (ou dépasse un compte) dans
une fenêtre glissante.

```json
{
  "type": "level-threshold",
  "params": {
    "level": "ERROR",
    "minCount": 1,
    "window": "5m",
    "severity": "critical"
  }
}
```
Reproduit la règle de base demandée : "s'il y a ERROR, il y a forcément
problème". Évalué en streaming (à chaque `LogEntry` reçue, pas besoin
d'attendre un cron) pour une détection immédiate.

### 1.2 `pattern-rate` (ex. distribcard : taux de délivrance SMS)
Reproduit exactement la logique des scripts fournis.

```json
{
  "type": "pattern-rate",
  "params": {
    "successMatch": { "field": "metadata.smsType", "equals": "card", "outcome": "success" },
    "failureMatch": { "field": "metadata.smsType", "equals": "card", "outcome": "failure" },
    "window": "1d",
    "threshold": 96,
    "operator": "lt",
    "severity": "critical"
  }
}
```
Évalué en job planifié (cron, ex. toutes les 5 à 15 min) : agrégation
OpenSearch (count des `metadata.outcome = success/failure` filtrés sur le
`metadata.smsType` et la fenêtre), calcul du taux, comparaison au seuil.
Cette structure est générique : elle sert aussi bien pour le taux SMS carte,
le taux SMS pin, ou un futur taux HTTP 5xx sur du nginx, sans code
spécifique — seul le champ `metadata` filtré change selon l'appli.

### 1.3 `silence` (watchdog — absence de logs)
```json
{
  "type": "silence",
  "params": {
    "maxSilence": "15m",
    "severity": "critical"
  }
}
```
Job planifié : pour chaque appli ayant une règle `silence` active, vérifier
le timestamp du dernier `LogEntry` reçu (stocké en cache — Redis ou table
`Application.lastLogAt` mise à jour à chaque ingestion). Si dépassement,
déclenche une alerte. **Cette règle doit être créée par défaut à la création
de chaque appli** (via `GlobalConfig.analyzerDefaults`), car c'est le type de
panne le plus facilement invisible (voir remarque de conception initiale).

### 1.4 `service-status` (up/down d'un service systemd, pm2, etc.)
```json
{
  "type": "service-status",
  "params": {
    "monitoredServiceId": "…",
    "expectedState": "active",
    "severity": "critical"
  }
}
```
Créé automatiquement pour chaque `MonitoredService` marqué `critical: true`
(voir `DATA_MODEL.md`). Évalué en streaming, à chaque `ServiceStatusEvent`
reçu : si `newState !== expectedState`, déclenche une alerte immédiate. C'est
la règle qui répond directement au besoin "savoir dès que `httpd.service` ou
`mysqld.service` tombe, sans attendre un signalement".

### 1.5 `service-silence` (absence de vérification reçue)
```json
{
  "type": "service-silence",
  "params": {
    "monitoredServiceId": "…",
    "maxSilence": "2m",
    "severity": "critical"
  }
}
```
Même principe que `silence` (§1.3) mais appliqué à `MonitoredService.lastCheckedAt`
plutôt qu'aux logs : si le backend ne reçoit plus de vérification pour ce
service dans le délai attendu (par défaut un peu plus de deux fois l'intervalle
de check, soit ~1 min pour un `checkInterval` de 30 s), c'est potentiellement
le serveur ou l'agent lui-même qui est indisponible — à traiter en priorité
puisqu'on ne peut alors même plus savoir si le service réel tourne ou non.
Créé automatiquement en même temps que `service-status`, pour chaque service
critique.

### 1.6 Extension future
Nouveau type d'analyseur = nouvelle classe implémentant :
```ts
interface Analyzer {
  readonly type: string;
  evaluate(app: Application, rule: AnalyzerRule): Promise<AnalyzerResult>;
  mode: 'streaming' | 'scheduled';
}
```
Enregistré dans un `AnalyzerRegistry` (même pattern que `ParserRegistry`,
voir `LOG_PARSERS.md`).

## 2. Notificateurs (canaux)

```ts
interface Notifier {
  readonly channel: 'visual' | 'sound' | 'email' | 'sms';
  send(alert: AlertEvent, target: NotificationTarget): Promise<NotificationResult>;
}
```

- `visual` : publie sur le WebSocket (`alert:new`), consommé par le frontend
  (bandeau + changement de couleur)
- `sound` : pas de backend dédié — le frontend joue un son local à la
  réception de `alert:new` si le canal `sound` est activé pour l'appli
  concernée
- `email` : SMTP (Nodemailer), destinataires configurés dans
  `AppConfig.alertChannels.email.recipients`
- `sms` : passerelle SMS existante (celle déjà utilisée par distribcard),
  destinataires dans `AppConfig.alertChannels.sms.recipients`

Chaque canal est indépendant et peut échouer sans bloquer les autres
(exécution en parallèle, `Promise.allSettled`). Le résultat par canal est
stocké dans `AlertEvent.channelsNotified` pour audit (ex: SMS échoué faute de
crédit chez le fournisseur → visible dans l'historique).

## 3. Anti-spam et regroupement

- **Cooldown par règle** : une même `AnalyzerRule` ne redéclenche pas de
  notification avant un délai minimum (par défaut 15 min, configurable), même
  si la condition reste vraie en continu. L'`AlertEvent` existant reste
  "actif" (pas de `resolvedAt`) tant que la condition persiste, mais les
  canaux ne sont ré-sollicités qu'après le cooldown.
- **Résolution automatique** : quand la condition n'est plus vraie à
  l'évaluation suivante, `AlertEvent.resolvedAt` est renseigné, et un message
  "résolu" est diffusé (`alert:resolved`) — utile pour rassurer sans nouvelle
  alerte sonore/SMS.

## 4. Heures creuses (`quietHours`)

Stocké dans `AppConfig.quietHours`. Pendant la plage définie, les canaux
listés dans `mutedChannels` (typiquement `sound`, `sms`) sont désactivés
temporairement ; les canaux non listés (ex : `email`, `visual`) restent
actifs. Le `Notifier` vérifie cette config avant envoi, pas au niveau du
moteur de règles (la détection continue, seule la notification est filtrée).

## 5. Statut agrégé de l'application

Le badge de statut d'une application (dashboard, voir `FRONTEND.md`) combine
deux sources, indépendamment de leur origine :
- les `AlertEvent` actifs issus des analyseurs de logs (`level-threshold`,
  `pattern-rate`, `silence`)
- l'état courant des `MonitoredService` marqués `critical: true`

Règle d'agrégation : l'application est **critique** si au moins une alerte
active de sévérité `critical` existe (log ou service), **warning** s'il n'y a
que des alertes de sévérité `warning`, sinon **ok**. Un service non-critique
(`critical: false`) qui tombe génère bien un `AlertEvent` et une notification
selon les canaux configurés, mais ne fait pas basculer le badge global de
l'application en critique — pratique pour un service annexe dont la panne
mérite d'être su mais ne bloque pas le service rendu.

## 6. Test manuel

`POST /api/rules/:id/test` évalue une règle immédiatement sans persister de
vrai `AlertEvent` ni notifier personne — retourne juste le résultat calculé,
pour valider une config de seuil avant activation.

`POST /api/alerts/test-channel` envoie une vraie notification de test sur un
canal donné, pour vérifier que la configuration technique (SMTP, SMS) est
opérationnelle.
