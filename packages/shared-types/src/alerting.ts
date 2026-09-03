import { z } from 'zod';

export const ALERT_SEVERITIES = ['warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_CHANNEL_NAMES = ['visual', 'sound', 'email', 'sms'] as const;
export type AlertChannelName = (typeof ALERT_CHANNEL_NAMES)[number];

/** Types d'analyseurs livrés. Liste ouverte : un nouveau type s'enregistre dans l'AnalyzerRegistry. */
export const KNOWN_ANALYZER_TYPES = [
  'level-threshold',
  'pattern-rate',
  'silence',
  'service-status',
  'service-silence',
] as const;

export type KnownAnalyzerType = (typeof KNOWN_ANALYZER_TYPES)[number];
export type AnalyzerType = KnownAnalyzerType | (string & {});

/** Durée façon `30s`, `15m`, `2h`, `1d`. */
export const durationSchema = z
  .string()
  .regex(/^[1-9]\d*(?:s|m|h|d)$/, 'Durée attendue au format 30s / 15m / 2h / 1d');

export type Duration = z.infer<typeof durationSchema>;

const severitySchema = z.enum(ALERT_SEVERITIES);

export const levelThresholdParamsSchema = z.object({
  level: z.string().min(1).max(32),
  minCount: z.number().int().min(1).max(100000),
  window: durationSchema,
  severity: severitySchema,
});

export type LevelThresholdParams = z.infer<typeof levelThresholdParamsSchema>;

const patternMatchSchema = z.object({
  field: z.string().min(1).max(190),
  equals: z.union([z.string(), z.number(), z.boolean()]),
  outcome: z.string().min(1).max(64),
});

export const patternRateParamsSchema = z.object({
  successMatch: patternMatchSchema,
  failureMatch: patternMatchSchema,
  window: durationSchema,
  /** Seuil en pourcentage. */
  threshold: z.number().min(0).max(100),
  operator: z.enum(['lt', 'lte', 'gt', 'gte']),
  severity: severitySchema,
  /** Nombre minimum d'événements dans la fenêtre avant d'évaluer le taux. */
  minSamples: z.number().int().min(1).max(100000).default(1),
});

export type PatternRateParams = z.infer<typeof patternRateParamsSchema>;

export const silenceParamsSchema = z.object({
  maxSilence: durationSchema,
  severity: severitySchema,
});

export type SilenceParams = z.infer<typeof silenceParamsSchema>;

export const serviceStatusParamsSchema = z.object({
  monitoredServiceId: z.string(),
  expectedState: z.string().min(1).max(32),
  severity: severitySchema,
});

export type ServiceStatusParams = z.infer<typeof serviceStatusParamsSchema>;

export const serviceSilenceParamsSchema = z.object({
  monitoredServiceId: z.string(),
  maxSilence: durationSchema,
  severity: severitySchema,
});

export type ServiceSilenceParams = z.infer<typeof serviceSilenceParamsSchema>;

export const analyzerRuleSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  type: z.string().min(1).max(64),
  name: z.string().min(1).max(190),
  enabled: z.boolean(),
  params: z.record(z.unknown()),
  /** Délai minimum entre deux notifications pour cette règle (docs/ALERTING.md §3). */
  cooldown: durationSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AnalyzerRule = z.infer<typeof analyzerRuleSchema>;

export const createAnalyzerRuleSchema = z.object({
  type: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(190),
  enabled: z.boolean().optional(),
  params: z.record(z.unknown()),
  cooldown: durationSchema.optional(),
});

export type CreateAnalyzerRuleDto = z.infer<typeof createAnalyzerRuleSchema>;

export const updateAnalyzerRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(190),
    enabled: z.boolean(),
    params: z.record(z.unknown()),
    cooldown: durationSchema,
  })
  .partial();

export type UpdateAnalyzerRuleDto = z.infer<typeof updateAnalyzerRuleSchema>;

/** Statut d'envoi par canal, conservé pour audit dans `AlertEvent.channelsNotified`. */
export interface ChannelNotificationResult {
  channel: AlertChannelName;
  status: 'sent' | 'failed' | 'skipped';
  /** Raison en cas de `failed` ou `skipped` (heures creuses, canal désactivé, erreur SMTP...). */
  detail?: string;
  at: string;
}

export const alertEventSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  ruleId: z.string().nullable(),
  severity: z.enum(ALERT_SEVERITIES),
  message: z.string(),
  triggeredAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  lastNotifiedAt: z.string().datetime().nullable(),
  channelsNotified: z.array(
    z.object({
      channel: z.enum(ALERT_CHANNEL_NAMES),
      status: z.enum(['sent', 'failed', 'skipped']),
      detail: z.string().optional(),
      at: z.string().datetime(),
    }),
  ),
});

export type AlertEvent = z.infer<typeof alertEventSchema>;

/** Résultat d'une évaluation d'analyseur. */
export interface AnalyzerResult {
  triggered: boolean;
  severity: AlertSeverity;
  /** Message lisible destiné à l'alerte et à l'écran de test. */
  message: string;
  /** Valeurs ayant servi au calcul, affichées par `POST /api/rules/:id/test`. */
  details?: Record<string, unknown>;
}

export const testChannelSchema = z.object({
  applicationId: z.string().uuid(),
  channel: z.enum(ALERT_CHANNEL_NAMES),
});

export type TestChannelDto = z.infer<typeof testChannelSchema>;

export const listAlertsQuerySchema = z.object({
  applicationId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  severity: z.enum(ALERT_SEVERITIES).optional(),
  status: z.enum(['active', 'resolved']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
