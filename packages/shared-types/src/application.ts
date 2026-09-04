import { z } from 'zod';

/**
 * Types d'appli connus. Volontairement une simple liste de constantes et non une
 * enum fermée en base : ajouter un type = ajouter un parseur, sans migration
 * (docs/LOG_PARSERS.md §5).
 */
export const KNOWN_APP_TYPES = ['generic', 'spring-boot', 'java-simple', 'nodejs-pm2', 'react-nginx', 'distribcard'] as const;

export type KnownAppType = (typeof KNOWN_APP_TYPES)[number];
export type AppType = KnownAppType | (string & {});

export const APPLICATION_STATUSES = ['active', 'paused', 'archived'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Statut agrégé affiché par le badge (docs/ALERTING.md §5). */
export const APPLICATION_HEALTHS = ['ok', 'warning', 'critical', 'silent'] as const;
export type ApplicationHealth = (typeof APPLICATION_HEALTHS)[number];

const nameSchema = z.string().trim().min(1).max(120);

export const serverSchema = z.object({
  id: z.string(),
  name: nameSchema,
  host: z.string().trim().min(1).max(255),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Server = z.infer<typeof serverSchema>;

export const createServerSchema = z.object({
  name: nameSchema,
  host: z.string().trim().min(1).max(255),
});

export type CreateServerDto = z.infer<typeof createServerSchema>;

export const applicationSchema = z.object({
  id: z.string(),
  name: nameSchema,
  type: z.string().min(1).max(64),
  serverId: z.string(),
  /**
   * Chemin du fichier de logs sur le serveur.
   *
   * **`null` quand l'utilisateur n'a pas le droit de le voir** (rôle `viewer`).
   * Le backend ne l'envoie alors pas du tout : le masquer à l'affichage
   * seulement le laisserait lisible dans la réponse HTTP, donc dans l'onglet
   * réseau du navigateur — ce qui ne masque rien.
   */
  logPath: z.string().min(1).max(1024).nullable(),
  status: z.enum(APPLICATION_STATUSES),
  lastLogAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Application = z.infer<typeof applicationSchema>;

export const createApplicationSchema = z.object({
  name: nameSchema,
  type: z.string().min(1).max(64),
  serverId: z.string().uuid(),
  logPath: z.string().trim().min(1).max(1024),
});

export type CreateApplicationDto = z.infer<typeof createApplicationSchema>;

export const updateApplicationSchema = z
  .object({
    name: nameSchema,
    logPath: z.string().trim().min(1).max(1024),
    status: z.enum(APPLICATION_STATUSES),
  })
  .partial();

export type UpdateApplicationDto = z.infer<typeof updateApplicationSchema>;

/**
 * Réponse à la création d'une appli : le token d'agent n'est renvoyé en clair
 * qu'à cet instant précis, il n'est stocké que hashé (docs/DEPLOYMENT.md §2).
 */
export interface CreatedApplication {
  application: Application;
  agentToken: string;
}

/** Vue enrichie utilisée par le dashboard et la liste des applis. */
export interface ApplicationSummary extends Application {
  serverName: string;
  health: ApplicationHealth;
  activeAlertCount: number;
  servicesDown: number;
  servicesTotal: number;
}
