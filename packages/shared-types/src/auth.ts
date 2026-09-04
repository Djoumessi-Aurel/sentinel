import { z } from 'zod';

/**
 * Contrats d'authentification et de gestion des utilisateurs (docs/AUTH.md).
 *
 * Principe directeur : **Sentinel ne stocke aucun mot de passe**. Il tient la
 * liste de qui a le droit d'entrer et avec quel rôle ; la vérification du mot
 * de passe appartient à l'Active Directory. Deux comptes techniques font
 * exception, définis par la configuration du serveur et absents de cette liste.
 */

export const USER_ROLES = ['admin', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

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
