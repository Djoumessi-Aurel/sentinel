import { z } from 'zod';

/**
 * Validation de la configuration au démarrage.
 *
 * Un backend qui démarre avec une variable manquante ou incohérente échoue plus
 * tard, en production, sur une requête réelle. On préfère refuser de démarrer :
 * c'est bruyant, immédiat, et cela évite qu'une mauvaise configuration
 * (OWASP A05) passe inaperçue.
 */

const booleanFromString = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(['true', 'false', '1', '0']))
  .transform((value) => value === 'true' || value === '1');

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  );

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL est obligatoire'),

    LOG_STORE: z.enum(['mysql', 'opensearch']).default('mysql'),
    OPENSEARCH_URL: z.string().url().optional(),
    OPENSEARCH_INDEX: z.string().min(1).default('sentinel-logs'),
    OPENSEARCH_USERNAME: z.string().optional(),
    OPENSEARCH_PASSWORD: z.string().optional(),

    // Jamais de `*` : le CORS ouvert est une mauvaise configuration classique
    // (OWASP A05), et il s'applique aussi au WebSocket.
    CORS_ORIGINS: csv.default('http://localhost:3000'),

    AGENT_TOKEN_SECRET: z.string().min(16, 'AGENT_TOKEN_SECRET doit faire au moins 16 caractères'),

    LOG_SOURCE_UTC_OFFSET_MINUTES: z.coerce.number().int().min(-840).max(840).default(0),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(25),
    SMTP_SECURE: booleanFromString.default('false'),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_FROM: z.string().optional(),

    SMS_GATEWAY_URL: z.string().url().optional(),
    SMS_GATEWAY_API_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.LOG_STORE === 'opensearch' && !env.OPENSEARCH_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['OPENSEARCH_URL'],
        message: "OPENSEARCH_URL est obligatoire lorsque LOG_STORE vaut 'opensearch'",
      });
    }
    if (env.NODE_ENV === 'production') {
      if (env.AGENT_TOKEN_SECRET === 'changez-moi-en-production') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AGENT_TOKEN_SECRET'],
          message: "AGENT_TOKEN_SECRET porte encore sa valeur d'exemple",
        });
      }
      if (env.CORS_ORIGINS.some((origin) => origin === '*')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ORIGINS'],
          message: 'CORS_ORIGINS ne peut pas valoir * en production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (result.success) return result.data;

  const details = result.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(racine)'} : ${issue.message}`)
    .join('\n');
  throw new Error(`Configuration invalide, démarrage interrompu :\n${details}`);
}
