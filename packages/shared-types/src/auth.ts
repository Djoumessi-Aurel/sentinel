import { z } from 'zod';

/**
 * Contrats d'authentification et de gestion des utilisateurs (docs/AUTH.md).
 *
 * Principe directeur : **Sentinel ne stocke aucun mot de passe**. Il tient la
 * liste de qui a le droit d'entrer et avec quel rôle ; la vérification du mot
 * de passe appartient à l'Active Directory. Deux comptes techniques font
 * exception, définis par la configuration du serveur et absents de cette liste.
 */

/**
 * Rôles, du plus large au plus restreint.
 *
 * Ils ne forment pas une hiérarchie automatique : chaque droit est déclaré
 * explicitement dans `ROLE_PERMISSIONS`. Une hiérarchie implicite (« admin ⊃
 * superviseur ⊃ viewer ») paraît commode jusqu'au jour où un droit ne suit pas
 * l'ordre attendu, et il devient alors impossible de l'exprimer.
 */
export const USER_ROLES = ['admin', 'superviseur', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Libellés affichés. Les rôles restent en anglais dans les données. */
export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'administrateur',
  superviseur: 'superviseur',
  viewer: 'lecteur',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Administre l’application : applications, serveurs, règles, configuration, utilisateurs.',
  superviseur: 'Consulte tout, résout les alertes et voit les chemins des fichiers de logs.',
  viewer: 'Consultation seule. Les chemins des fichiers de logs lui sont masqués.',
};

/**
 * Droits attachés à chaque rôle — **source unique**, partagée par le backend
 * (qui applique) et le frontend (qui masque ce qui serait de toute façon
 * refusé). Deux listes séparées finiraient par diverger, et c'est toujours
 * l'affichage qui aurait raison à l'écran contre le serveur.
 */
export interface RolePermissions {
  /**
   * Voir le chemin des fichiers de logs sur les serveurs.
   *
   * C'est une information sensible : elle décrit l'arborescence d'une machine de
   * production monétique et oriente qui chercherait où frapper. Elle n'est pas
   * seulement masquée à l'affichage, le backend ne l'envoie pas.
   */
  voirCheminsDeLogs: boolean;
  /** Marquer une alerte comme résolue. */
  resoudreLesAlertes: boolean;
  /** Créer et modifier applications, serveurs, services, règles et configuration. */
  administrer: boolean;
  /** Gérer les utilisateurs de Sentinel. */
  gererLesUtilisateurs: boolean;
}

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissions> = {
  admin: {
    voirCheminsDeLogs: true,
    resoudreLesAlertes: true,
    administrer: true,
    gererLesUtilisateurs: true,
  },
  superviseur: {
    voirCheminsDeLogs: true,
    resoudreLesAlertes: true,
    administrer: false,
    gererLesUtilisateurs: false,
  },
  viewer: {
    voirCheminsDeLogs: false,
    resoudreLesAlertes: false,
    administrer: false,
    gererLesUtilisateurs: false,
  },
};

/** `peut(role, 'resoudreLesAlertes')` — se lit à voix haute. */
export const peut = (role: UserRole, droit: keyof RolePermissions): boolean => ROLE_PERMISSIONS[role][droit];

/** Rôles disposant d'un droit donné, pour alimenter `@Roles(...)`. */
export const rolesAvec = (droit: keyof RolePermissions): UserRole[] =>
  USER_ROLES.filter((role) => ROLE_PERMISSIONS[role][droit]);

/** Comptes techniques, à nom fixe, jamais présents dans la table des utilisateurs. */
export const BUILTIN_ACCOUNTS = {
  /** Compte du grand écran de l'open space : lecture seule, sans accès à l'annuaire. */
  viewer: 'sentineluser',
  /** Super administrateur, accès à tout. Sert notamment au tout premier accès. */
  superAdmin: 'sentineladmin',
} as const;

export const BUILTIN_USERNAMES: readonly string[] = Object.values(BUILTIN_ACCOUNTS);

export const isBuiltinUsername = (username: string): boolean =>
  BUILTIN_USERNAMES.includes(username.trim().toLowerCase());

/**
 * Un `sAMAccountName` : lettres, chiffres, et quelques séparateurs. Volontairement
 * restrictif — cette valeur part vers l'annuaire, et tout caractère exotique y
 * serait au mieux inutile, au pire un vecteur d'injection de filtre LDAP.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(190)
  .regex(/^[A-Za-z0-9._@-]+$/, 'Nom d’utilisateur invalide');

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(1).max(256),
});

export type LoginDto = z.infer<typeof loginSchema>;

export const userSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  role: z.enum(USER_ROLES),
  enabled: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type User = z.infer<typeof userSchema>;

/** Utilisateur connecté, tel que renvoyé par `GET /api/auth/me`. */
export interface CurrentUser {
  username: string;
  displayName: string;
  role: UserRole;
  /** `true` pour les comptes techniques : ils ne sont pas administrables. */
  builtin: boolean;
}

/** Personne trouvée dans l'annuaire, avant d'être ajoutée aux utilisateurs. */
export const directoryEntrySchema = z.object({
  username: z.string(),
  displayName: z.string(),
  email: z.string().nullable(),
  /** `true` si cette personne est déjà utilisateur de Sentinel. */
  alreadyRegistered: z.boolean(),
});

export type DirectoryEntry = z.infer<typeof directoryEntrySchema>;

export const searchDirectorySchema = z.object({
  /**
   * Fragment de nom ou d'identifiant. Deux caractères minimum : une recherche
   * sur une seule lettre ramènerait tout l'annuaire.
   */
  q: z.string().trim().min(2).max(120),
});

export type SearchDirectoryDto = z.infer<typeof searchDirectorySchema>;

export const createUserSchema = z.object({
  username: usernameSchema,
  role: z.enum(USER_ROLES).default('viewer'),
});

export type CreateUserDto = z.infer<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    role: z.enum(USER_ROLES),
    enabled: z.boolean(),
  })
  .partial();

export type UpdateUserDto = z.infer<typeof updateUserSchema>;

/**
 * Mode d'authentification actif, exposé par l'API pour que l'interface puisse
 * avertir l'exploitant quand le contrôle du mot de passe est court-circuité.
 */
export const AUTH_MODES = ['ldap', 'dev'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export interface AuthStatus {
  mode: AuthMode;
  /** `true` si l'annuaire répond : sans lui, seuls les comptes techniques passent. */
  directoryReachable: boolean;
}
