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

/**
 * Politique de rétention (docs/DATA_MODEL.md §4).
 *
 * Trois durées distinctes, parce que les trois natures de données n'ont ni le
 * même volume ni la même valeur dans le temps : les logs sont massifs et
 * perdent vite leur intérêt, l'historique des alertes est petit et sert au
 * bilan, les transitions de service sont rares et racontent la fiabilité d'un
 * service sur la durée.
 */
export const retentionSchema = z.object({
  /** Jours de conservation des logs. */
  logsDays: z.number().int().min(1).max(3650),
  /** Jours de conservation des alertes **résolues**. Les alertes actives ne sont jamais purgées. */
  resolvedAlertsDays: z.number().int().min(1).max(3650),
  /** Jours de conservation des transitions d'état de service. */
  serviceEventsDays: z.number().int().min(1).max(3650),
});

export type Retention = z.infer<typeof retentionSchema>;

export const DEFAULT_RETENTION: Retention = {
  logsDays: 90,
  resolvedAlertsDays: 365,
  serviceEventsDays: 365,
};

export const globalConfigSchema = z.object({
  id: z.literal('singleton'),
  displayColors: displayColorsSchema,
  alertChannelsDefault: alertChannelsDefaultSchema,
  analyzerDefaults: z.array(analyzerDefaultSchema),
  serviceCheckDefaults: serviceCheckDefaultsSchema,
  retention: retentionSchema,
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
    retention: retentionSchema,
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
  // Fond clair : l'application est affichée en permanence sur un grand écran
  // d'open space. Un fond sombre en plein jour fatigue les yeux et se lit mal à
  // distance. Chaque couleur de niveau tient le ratio de contraste WCAG AA
  // (4,5:1) sur ce fond — un niveau illisible à trois mètres ne sert à rien.
  background: '#ffffff',
  text: '#1e293b',
  levelColors: {
    TRACE: '#64748b',
    DEBUG: '#475569',
    INFO: '#0369a1',
    WARN: '#b45309',
    ERROR: '#be123c',
    FATAL: '#9f1239',
    UNKNOWN: '#334155',
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
