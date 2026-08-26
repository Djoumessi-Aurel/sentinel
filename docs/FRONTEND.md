# FRONTEND.md

Next.js 14+ (App Router), TypeScript, Tailwind CSS. Client Socket.IO pour le
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
3. Déclenche le son d'alerte côté client (fichier audio local, pas de
   dépendance externe) si `alert:new` concerne une appli dont
   `AppConfig.alertChannels.sound` est actif — logique **entièrement
   côté client**, le backend ne "sait" pas jouer de son, il notifie juste.

## 4. Dashboard (vue d'ensemble)

Page d'accueil de l'application : grille des applis avec leur `AppStatusBadge`,
triée par sévérité (les applis en alerte critique en premier). Objectif direct
avec le besoin exprimé : un coup d'œil suffit pour voir si un problème est en
cours quelque part, sans attendre un signalement utilisateur.

## 5. Accessibilité couleurs

Le `ColorPicker` doit avertir (pas bloquer) si le contraste texte/fond choisi
est insuffisant (ratio WCAG AA), pour éviter des configurations illisibles —
calcul de contraste simple côté client, affiché comme avertissement discret.
