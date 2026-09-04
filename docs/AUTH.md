# AUTH.md

Authentification, utilisateurs et rôles. Livré en Phase 4.

L'application ne gère **aucun mot de passe d'utilisateur** : elle s'appuie sur
l'Active Directory de la maison. Deux comptes techniques font exception, et sont
traités à part.

## 1. Principe

Se connecter à Sentinel demande **deux choses à la fois** :

1. un compte Active Directory valide ;
2. avoir été déclaré utilisateur de Sentinel par un administrateur.

Les deux sont nécessaires. Un compte AD parfaitement valide mais non déclaré
n'entre pas ; un utilisateur déclaré dont le mot de passe AD est refusé n'entre
pas non plus.

L'ordre compte. Sentinel vérifie **d'abord** que l'identifiant saisi est un
utilisateur déclaré et actif, et **ensuite seulement** présente le mot de passe à
l'annuaire. Ainsi, les identifiants de quelqu'un qui n'a rien à faire ici ne sont
jamais transmis à l'AD, et une campagne de devinettes ne se transforme pas en
tentatives de connexion sur les comptes du domaine — avec le risque de les
verrouiller.

### Ce que l'application stocke, et ce qu'elle ne stocke pas

| Donnée | Stockée ? |
|---|---|
| Identifiant (`sAMAccountName`) | oui |
| Nom affiché, adresse e-mail | oui, recopiés de l'annuaire à l'ajout |
| Rôle, activation, dernière connexion | oui |
| **Mot de passe de l'utilisateur** | **non, jamais — ni en clair, ni haché, ni chiffré** |

Le mot de passe saisi traverse le backend le temps d'une tentative de connexion
LDAP, et n'est ni journalisé ni conservé.

## 2. Ajout d'un utilisateur

Un utilisateur n'est **jamais saisi à la main** : il est choisi dans l'annuaire.

1. L'administrateur cherche une personne — par identifiant ou par n'importe quel
   fragment de nom (`GET /api/users/directory?q=...`, deux caractères minimum).
   La recherche interroge `sAMAccountName`, `displayName`, `cn` et `mail`.
2. La recherche peut ramener plusieurs personnes. L'administrateur choisit la
   bonne, et lui attribue un rôle.
3. `POST /api/users` repasse par l'annuaire pour figer le nom affiché et
   l'adresse, et pour **refuser un identifiant qui n'y existe pas**.

### Retirer l'accès : on désactive, on ne supprime pas

Il n'existe pas de suppression d'utilisateur. Pour retirer l'accès à quelqu'un,
on désactive son compte.

La suppression effacerait la trace de qui a eu accès et quand — précisément ce
qu'on veut pouvoir consulter après un incident — et rien ne la distinguerait
d'un clic malheureux. Un compte désactivé conserve son historique, ne peut plus
se connecter, et se réactive en un clic si la personne revient.

Saisir l'identifiant librement produirait, à la moindre faute de frappe, un
compte incapable de se connecter et dont personne ne comprendrait pourquoi.

Les résultats de recherche indiquent qui est déjà utilisateur
(`alreadyRegistered`) : sans cela, on ajouterait deux fois la même personne pour
ne découvrir le refus qu'après coup.

### Échappement des filtres LDAP

Les fragments saisis sont échappés selon la RFC 4515 avant d'entrer dans un
filtre (`apps/backend/src/auth/directory/ldap-filter.ts`). Une recherche sur
`*)(objectClass=*` ne doit pas se transformer en requête choisie par
l'utilisateur — c'est l'équivalent LDAP d'une injection SQL.

## 3. Les deux comptes techniques

Ils sont définis par la **configuration du serveur**, pas en base. Ils
n'apparaissent donc pas dans la liste des utilisateurs, ne peuvent pas y être
ajoutés, et n'ont **aucun correspondant dans l'Active Directory**.

| Compte | Rôle | Usage |
|---|---|---|
| `sentineluser` | `viewer` | L'écran de l'open space. Session de longue durée (`AUTH_VIEWER_SESSION_DAYS`, 30 jours par défaut) pour que l'affichage ne se déconnecte pas tout seul. |
| `sentineladmin` | `admin` | Super administrateur. Filet de sécurité : il permet de reprendre la main si plus aucun compte nominatif ne peut administrer. |

Leurs mots de passe sont **hachés**, pas chiffrés, avec `scrypt`
(`apps/backend/src/auth/password-hash.ts`). Un chiffré supposerait une clé
capable de le déchiffrer — donc un secret de plus à protéger, et une valeur
récupérable en clair par qui met la main dessus. On n'a jamais besoin de relire
ces mots de passe, seulement de vérifier celui qui est saisi : le hachage suffit,
et il est à sens unique.

Les empreintes se génèrent avec `npm run auth:hash-password`, qui demande le mot
de passe sans l'afficher et ne l'accepte pas en argument de ligne de commande —
il se retrouverait dans l'historique du shell et dans la liste des processus.
Elles se placent dans `SENTINEL_USER_PASSWORD_HASH` et
`SENTINEL_ADMIN_PASSWORD_HASH`.

`SENTINEL_ADMIN_PASSWORD_HASH` est obligatoire : sans lui, personne ne peut
administrer l'application. Le backend refuse de démarrer s'il manque.

`sentineladmin` reste un filet de sécurité, pas un compte de travail. S'en servir
au quotidien reviendrait à partager un mot de passe unique entre plusieurs
personnes, ce que la gestion nominative existe précisément pour éviter. C'est
aussi pourquoi Sentinel refuse de retirer le **dernier administrateur nominatif
actif**.

## 4. Comportement en développement

En développement, l'Active Directory n'est pas joignable. `AUTH_MODE=dev`
remplace l'annuaire par un annuaire fictif
(`apps/backend/src/auth/directory/dev.directory.ts`) : la recherche et la
vérification d'existence fonctionnent sur huit personnes inventées, mais **le mot
de passe n'est pas vérifié**. Seule la première étape de l'authentification
subsiste : être un utilisateur déclaré et actif.

Ce mode est bruyant à dessein — le backend l'affiche en garde au démarrage — et
**le schéma de configuration refuse `AUTH_MODE=dev` quand `NODE_ENV=production`**.
Une bascule par inadvertance ouvrirait l'application à quiconque connaît un
identifiant déclaré.

## 5. Configuration LDAP

```
AUTH_MODE=ldap
LDAP_URL=ldap://serveur-ad:389
LDAP_BASE_DN=dc=gie,dc=local
LDAP_DOMAIN=@gie.local
LDAP_USERNAME=compte-de-service
LDAP_PASSWORD=...
LDAP_TIMEOUT_MS=10000
```

Ces variables deviennent obligatoires dès que `AUTH_MODE=ldap`.

Deux usages distincts de l'annuaire :

- **Authentifier** : Sentinel tente un `bind` avec les identifiants saisis. Si le
  `bind` réussit, le mot de passe est bon — c'est l'AD qui tranche, et lui seul.
- **Chercher** : les recherches et vérifications d'existence passent par le compte
  de service (`LDAP_USERNAME`), qui n'a besoin que d'un droit de lecture.

Chaque opération ouvre et referme sa propre connexion : une connexion maintenue
au long cours se retrouve à porter l'identité du dernier `bind` effectué, ce qui
mélangerait les droits d'un utilisateur et ceux du compte de service.

Les codes d'erreur AD 52e, 525, 530-533, 701, 773 et 775 sont traduits en refus
d'identifiants ; tout le reste est traité comme un annuaire injoignable. La
distinction importe : un annuaire en panne ne doit pas se présenter à
l'utilisateur comme un mot de passe erroné.

`npm run auth:test-ldap` vérifie la configuration contre l'annuaire réel sans
démarrer l'application.

## 6. Session

Un JWT signé (`AUTH_JWT_SECRET`, 32 caractères minimum) déposé dans un cookie
`sentinel_session` **HttpOnly** — illisible par le JavaScript de la page, donc
hors de portée d'une XSS — **SameSite=Lax**, et `Secure` en production.

Le rôle et l'activation sont **relus en base à chaque requête**, jamais tirés du
jeton. Sinon, retirer ses droits à quelqu'un ne prendrait effet qu'à l'expiration
de sa session, soit jusqu'à douze heures plus tard.

Durées : `AUTH_SESSION_HOURS` (12 h) pour les personnes,
`AUTH_VIEWER_SESSION_DAYS` (30 j) pour le compte d'affichage.

Le WebSocket applique le même contrôle : une connexion sans session valide est
fermée immédiatement.

## 7. Rôles

| | `viewer` | `superviseur` | `admin` |
|---|---|---|---|
| Consulter tableaux de bord, logs, alertes | oui | oui | oui |
| **Voir les chemins des fichiers de logs** | non | oui | oui |
| **Résoudre une alerte** | non | oui | oui |
| Créer/modifier applications, serveurs, services, règles, configuration | non | non | oui |
| Gérer les utilisateurs | non | non | oui |

- **`viewer`** — consultation seule. C'est le rôle du grand écran de l'open
  space, visible de tout le plateau et de qui passe.
- **`superviseur`** — l'exploitant au quotidien : il voit tout et acquitte les
  alertes, sans pouvoir modifier la configuration.
- **`admin`** — administre l'application.

Ces droits sont déclarés **une seule fois**, dans `ROLE_PERMISSIONS`
(`packages/shared-types/src/auth.ts`), et partagés par le backend qui les
applique et par l'interface qui masque en conséquence. Deux listes séparées
finiraient par diverger, et c'est toujours l'affichage qui aurait raison à
l'écran contre le serveur.

Ils ne forment pas une hiérarchie automatique. « admin ⊃ superviseur ⊃ viewer »
paraît commode jusqu'au jour où un droit ne suit pas l'ordre attendu, et il
devient alors impossible de l'exprimer : chaque droit est donc déclaré
explicitement, rôle par rôle.

Deux gardes distincts, `AuthGuard` puis `RolesGuard` : l'un répond « qui es-tu »,
l'autre « as-tu le droit ».

### Les chemins des fichiers de logs

`/home/mobileapi/API_MOBILE/LOG/*.log` décrit l'arborescence d'une machine de
production monétique. C'est une indication de reconnaissance : elle oriente qui
chercherait où frapper, et elle n'a aucune utilité pour quelqu'un qui se
contente de regarder passer les logs.

Elle n'est pas seulement masquée à l'affichage : **le backend ne l'envoie pas**.
`Application.logPath` vaut `null` pour un `viewer`. La masquer côté interface
seulement la laisserait lisible dans la réponse HTTP, donc dans l'onglet réseau
du navigateur — un masquage qui ne masque rien.

Garde-fous supplémentaires : on ne peut ni modifier son propre rôle, ni se
désactiver, ni se supprimer soi-même, ni retirer le dernier administrateur actif.

### Messages de refus

Mot de passe faux, compte inconnu, compte désactivé, compte absent de l'annuaire
donnent **le même message** : « Identifiants incorrects ou accès non autorisé ».
Distinguer les cas indiquerait à un attaquant quels identifiants existent.

## 8. Limitation des tentatives

Cinq tentatives de connexion par minute et par adresse. Le piège rencontré sur la
provenance de cette adresse — et son contournement complet par un en-tête
`X-Forwarded-For` forgé — est décrit dans `docs/SECURITY.md`, section A07.

## 9. Vérification

`scripts/qa-auth.mjs` (`npm run qa:auth`) déroule le parcours complet contre un backend démarré :
routes protégées, comptes techniques, recherche annuaire, ajout, rôles,
désactivation, session d'affichage, limitation des tentatives et
non-contournement de celle-ci.

`scripts/qa-2fa.mjs` (`npm run qa:2fa`) couvre la double authentification :
appairage, confirmation, connexion en deux étapes, codes de récupération à usage
unique, session restreinte et réinitialisation par un administrateur.

## 10. Double authentification

Livrée. Un code TOTP à six chiffres, renouvelé toutes les trente secondes,
compatible Google Authenticator, Authy et FreeOTP.

### L'algorithme est écrit ici, pas emprunté

L'implémentation de la RFC 6238 tient dans `apps/backend/src/auth/totp.ts` —
une trentaine de lignes utiles. La RFC publie des **vecteurs de test**, qui en
vérifient l'exactitude de bout en bout : les six passent.

Une implémentation qu'on peut prouver juste vaut mieux qu'une dépendance de plus
dans la chaîne d'approvisionnement d'une application qui supervise une production
monétique (`docs/SECURITY.md` A08). Le seul paquet ajouté est un générateur de QR
code, sans dépendance transitive.

### Chiffré, pas haché — et l'inverse pour les codes de récupération

Deux besoins opposés, qu'il ne faut pas confondre :

| Donnée | Traitement | Pourquoi |
|---|---|---|
| Secret TOTP | **chiffré** (AES-256-GCM) | Le serveur doit le relire pour recalculer le code attendu |
| Code de récupération | **empreinte** (HMAC-SHA-256) | On ne le relit jamais, on le compare seulement |

C'est exactement l'inverse du raisonnement tenu pour les mots de passe des
comptes techniques, qui sont hachés *parce qu'*on n'a jamais à les relire.

Le chiffré est lié à son propriétaire par les données authentifiées de GCM : un
secret recopié d'une ligne de la table vers une autre ne se déchiffre pas.

`AUTH_ENCRYPTION_KEY` est **obligatoire**, au même titre que `AUTH_JWT_SECRET`.
Deux clés en sont dérivées par HKDF, une pour chiffrer et une pour signer :
utiliser la même pour les deux usages est une faute classique, et la dérivation
coûte quelques microsecondes au démarrage.

### L'appairage n'active rien avant confirmation

`POST /api/auth/2fa/setup` enregistre un secret **sans l'activer** et renvoie le
QR code. Il ne devient effectif qu'après `POST /api/auth/2fa/confirm` avec un
premier code correct.

Sans cette étape, quelqu'un qui scanne mal son QR — ou dont le téléphone est à
l'heure d'un autre fuseau — se retrouverait enfermé dehors à sa connexion
suivante, sans rien avoir fait de mal.

La confirmation délivre **dix codes de récupération**, affichés une seule fois.
Ils répondent à un cas parfaitement banal : le téléphone perdu, cassé ou
réinitialisé. Sans eux, la seule issue serait d'appeler un administrateur — et si
la personne concernée *est* le dernier administrateur, il n'y en aurait aucune.

Chaque code sert une fois. Il est marqué utilisé plutôt que supprimé : savoir
qu'un code a servi, et quand, fait partie de la trace d'accès.

### La connexion en deux étapes

1. `POST /api/auth/login` valide le mot de passe et répond
   `{ requiresTwoFactor: true, challengeToken }` — **sans ouvrir de session**.
2. `POST /api/auth/2fa/challenge` présente ce jeton et le code.

Le jeton de défi n'est pas une session : il ne donne accès à aucune route, expire
en cinq minutes, et porte un type distinct (`typ: 'defi-2fa'`) pour ne jamais
pouvoir être présenté comme un cookie de session.

Le même champ accepte un code TOTP ou un code de récupération : leur forme les
distingue sans ambiguïté — six chiffres contre dix lettres et chiffres — et
demander à l'utilisateur de choisir d'abord n'apporterait rien.

`lastLoginAt` n'est mis à jour qu'une fois les **deux** étapes franchies.

### L'interrupteur global, et le piège qu'il cache

`AuthSettings.twoFactorEnforced` impose la double authentification à tous les
comptes nominatifs.

Le point délicat : **imposer la 2FA n'appaire personne**. Le jour où on l'active,
aucun compte ne l'a configurée. Deux réponses possibles, toutes deux mauvaises —
laisser ces comptes entrer normalement viderait le réglage de tout effet ; leur
refuser l'accès rendrait l'appairage impossible.

Ils reçoivent donc une **session restreinte à l'appairage** : `AuthGuard` la
limite aux seules routes portant `@AllowedDuringEnrollment()`. Tout le reste
répond 403. La restriction disparaît dès l'appairage confirmé, sans reconnexion.

C'est la différence entre un contrôle et une case à cocher décorative.

**Lever l'obligation ne dépaire personne.** Repasser `twoFactorEnforced` à `false`
supprime la contrainte pour les comptes qui n'ont rien configuré, mais laisse
intact l'appairage de ceux qui en ont un : ils continuent de saisir un code.

C'est délibéré — retirer d'office une protection que quelqu'un a mise en place
serait une régression de sécurité décidée à sa place. En contrepartie, c'est
contre-intuitif : l'écran d'administration doit donc le dire, et le bouton qui
retire l'appairage d'un compte doit être visible plutôt que caché dans une
infobulle.

### Réinitialisation

Un administrateur réinitialise la 2FA de quelqu'un par
`PATCH /api/users/:id { twoFactorEnabled: false }`. Le schéma n'accepte que
`false` : activer la double authentification suppose de scanner un QR code, ce
qu'on ne fait pas à la place de quelqu'un d'autre.

### Ce qui reste hors 2FA

Les deux comptes techniques. `sentineluser` s'affiche sur un écran mural sans
personne pour saisir un code, et `sentineladmin` est le filet de sécurité qui
doit fonctionner quand tout le reste est cassé.

### Limitation

`POST /api/auth/2fa/challenge` a sa propre limite, distincte de celle de la
connexion : cinq tentatives par minute et par adresse. Six chiffres se devinent
en un million d'essais, ce qui est peu.

## Annexe — préparation faite en Phases 1-3

Conservée ici parce qu'elle explique pourquoi la Phase 4 n'a demandé aucune
reprise des contrôleurs existants.

- `AuthGuard` créé dès le premier commit backend, retournant toujours `true`,
  mais peuplant déjà `request.user`. En Phase 4, **seul le contenu du guard a
  changé** : aucune route n'a eu besoin d'être modifiée. La promesse tenait.
- Colonnes d'audit `createdBy` / `updatedBy` présentes dès la création des
  entités, avec la valeur `'system'` tant que l'authentification n'existait pas.
- Layout Next.js unique `app/(protected)/layout.tsx`, point central où le
  contrôle de session s'est ajouté sans toucher aux pages.
