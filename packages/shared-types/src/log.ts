import { z } from 'zod';

/**
 * Niveaux de log connus. La liste reste volontairement ouverte : un futur type
 * d'appli peut introduire un niveau supplémentaire sans qu'on ait à modifier
 * les écrans de configuration (voir docs/CONFIG_MANAGEMENT.md §4).
 */
export const KNOWN_LOG_LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'UNKNOWN'] as const;

export type KnownLogLevel = (typeof KNOWN_LOG_LEVELS)[number];

/** Un niveau est une chaîne libre : `KnownLogLevel` n'est qu'un jeu de valeurs courantes. */
export type LogLevel = KnownLogLevel | (string & {});

export const logLevelSchema = z
  .string()
  .min(1)
  .max(32)
  .transform((value) => value.toUpperCase());

/** Valeurs autorisées dans `metadata` : primitives uniquement, pour rester indexable. */
export const logMetadataSchema = z.record(z.union([z.string(), z.number(), z.boolean()]));

export type LogMetadata = z.infer<typeof logMetadataSchema>;

export const logEntrySchema = z.object({
  /** ISO 8601, toujours en UTC (normalisé dès l'ingestion — docs/ARCHITECTURE.md §9). */
  timestamp: z.string().datetime(),
  level: logLevelSchema,
  message: z.string(),
  /** Ligne brute d'origine, stockée mais non indexée en full-text. */
  raw: z.string(),
  metadata: logMetadataSchema.optional(),
});

export type LogEntry = z.infer<typeof logEntrySchema>;

/** `LogEntry` telle que persistée et renvoyée par l'API (enrichie du contexte appli). */
export const storedLogEntrySchema = logEntrySchema.extend({
  id: z.string(),
  applicationId: z.string(),
  applicationType: z.string(),
  server: z.string(),
});

export type StoredLogEntry = z.infer<typeof storedLogEntrySchema>;
