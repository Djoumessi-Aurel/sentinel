# FRONTEND.md

Next.js 16 (App Router), TypeScript, Tailwind CSS. Client Socket.IO pour le
temps réel.

## 1. Arborescence

```
apps/frontend/
├── app/
│   ├── (protected)/                 # layout unique, point d'ancrage futur pour l'auth (voir AUTH.md)
│   │   ├── layout.tsx
│   │   ├── dashboard/                # vue d'ensemble : statut de toutes les applis
│   │   │   └── page.tsx
│   │   ├── applications/
│   │   │   ├── page.tsx              # liste + création/suppression
│   │   │   └── [id]/
│   │   │       ├── live/page.tsx     # logs temps réel
│   │   │       ├── history/page.tsx  # recherche historique par plage de dates
│   │   │       ├── config/page.tsx   # config affichage + alertes pour cette appli
│   │   │       ├── rules/page.tsx    # gestion des AnalyzerRule
│   │   │       └── services/page.tsx # gestion des MonitoredService (up/down)
│   │   ├── config/
│   │   │   ├── global/page.tsx       # config globale (couleurs, canaux/analyseurs par défaut)
│   │   │   └── generalize/page.tsx   # écran du bouton "généraliser" (sélection des applis)
│   │   └── alerts/
│   │       └── page.tsx              # historique des AlertEvent, filtrable
│   └── layout.tsx                    # layout racine
├── components/
│   ├── log-viewer/                   # composant virtualisé (react-window) pour l'affichage des logs
│   ├── color-picker/
│   └── app-status-badge/
├── lib/
│   ├── api-client.ts                 # wrapper fetch typé (types depuis packages/shared-types)
│   └── socket-client.ts              # wrapper Socket.IO
└── styles/
```

## 2. Composants clés

- **`LogViewer`** : liste virtualisée (obligatoire dès qu'un flux temps réel
  est affiché — ne pas rendre toutes les lignes dans le DOM sans
  virtualisation, sous peine de dégradation rapide des performances). Reçoit
  les couleurs par niveau depuis `AppConfig` (ou `GlobalConfig` au moment de
  la création, déjà copiée). Un nouveau message reçu par WebSocket est ajouté
  en tête ou en pied de liste (paramétrable), avec la couleur correspondant à
  son `level`.
- **`ColorPicker`** : édite `displayColors` (fond général, texte général, une
  entrée par niveau). Utilisé à la fois dans l'écran config globale et config
  par appli, avec le même composant.
- **`AppStatusBadge`** : reflète l'état d'une appli (`ok` / `warning` /
  `critical` / `silent`) déduit à la fois des `AlertEvent` actifs issus des
  logs et de l'état courant des `MonitoredService` critiques (voir
  `ALERTING.md`, section "Statut agrégé"), utilisé dans le dashboard et la
  liste des applications.
- **`ServiceStatusList`** : liste des services surveillés d'une appli
  (`services/page.tsx`), chacun avec son état courant (pastille colorée),
  formulaire d'ajout (nom, type de vérification, critique ou non), et un
  historique des dernières transitions (`ServiceStatusEvent`).

## 3. Temps réel

`socket-client.ts` expose un hook `useAppLogs(applicationId)` qui :
1. Rejoint la room de l'appli (`join`) au montage, la quitte au démontage.
2. Écoute `log:new` et `alert:new` et met à jour un state local consommé par
   `LogViewer` et `AppStatusBadge`.
3. Le son n'est **pas** déclenché ici mais par `AlertCenter` (voir §3.1) :
   le brancher aussi sur cette page ferait sonner deux fois la même alerte.

### 3.1 `AlertCenter` — son et bandeau, sur toutes les pages

Monté une seule fois dans `app/(protected)/layout.tsx`, il s'abonne au flux
global d'alertes (`joinGlobalAlerts`, voir `API.md §8`) et déclenche la sirène
quelle que soit la page affichée — y compris sur la télévision de l'open space,
qui reste sur le tableau de bord.

**Le son est actif par défaut, sans étape de consentement.** Qui ne souhaite pas
l'entendre coupe l'onglet dans son navigateur — la fonction existe partout et
n'a pas à être réimplémentée ici.

Reste une contrainte qu'aucun code ne peut lever : **la politique de lecture
automatique est appliquée par le navigateur**, pas par l'application. Un
`AudioContext` créé sans interaction préalable reste suspendu, et il n'existe
aucune API permettant de s'en affranchir. On la contourne de la seule manière
possible :

1. tentative de déblocage au montage — elle réussit si le navigateur autorise
   déjà le son pour ce site ;
2. sinon, `armOnFirstGesture` écoute discrètement le **premier geste, quel qu'il
   soit** (clic, touche, contact tactile) et débloque le son à ce moment-là.
   Aucun bouton dédié, aucune question posée : ouvrir un écran et cliquer
   n'importe où suffit ;
3. tant que le son reste bloqué, un indicateur discret le signale. Il n'appelle
   aucune action — c'est un état, pas une demande — mais une surveillance
   sonore qui échouerait en silence serait exactement ce que cette application
   est censée empêcher (`CLAUDE.md §5.4`).

**Pour un écran d'open space**, où personne n'interagit jamais avec la page, le
plus simple est d'autoriser le son au niveau du navigateur, une fois pour
toutes : dans Chrome, `chrome://settings/content/sound` → autoriser le site.
L'étape 1 réussit alors dès l'ouverture, y compris après un redémarrage du
poste ou un rechargement de la page.

Le son lui-même est **synthétisé** par l'API Web Audio (`lib/alert-siren.ts`) :
aucun fichier à héberger, et il reste disponible même si le backend est tombé —
précisément le moment où on en a besoin. Une alerte critique produit un
deux-tons alterné de 8 secondes, en dents de scie, à volume élevé : il doit
faire lever la tête à tout le plateau, pas ressembler à une notification de
téléphone. Un avertissement reste bref et discret. Les caractéristiques
(durée, alternance, timbre, amplitude) sont verrouillées par
`test/alert-siren.test.mts`.


### 3.2 Quelles alertes font sonner la sirène

Seules celles dont le canal `sound` a effectivement notifié. La règle est portée
par `isChannelNotified` (`packages/shared-types`), qui lit le statut consigné par
le backend dans `AlertEvent.channelsNotified` — voir `ALERTING.md §2`.

Conséquences directes :

- une application dont le canal sonore est décoché reste **silencieuse**, tout en
  continuant d'apparaître dans le bandeau des alertes en direct, annotée
  « sans son » pour que l'absence de sirène ne passe pas pour une panne du son ;
- les heures creuses sont respectées sans code supplémentaire côté client ;
- le réglage se fait application par application dans
  `applications/[id]/config` (§5).

## 4. Dashboard (vue d'ensemble)

Page d'accueil de l'application : grille des applis avec leur `AppStatusBadge`,
triée par sévérité (les applis en alerte critique en premier). Objectif direct
avec le besoin exprimé : un coup d'œil suffit pour voir si un problème est en
cours quelque part, sans attendre un signalement utilisateur.

## 5.1 Écran de configuration par application — livré

`applications/[id]/config` regroupe les canaux d'alerte (avec les destinataires
email et SMS, et un bouton de test par canal), les heures creuses, et les
couleurs d'affichage propres à l'application, avec l'indicateur « aligné /
différent de la configuration globale » qui aide à décider quoi cocher avant de
généraliser. Les règles d'analyse et les services surveillés gardent leurs
écrans dédiés.

C'est ici que se règle le canal sonore, donc ce qui fait sonner ou non la sirène
(§3.2).

## 5. Accessibilité couleurs

Le `ColorPicker` doit avertir (pas bloquer) si le contraste texte/fond choisi
est insuffisant (ratio WCAG AA), pour éviter des configurations illisibles —
calcul de contraste simple côté client, affiché comme avertissement discret.
