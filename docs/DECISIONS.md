# DECISIONS.md — Journal des décisions d'architecture

Décisions prises en cours de construction qui s'écartent d'un document de
référence, ou qui tranchent un point que les documents laissaient ouvert.
Chacune est à relire et à valider ou infirmer.

---

## D001 — Développement local sans Docker

**Date** : 2026-09-03
**Statut** : appliqué
**Documents concernés** : `CLAUDE.md §3`, `DEPLOYMENT.md §1 et §4`

### Contexte
`DEPLOYMENT.md` décrit l'environnement central en Docker Compose (MySQL,
OpenSearch, backend, frontend). Or le poste de développement n'a **pas les
droits administrateur** : Docker n'est pas installé et ne peut pas l'être. Les
outils disponibles sont des installations standalone : Node 24, MySQL 8.0.46,
JDK 21.

### Décision
Le développement local se fait **sans Docker**, contre un MySQL standalone
lancé depuis `C:\Users\adjoumessi\tools\mysql-8.0.46-winx64`. Les fichiers
Docker Compose restent dans le dépôt : ils décrivent la cible de déploiement
serveur, pas l'environnement de travail quotidien.

### Conséquences
- Un script `scripts/dev-mysql.*` initialise et démarre l'instance MySQL locale
  dans `.data/mysql` (ignoré par git).
- Toute nouvelle dépendance d'infrastructure doit avoir un mode de lancement
  standalone, sinon elle est refusée ou rendue optionnelle.
- Les instructions d'installation ne doivent jamais exiger d'élévation de
  privilèges.

---

## D002 — Stockage des logs derrière une interface, OpenSearch non requis en développement

**Date** : 2026-09-03
**Statut** : appliqué
**Documents concernés** : `ARCHITECTURE.md §6`, `CLAUDE.md §8`, `DATA_MODEL.md §2`

### Contexte
OpenSearch est le stockage de logs retenu, et `CLAUDE.md §8` interdit de
stocker les logs bruts **uniquement** en base relationnelle, la volumétrie
devenant incompatible avec MySQL à moyen terme. Mais OpenSearch ne peut pas
tourner sur le poste de développement (conséquence de D001), et le rendre
obligatoire bloquerait tout développement local.

### Décision
Le stockage des logs passe par un **port** `LogStore`, avec deux adaptateurs :

| Adaptateur | Usage | Sélection |
|---|---|---|
| `OpenSearchLogStore` | cible de production, recherche et agrégations natives | `LOG_STORE=opensearch` |
| `MysqlLogStore` | développement local et démonstration, volumétrie modeste | `LOG_STORE=mysql` (défaut en dev) |

C'est exactement le principe « extensibilité par plugin, pas par branchement
conditionnel » de `CLAUDE.md §5.1` : aucun `if (store === ...)` dans le code
métier, le moteur de règles et l'API de recherche ne connaissent que
l'interface.

### Conséquences
- L'interface `LogStore` reste volontairement pauvre (écriture par lot,
  recherche paginée, agrégation par comptage sur critères) afin que les deux
  adaptateurs puissent l'honorer honnêtement. Aucune fonctionnalité ne repose
  sur une capacité que seul OpenSearch possède.
- `MysqlLogStore` est explicitement documenté comme **inadapté à la production**
  du parc complet : la table de logs est isolée et purgeable, et son usage est
  journalisé au démarrage du backend par un avertissement visible.
- La bascule vers OpenSearch en production ne demande qu'une variable
  d'environnement et l'exécution du script de création d'index.

### À valider
Confirmer qu'un OpenSearch sera bien disponible sur l'environnement cible du
GIE. Sinon, la volumétrie réelle du parc devra être mesurée pour décider si
`MysqlLogStore` peut tenir avec une politique de rétention courte.

---

## D003 — Fuseau horaire des horodatages de log

**Date** : 2026-09-03
**Statut** : appliqué
**Documents concernés** : `ARCHITECTURE.md §9`

### Contexte
`ARCHITECTURE.md` impose de normaliser tous les horodatages en UTC dès
l'ingestion. Mais les lignes de log des applis du parc portent des horodatages
**naïfs**, sans fuseau (`2026-03-13 10:15:32.123`), et les serveurs du GIE sont
en UTC+1. Les interpréter comme de l'UTC décalerait toute l'application d'une
heure : recherches par plage de dates fausses, fenêtres glissantes des règles
fausses, alertes de silence déclenchées à tort.

### Décision
Le décalage de la source est **explicite** et non deviné : `ParseContext`
porte `sourceUtcOffsetMinutes`, alimenté par la variable d'environnement
`LOG_SOURCE_UTC_OFFSET_MINUTES` (60 pour le parc du GIE, 0 par défaut). Les
horodatages déjà porteurs d'un fuseau (`Z`, `+01:00`, format nginx CLF) sont
respectés tels quels et ignorent ce réglage.

### À valider
Si un jour des serveurs de fuseaux différents sont supervisés, ce réglage
devra passer d'une variable globale à une colonne sur `Server`.

---

## D004 — Le token d'agent est rattaché à l'application, pas seulement au serveur

**Date** : 2026-09-03
**Statut** : appliqué
**Documents concernés** : `DATA_MODEL.md §1`, `AGENT_SETUP.md §3`, `SECURITY.md A01`

### Contexte
`DATA_MODEL.md` décrit `IngestionAgentToken` avec un `serverId`. Mais
`AGENT_SETUP.md §3` précise que le token est généré **au moment où
l'application est déclarée**, et l'installation se fait par couple
application/serveur. Les deux documents ne se recoupent pas.

### Décision
`IngestionAgentToken` porte `applicationId` **et** `serverId`. Le garde
d'ingestion vérifie que l'`applicationId` du corps de la requête correspond
bien à celui du token présenté.

### Conséquences
Un serveur héberge souvent plusieurs applications (filemanager et planning
backoffice, les quatre composants de LTM, les trois de Card Companion). Avec un
token par serveur, l'agent de n'importe laquelle pourrait injecter des logs au
nom des autres : un agent compromis contaminerait tout le serveur. Le
rattachement à l'application limite la portée d'un token à ce qu'il doit
réellement pouvoir écrire (OWASP A01, moindre privilège).

### Note
Le token est stocké en empreinte SHA-256 salée (`AGENT_TOKEN_SECRET`), comparé
en temps constant, et n'est affiché en clair qu'une seule fois.

---

## D005 — Validation par Zod plutôt que class-validator

**Date** : 2026-09-04
**Statut** : appliqué
**Documents concernés** : `CLAUDE.md §6`, `API.md §9`, `DATA_MODEL.md §1`

### Contexte
`CLAUDE.md §6` mentionne « DTO validés avec class-validator ». Mais
`DATA_MODEL.md §1` impose Zod pour valider la forme des colonnes `Json`
(configs), et `API.md §9` autorise explicitement « class-validator/Zod » à
condition que les DTO soient définis une seule fois dans
`packages/shared-types` et partagés avec le frontend.

### Décision
**Zod partout**, aucune dépendance à class-validator.

### Justification
Le point non négociable de `API.md §9` est le partage du contrat entre backend
et frontend. class-validator repose sur des classes décorées, que le frontend ne
peut pas consommer : il faudrait redéclarer chaque DTO en types côté client, ce
qui recrée exactement la divergence que la règle veut empêcher. Un schéma Zod,
lui, est à la fois le validateur du backend et la source du type TypeScript du
frontend — une seule définition, aucune dérive possible.

### Conséquences
- `ZodValidationPipe` (`zodBody`) applique les schémas route par route.
- Pas de `ValidationPipe` global : sans DTO décorés, il ne validerait rien tout
  en donnant l'illusion d'une couche de contrôle supplémentaire.
- Les schémas rejettent les champs inconnus et bornent les tailles, ce que
  `INGESTION_LIMITS` exploite sur les routes d'ingestion (docs/SECURITY.md A03, A04).

---

## D006 — Next.js 16

**Date** : 2026-09-04
**Statut** : appliqué
**Documents concernés** : `CLAUDE.md §3`, `FRONTEND.md`

### Contexte
Les documents demandent « Next.js 14+ ». Next 15.1 embarque en dépendance
interne `postcss@8.4.31`, qui porte quatre vulnérabilités hautes (traversée de
chemin via `sourceMappingURL`, XSS à la sérialisation CSS). La porte d'audit
(`npm run audit:security`) refusait donc la livraison.

### Décision
Next.js **16.3.x**, qui embarque `postcss@8.5.23`, hors de la plage vulnérable.
Cela reste conforme à « 14+ », et rejoint l'intention d'un commit antérieur du
dépôt qui mentionnait déjà « Next.js 16+ ».

### Conséquences
Aucune exception d'audit n'a été nécessaire : la vulnérabilité est corrigée, pas
contournée. React 19 est requis par Next 16, ce qui était déjà le cas.

Effet de bord découvert après coup : Next 16 supprime la commande `next lint`,
seul « lint » que le dépôt possédait. Aucun workspace n'a de configuration
ESLint propre, si bien que le script était devenu un échec pur et simple. Il a
été retiré plutôt que laissé cassé : la vérification statique du dépôt repose
sur TypeScript (`npm run typecheck`, en mode strict sur tous les workspaces).
Ajouter ESLint reste possible, ce serait une décision à part entière.

## D007 — Authentification adossée à l'Active Directory, sans mot de passe stocké

**Date** : 2026-09-04
**Statut** : appliqué
**Documents concernés** : `AUTH.md`, `SECURITY.md`, `API.md`, `CLAUDE.md §7`

### Contexte
`AUTH.md` décrivait un modèle autonome : table `User` avec `passwordHash`,
connexion par e-mail, 2FA TOTP. L'entreprise dispose d'un Active Directory qui
fait déjà autorité sur les comptes et les mots de passe.

### Décision
Sentinel ne gère aucun mot de passe d'utilisateur. Il vérifie d'abord que
l'identifiant est un utilisateur **déclaré et actif**, puis délègue la
vérification du mot de passe à l'annuaire par un `bind` LDAP.

L'ordre des deux étapes n'est pas indifférent. Vérifier l'annuaire d'abord
transformerait toute campagne de devinettes contre Sentinel en tentatives de
connexion sur les comptes du domaine, avec le risque de les verrouiller — un
déni de service sur les comptes de l'entreprise, déclenché depuis une
application de supervision.

Un utilisateur n'est jamais saisi à la main : il est choisi dans l'annuaire,
ce qui garantit que l'identifiant enregistré correspond à un compte existant.

### Conséquences
Un départ traité dans l'AD coupe l'accès sans intervention dans Sentinel. En
contrepartie, l'application dépend de la disponibilité de l'annuaire : les deux
comptes techniques, qui n'en dépendent pas, gardent l'accès quand il tombe.

La 2FA reste à faire ; sa conception est conservée dans `AUTH.md §10`.

## D008 — Un mode de développement qui ne vérifie pas les mots de passe

**Date** : 2026-09-04
**Statut** : appliqué
**Documents concernés** : `AUTH.md §4`

### Contexte
L'Active Directory n'est pas joignable depuis un poste de développement. Sans
solution, aucune fonctionnalité située derrière l'authentification ne serait
développable ni testable hors du réseau de l'entreprise.

### Décision
`AUTH_MODE=dev` remplace l'annuaire par un annuaire fictif de huit personnes.
La recherche et la vérification d'existence fonctionnent ; **le mot de passe
n'est pas vérifié**. La première étape de l'authentification — être un
utilisateur déclaré et actif — reste, elle, pleinement appliquée.

### Conséquences
C'est un mode dangereux, et il est traité comme tel : le schéma de configuration
**refuse `AUTH_MODE=dev` quand `NODE_ENV=production`**, le backend l'annonce en
garde au démarrage, et la page de connexion l'affiche en rouge. Une bascule par
inadvertance ouvrirait l'application à quiconque connaît un identifiant déclaré ;
un simple commentaire dans un fichier de configuration n'aurait pas suffi.

`npm run auth:test-ldap` permet de valider le réglage réel depuis une machine
qui voit le domaine, sans démarrer l'application.

## D009 — Un troisième rôle, des droits déclarés, et pas de suppression d'utilisateur

**Date** : 2026-09-04
**Statut** : appliqué
**Documents concernés** : `AUTH.md §2 et §7`, `SECURITY.md A01`, `API.md`

### Contexte
Deux rôles ne suffisaient pas. L'exploitant qui acquitte les alertes au
quotidien n'a aucune raison d'administrer l'application ; le grand écran de
l'open space, lui, est visible de tout le plateau et de qui passe.

### Décision

**Trois rôles** : `viewer`, `superviseur`, `admin`. Le superviseur ajoute au
lecteur deux droits, et deux seulement : résoudre une alerte, et voir les
chemins des fichiers de logs.

**Les droits sont déclarés, pas déduits.** `ROLE_PERMISSIONS` les énumère rôle
par rôle, dans `packages/shared-types`, et sert à la fois au backend qui
applique et à l'interface qui masque. Une hiérarchie implicite paraissait plus
courte à écrire, mais elle rend inexprimable le premier droit qui ne suit pas
l'ordre attendu. Les gardes de l'interface portent donc sur un droit
(`<SiAutorise droit="resoudreLesAlertes">`) et non sur un rôle nommé : un
quatrième rôle n'obligera pas à repasser sur tous les écrans.

**Les chemins des fichiers de logs ne sont plus envoyés à un `viewer`.**
`Application.logPath` vaut `null` pour lui. Le contrôle d'accès descend au
niveau du champ, parce qu'il a le droit de consulter la réponse mais pas ce
champ-là.

**La suppression d'un utilisateur disparaît.** On retire l'accès en désactivant.

### Conséquences
Le rôle est une chaîne en base : le troisième n'a demandé aucune migration.

L'absence de suppression a un effet de bord sur les tests : le scénario
`scripts/qa-auth.mjs` ne peut plus se nettoyer par l'API et le fait directement
en base, comme n'importe quelle préparation de test. C'est le prix assumé d'une
API qui ne propose pas un geste destructeur au seul bénéfice de sa propre
vérification.

Corrige au passage un défaut trouvé en écrivant ces tests : une erreur Prisma
« enregistrement introuvable » remontait en **500**. Résoudre une alerte
inexistante présentait ainsi une faute de l'appelant comme une défaillance du
serveur, et brouillait la supervision, où un 500 doit rester un signal rare. Le
filtre global traduit désormais ces codes (P2025 → 404, P2002 → 409,
P2003 → 400) en réécrivant les messages, ceux de Prisma nommant tables et
colonnes.
