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

    // Adresses des reverse proxies autorisés à renseigner `X-Forwarded-For`.
    // Vide par défaut : sans proxy déclaré, l'en-tête est ignoré et l'adresse
    // du client est celle de la connexion TCP (docs/SECURITY.md A07).
    // Exemples : `loopback` (proxy sur la même machine), `10.12.0.4`,
    // `10.12.0.0/24`.
    TRUST_PROXY: z.string().trim().default(''),

    AGENT_TOKEN_SECRET: z.string().min(16, 'AGENT_TOKEN_SECRET doit faire au moins 16 caractères'),

    LOG_SOURCE_UTC_OFFSET_MINUTES: z.coerce.number().int().min(-840).max(840).default(0),

    // --- Authentification (docs/AUTH.md) ---
    // `dev` court-circuite la vérification du mot de passe : voir la garde en
    // fin de schéma, qui l'interdit en production.
    AUTH_MODE: z.enum(['ldap', 'dev']).default('dev'),
    AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET doit faire au moins 32 caractères'),
    /** Durée de session d'une personne, en heures. */
    AUTH_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    /**
     * Durée de session du compte d'affichage, en jours. Bien plus longue : le
     * grand écran de l'open space n'a personne pour s'y reconnecter, et une
     * session expirée y ferait disparaître la supervision sans que quiconque
     * le remarque.
     */
    AUTH_VIEWER_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /**
     * Clé de protection des secrets de double authentification, 32 octets au
     * moins, en hexadécimal ou en base64.
     *
     * Obligatoire, au même titre que `AUTH_JWT_SECRET` : la rendre facultative
     * ouvrirait un état à demi configuré où la double authentification est
     * activée pour des comptes mais illisible par le serveur.
     *
     * Générer : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
     */
    AUTH_ENCRYPTION_KEY: z.string().min(44, 'AUTH_ENCRYPTION_KEY doit représenter au moins 32 octets'),

    /** Empreintes scrypt des deux comptes techniques (`npm run auth:hash-password`). */
    SENTINEL_USER_PASSWORD_HASH: z.string().optional(),
    SENTINEL_ADMIN_PASSWORD_HASH: z.string().optional(),

    LDAP_URL: z.string().optional(),
    LDAP_DOMAIN: z.string().optional(),
    LDAP_BASE_DN: z.string().optional(),
    LDAP_USERNAME: z.string().optional(),
    LDAP_PASSWORD: z.string().optional(),
    LDAP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),

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
    if (env.AUTH_MODE === 'ldap' && (!env.LDAP_URL || !env.LDAP_BASE_DN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['LDAP_URL'],
        message: "LDAP_URL et LDAP_BASE_DN sont obligatoires lorsque AUTH_MODE vaut 'ldap'",
      });
    }

    // Le super administrateur est le seul accès garanti au tout premier
    // démarrage, avant qu'aucun utilisateur n'ait pu être ajouté.
    if (!env.SENTINEL_ADMIN_PASSWORD_HASH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['SENTINEL_ADMIN_PASSWORD_HASH'],
        message: "SENTINEL_ADMIN_PASSWORD_HASH est obligatoire : sans lui, personne ne peut administrer l'application. Générer l'empreinte avec `npm run auth:hash-password`.",
      });
    }

    // Un nombre de sauts ferait confiance au pair immédiat *quel qu'il soit* :
    // en accès direct, le client serait pris pour le proxy et choisirait
    // l'adresse qu'on lui attribue, ce qui lui permettrait d'échapper à la
    // limitation des tentatives de connexion en changeant d'en-tête.
    if (/^\d+$/.test(env.TRUST_PROXY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['TRUST_PROXY'],
        message:
          'TRUST_PROXY attend des adresses (par exemple « loopback » ou « 10.12.0.4 »), pas un nombre de sauts : un nombre ferait confiance à n’importe quel client en accès direct.',
      });
    }

    if (env.NODE_ENV === 'production') {
      if (env.AUTH_MODE === 'dev') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AUTH_MODE'],
          message:
            "AUTH_MODE=dev désactive la vérification des mots de passe et ne peut pas être utilisé en production",
        });
      }
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
