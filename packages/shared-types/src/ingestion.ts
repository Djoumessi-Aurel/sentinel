import { z } from 'zod';

/**
 * Limites d'ingestion. Elles sont volontairement strictes : le endpoint est
 * exposé aux agents et constitue la principale surface d'attaque du backend
 * (OWASP A04 — conception non sécurisée, absence de limites de ressources).
 */
export const INGESTION_LIMITS = {
  maxLinesPerBatch: 2000,
  maxRawLineLength: 32_768,
  /** Taille maximale du corps HTTP accepté sur les routes d'ingestion. */
  maxBodyBytes: 8 * 1024 * 1024,
} as const;

export const rawLogLineSchema = z.object({
  raw: z.string().max(INGESTION_LIMITS.maxRawLineLength),
  receivedAt: z.string().datetime().optional(),
});

export type RawLogLine = z.infer<typeof rawLogLineSchema>;

export const ingestLogsSchema = z.object({
  applicationId: z.string().uuid(),
  server: z.string().min(1).max(255),
  lines: z.array(rawLogLineSchema).min(1).max(INGESTION_LIMITS.maxLinesPerBatch),
});

export type IngestLogsDto = z.infer<typeof ingestLogsSchema>;

export interface IngestionAccepted {
  accepted: number;
  /** Lignes rejetées par le parseur (rattachées à l'entrée précédente ou ignorées). */
  skipped: number;
}

export const searchLogsQuerySchema = z.object({
  applicationId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  level: z.string().min(1).max(32).optional(),
  /** Recherche plein texte sur le message. */
  query: z.string().max(500).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export type SearchLogsQuery = z.infer<typeof searchLogsQuerySchema>;

export interface Paginated<T> {
  total: number;
  page: number;
  pageSize: number;
  items: T[];
}
