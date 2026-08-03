# AUTH.md

Le module d'authentification/utilisateurs/rôles n'est **pas** implémenté avant
la Phase 4. Ce document a deux objectifs : (1) décrire dès maintenant la
préparation à faire dans le code des Phases 1-3, (2) documenter la conception
cible pour quand le module sera réellement construit — en particulier la
double authentification (2FA), activable globalement et par utilisateur.

## 1. Préparation à faire dès maintenant (Phases 1-3)

- **Guard générique sur toutes les routes.** Créer `AuthModule` avec un
  `AuthGuard` dès le premier commit backend. En Phase 1-3, ce guard retourne
  toujours `true` (aucun contrôle réel), mais il doit déjà lire un header
  `Authorization` s'il est présent et peupler `request.user` avec un objet
  factice (`{ id: 'system', role: 'admin' }`) pour que les contrôleurs
  puissent déjà écrire `@CurrentUser() user: RequestUser` sans changement de
  signature plus tard.
- **Colonnes d'audit.** `createdBy` / `updatedBy` déjà présentes sur
  `Application` (voir `DATA_MODEL.md`) ; à généraliser aux autres entités
  modifiables par un humain (`AnalyzerRule`, `GlobalConfig`, `AppConfig`) dès
  leur création, même si la valeur reste `null` ou `'system'` tant que
  l'auth n'existe pas.
- **Frontend : layout protégé.** Toutes les pages de l'application (hors une
  future page de login) sont rendues sous un layout Next.js unique
  (`app/(protected)/layout.tsx`) qui, en Phase 1-3, ne fait aucune
  vérification, mais centralise le point où un futur contrôle de session sera
  ajouté sans avoir à modifier chaque page.
- **Ne jamais coder en dur** un email/téléphone de destinataire d'alerte
  ailleurs que dans `AppConfig.alertChannels` — ces destinataires deviendront
  des références à des `User` en Phase 4 (actuellement des chaînes libres).

## 2. Conception cible (Phase 4)

### 2.1 Modèle de données (à ajouter)

```prisma
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String
  role          String   // simple au départ ('admin' | 'viewer'), évolutif vers un vrai RBAC si besoin
  twoFactorEnabled Boolean @default(false)
  twoFactorSecret  String? // secret TOTP chiffré au repos
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}

model AuthSettings {
  id                  String  @id @default("singleton")
  twoFactorEnforced   Boolean @default(false) // interrupteur global : force la 2FA pour tous les utilisateurs
  updatedAt           DateTime @updatedAt
}
```

- `AuthSettings.twoFactorEnforced` : interrupteur **global** en administration.
  S'il est activé, la 2FA devient obligatoire pour tous les comptes,
  indépendamment de `User.twoFactorEnabled`.
- `User.twoFactorEnabled` : interrupteur **par utilisateur**, pertinent
  quand le réglage global n'impose pas la 2FA — chaque utilisateur peut
  l'activer volontairement.
- Règle d'évaluation à la connexion : `requiresTwoFactor = AuthSettings.twoFactorEnforced || User.twoFactorEnabled`.

### 2.2 Mécanisme 2FA retenu

**TOTP (Time-based One-Time Password)**, standard, compatible Google
Authenticator / Authy / etc. — pas de dépendance à un fournisseur SMS
supplémentaire (déjà un canal SMS pour les alertes, on évite de dupliquer un
second usage SMS pour l'auth, plus coûteux et moins fiable qu'un TOTP).
Librairie recommandée : `otplib` côté NestJS.

### 2.3 Parcours

**Activation (utilisateur)**
1. `POST /api/auth/2fa/setup` → génère un secret TOTP, retourne un QR code
   (URI `otpauth://`) à scanner dans l'appli d'authentification.
2. `POST /api/auth/2fa/verify` avec le code à 6 chiffres → si correct,
   `User.twoFactorEnabled = true` et le secret est persisté (chiffré).

**Connexion**
1. `POST /api/auth/login` avec email/mot de passe → si
   `requiresTwoFactor` est faux, session créée directement.
2. Si `requiresTwoFactor` est vrai, réponse intermédiaire (`{ requires2FA:
   true, challengeToken }`) sans session complète.
3. `POST /api/auth/2fa/challenge` avec `challengeToken` + code TOTP → session
   complète créée si le code est valide.

**Administration**
- `PATCH /api/admin/auth-settings { twoFactorEnforced: boolean }` — réservé au
  rôle `admin`.
- `PATCH /api/admin/users/:id { twoFactorEnabled: boolean }` — un admin peut
  forcer la désactivation/réinitialisation de la 2FA d'un utilisateur (ex :
  perte de l'appareil), ce qui invalide le secret existant.

### 2.4 Sécurité
- Le secret TOTP est chiffré au repos (pas juste hashé, car il doit être
  déchiffrable pour vérifier les codes — chiffrement symétrique avec clé
  d'application en variable d'environnement, jamais en base).
- Générer des **codes de récupération** à usage unique à l'activation de la
  2FA (10 codes, affichés une seule fois), pour le cas de perte de l'appareil
  d'authentification — table `RecoveryCode(userId, codeHash, usedAt)`.
- Limiter les tentatives de code TOTP (rate limiting sur
  `/api/auth/2fa/challenge`) pour empêcher le brute-force sur 6 chiffres.

### 2.5 Intégration avec le reste de l'application
- Une fois `AuthModule` implémenté, `AuthGuard` (déjà présent depuis la
  Phase 1) est simplement remplacé en interne pour vérifier une vraie session
  — **aucune route existante n'a besoin d'être modifiée**, seul le contenu du
  guard change, ce qui valide a posteriori la préparation faite dès la
  Phase 1.
- Le rôle (`admin`/`viewer` pour commencer) conditionne l'accès aux écrans de
  configuration (généraliser, gérer les applis) côté frontend et backend ;
  un `RolesGuard` séparé du `AuthGuard` permet d'ajouter des rôles plus fins
  plus tard sans reprendre l'authentification elle-même.
