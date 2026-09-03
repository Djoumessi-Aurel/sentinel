import { z } from 'zod';

/** Couleur hexadécimale `#rgb` ou `#rrggbb`. */
export const hexColorSchema = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Couleur hexadécimale attendue, ex. #1e293b');

/**
 * Couleurs d'affichage. `levelColors` est un dictionnaire ouvert : un niveau
 * inconnu tombe sur `text` côté frontend, aucune enum fermée ici.
 */
export const displayColorsSchema = z.object({
  background: hexColorSchema,
  text: hexColorSchema,
  levelColors: z.record(hexColorSchema),
});

export type DisplayColors = z.infer<typeof displayColorsSchema>;

export const alertChannelsSchema = z.object({
  visual: z.boolean(),
  sound: z.boolean(),
  email: z.object({
    enabled: z.boolean(),
    recipients: z.array(z.string().email()).max(50),
  }),
  sms: z.object({
    enabled: z.boolean(),
    // Numéros au format international, ex. +237690000000
    recipients: z.array(z.string().regex(/^\+?[0-9]{6,20}$/)).max(50),
  }),
});

export type AlertChannels = z.infer<typeof alertChannelsSchema>;

/** Canaux activés par défaut pour toute nouvelle appli (config globale). */
export const alertChannelsDefaultSchema = z.object({
  visual: z.boolean(),
  sound: z.boolean(),
  email: z.boolean(),
  sms: z.boolean(),
});

export type AlertChannelsDefault = z.infer<typeof alertChannelsDefaultSchema>;

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Heure attendue au format HH:mm');

export const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: timeOfDaySchema,
  end: timeOfDaySchema,
  mutedChannels: z.array(z.enum(['visual', 'sound', 'email', 'sms'])),
});

export type QuietHours = z.infer<typeof quietHoursSchema>;

/** Analyseur activé par défaut à la création d'une appli. */
export const analyzerDefaultSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1),
  params: z.record(z.unknown()),
});

export type AnalyzerDefault = z.infer<typeof analyzerDefaultSchema>;

export const serviceCheckDefaultsSchema = z.object({
  /** Secondes. 30 s par défaut (docs/CONFIG_MANAGEMENT.md §4). */
  checkInterval: z.number().int().min(5).max(3600),
  criticalByDefault: z.boolean(),
});

export type ServiceCheckDefaults = z.infer<typeof serviceCheckDefaultsSchema>;

export const globalConfigSchema = z.object({
  id: z.literal('singleton'),
  displayColors: displayColorsSchema,
  alertChannelsDefault: alertChannelsDefaultSchema,
  analyzerDefaults: z.array(analyzerDefaultSchema),
  serviceCheckDefaults: serviceCheckDefaultsSchema,
  updatedAt: z.string().datetime(),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;

export const appConfigSchema = z.object({
  id: z.string(),
  applicationId: z.string(),
  displayColors: displayColorsSchema,
  alertChannels: alertChannelsSchema,
  quietHours: quietHoursSchema.nullable(),
  updatedAt: z.string().datetime(),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export const updateGlobalConfigSchema = z
  .object({
    displayColors: displayColorsSchema,
    alertChannelsDefault: alertChannelsDefaultSchema,
    analyzerDefaults: z.array(analyzerDefaultSchema),
    serviceCheckDefaults: serviceCheckDefaultsSchema,
  })
  .partial();

export type UpdateGlobalConfigDto = z.infer<typeof updateGlobalConfigSchema>;

export const updateAppConfigSchema = z
  .object({
    displayColors: displayColorsSchema,
    alertChannels: alertChannelsSchema,
    quietHours: quietHoursSchema.nullable(),
  })
  .partial();

export type UpdateAppConfigDto = z.infer<typeof updateAppConfigSchema>;

export const generalizeConfigSchema = z.object({
  applicationIds: z.array(z.string().uuid()).min(1).max(500),
});

export type GeneralizeConfigDto = z.infer<typeof generalizeConfigSchema>;

/**
 * Valeurs de démarrage de la config globale. Utilisées uniquement pour créer la
 * ligne unique au premier lancement (seed) — jamais lues en fallback à
 * l'affichage (docs/CONFIG_MANAGEMENT.md §1).
 */
export const DEFAULT_DISPLAY_COLORS: DisplayColors = {
  background: '#0f172a',
  text: '#e2e8f0',
  levelColors: {
    TRACE: '#64748b',
    DEBUG: '#94a3b8',
    INFO: '#38bdf8',
    WARN: '#fbbf24',
    ERROR: '#f87171',
    FATAL: '#ef4444',
    UNKNOWN: '#cbd5e1',
  },
};

export const DEFAULT_ALERT_CHANNELS_DEFAULT: AlertChannelsDefault = {
  visual: true,
  sound: true,
  email: false,
  sms: false,
};

export const DEFAULT_SERVICE_CHECK_DEFAULTS: ServiceCheckDefaults = {
  checkInterval: 30,
  criticalByDefault: true,
};
