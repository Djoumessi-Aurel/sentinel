# CONFIG_MANAGEMENT.md

## 1. Principe

`GlobalConfig` et `AppConfig` sont deux entités **indépendantes**. Il n'y a
jamais de lecture "en cascade" (pas de `AppConfig.color ?? GlobalConfig.color`
au moment de l'affichage). Toute valeur affichée pour une appli vient
uniquement de son `AppConfig`, qui a été **initialisé par copie** à un moment
donné. Ce choix explicite du produit doit être respecté à la lettre : modifier
la config globale ne doit avoir strictement aucun effet visible sur les
applis existantes tant que l'utilisateur n'a pas cliqué sur "généraliser".

## 2. Initialisation à la création d'une appli

Dans `ApplicationsService.create()` :
```ts
async create(dto: CreateApplicationDto) {
  const app = await this.repo.create(dto);
  const globalConfig = await this.configService.getGlobal();
  await this.configService.createAppConfig(app.id, {
    displayColors: globalConfig.displayColors,
    alertChannels: globalConfig.alertChannelsDefault,
    quietHours: null,
  });
  await this.rulesService.applyDefaults(app.id, globalConfig.analyzerDefaults);
  return app;
}
```
Toute la logique de copie est centralisée ici : un seul point d'entrée, pas de
duplication de cette initialisation ailleurs dans le code.

## 3. Bouton "Généraliser les configs"

### Parcours utilisateur
1. L'utilisateur modifie la `GlobalConfig` (couleurs, canaux par défaut...) et
   l'enregistre — **aucun effet sur les applis existantes à cet instant**.
2. L'utilisateur clique sur "Généraliser les configs".
3. Une modale liste toutes les applis avec une case à cocher (rien de coché
   par défaut, pour éviter tout écrasement accidentel).
4. Validation → `POST /api/config/generalize { applicationIds }`.

### Comportement backend
```ts
async generalize(applicationIds: string[]) {
  const globalConfig = await this.getGlobal();
  return this.prisma.$transaction(
    applicationIds.map(id =>
      this.prisma.appConfig.update({
        where: { applicationId: id },
        data: {
          displayColors: globalConfig.displayColors,
          alertChannels: globalConfig.alertChannelsDefault,
        },
      })
    )
  );
}
```
- Transaction : soit toutes les applis cochées sont mises à jour, soit
  aucune (pas d'état intermédiaire incohérent).
- **`quietHours` n'est volontairement pas écrasé** par la généralisation
  (c'est un réglage opérationnel fin, propre à chaque appli — à confirmer
  avec l'utilisateur si le comportement souhaité diffère, mais par défaut ce
  document exclut `quietHours` et les `AnalyzerRule` personnalisées de la
  généralisation, qui ne porte que sur l'affichage et les canaux d'alerte par
  défaut).
- Retourne la liste des applis effectivement mises à jour, pour confirmation
  dans l'UI.

## 4. Écran de configuration globale

Deux sections distinctes dans le frontend (voir `FRONTEND.md`) :
- **Affichage** : couleur de fond générale, couleur de texte générale, une
  couleur par niveau de criticité (`DEBUG`, `INFO`, `WARN`, `ERROR`, + niveaux
  additionnels si un futur type d'appli en introduit — la liste des niveaux
  gérés doit rester ouverte, pas une enum fermée à 4 valeurs).
- **Alertes par défaut** : canaux activés par défaut (visuel/son/email/SMS) et
  analyseurs activés par défaut pour toute nouvelle appli (au minimum
  `level-threshold` sur ERROR et `silence`, activés par défaut dès le départ).
- **Vérification de services par défaut** (`serviceCheckDefaults`) :
  intervalle de vérification par défaut fixé à **30 secondes**, et tout
  nouveau `MonitoredService` est **critique par défaut** (`critical: true`) —
  un service qu'on prend la peine d'ajouter est considéré comme important
  tant qu'on ne l'a pas explicitement rétrogradé. Ces deux valeurs sont
  éditables dans cet écran, comme le reste de la config globale.

## 5. Écran de configuration par appli

Même structure que la config globale (couleurs + canaux), plus les sections
propres à l'appli : liste des `AnalyzerRule` (avec formulaire adapté au
`type` choisi), liste des `MonitoredService` (voir `FRONTEND.md`,
`ServiceStatusList`) et `quietHours`. Le formulaire de couleurs par appli
affiche en permanence un indicateur "différent de la config globale actuelle"
ou "aligné" (comparaison simple des deux objets JSON) pour que l'utilisateur
sache en un coup d'œil quelles applis ont dérivé de la config globale — utile
avant de décider quoi cocher au moment de généraliser.

Les `MonitoredService` eux-mêmes (comme les `AnalyzerRule`) ne sont **pas**
concernés par le bouton "généraliser" (§3) : ce sont des éléments propres à
chaque appli (une appli n'a pas les mêmes services qu'une autre), pas des
préférences d'affichage ou de canaux à propager.
