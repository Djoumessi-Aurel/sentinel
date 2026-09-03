import { z } from 'zod';

/**
 * États remontés par le script de vérification. `unknown` couvre le cas où la
 * commande de vérification elle-même a échoué sur le serveur distant.
 */
export const SERVICE_STATES = ['active', 'inactive', 'failed', 'unknown'] as const;
export type ServiceState = (typeof SERVICE_STATES)[number];

/** Modes de vérification. Liste ouverte, comme les types d'appli. */
export const KNOWN_CHECK_TYPES = ['systemd', 'pm2', 'process', 'tcp-port', 'http'] as const;
export type KnownCheckType = (typeof KNOWN_CHECK_TYPES)[number];
export type CheckType = KnownCheckType | (string & {});

export const monitoredServiceSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  name: z.string().min(1).max(190),
  checkType: z.string().min(1).max(32),
  critical: z.boolean(),
  checkInterval: z.number().int().min(5).max(3600),
  lastState: z.enum(SERVICE_STATES).nullable(),
  lastCheckedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type MonitoredService = z.infer<typeof monitoredServiceSchema>;

export const createMonitoredServiceSchema = z.object({
  /** Ex. `httpd.service`, ou `api` pour un processus PM2. */
  name: z.string().trim().min(1).max(190),
  checkType: z.string().trim().min(1).max(32).optional(),
  /** `true` par défaut côté serveur, repris de GlobalConfig.serviceCheckDefaults. */
  critical: z.boolean().optional(),
  checkInterval: z.number().int().min(5).max(3600).optional(),
});

export type CreateMonitoredServiceDto = z.infer<typeof createMonitoredServiceSchema>;

export const updateMonitoredServiceSchema = createMonitoredServiceSchema.partial();

export type UpdateMonitoredServiceDto = z.infer<typeof updateMonitoredServiceSchema>;

export const serviceStatusEventSchema = z.object({
  id: z.string(),
  monitoredServiceId: z.string(),
  previousState: z.enum(SERVICE_STATES).nullable(),
  newState: z.enum(SERVICE_STATES),
  changedAt: z.string().datetime(),
});

export type ServiceStatusEvent = z.infer<typeof serviceStatusEventSchema>;

/** Payload envoyé par `agents/check-services.sh` (docs/API.md §2). */
export const statusCheckSchema = z.object({
  serviceName: z.string().min(1).max(190),
  state: z.enum(SERVICE_STATES),
  checkedAt: z.string().datetime(),
});

export type StatusCheck = z.infer<typeof statusCheckSchema>;

export const ingestStatusSchema = z.object({
  applicationId: z.string().uuid(),
  server: z.string().min(1).max(255),
  checks: z.array(statusCheckSchema).min(1).max(200),
});

export type IngestStatusDto = z.infer<typeof ingestStatusSchema>;

/** Réponse de `GET /api/applications/:appId/services/status`. */
export interface ApplicationServicesStatus {
  applicationId: string;
  /** Agrégat des seuls services `critical: true` (docs/ALERTING.md §5). */
  aggregate: 'ok' | 'degraded' | 'down' | 'unknown';
  services: MonitoredService[];
}

/**
 * Liste consommée par `agents/refresh-services.sh` pour régénérer son cache
 * local. Volontairement minimale : l'agent n'a pas besoin du reste.
 */
export interface AgentServiceList {
  applicationId: string;
  services: Array<{ name: string; checkType: string; checkInterval: number }>;
}
