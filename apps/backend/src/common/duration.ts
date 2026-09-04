/**
 * Durées façon `30s`, `15m`, `2h`, `1d`, utilisées par les fenêtres des règles
 * et les cooldowns (docs/ALERTING.md). Le format est validé en amont par
 * `durationSchema` dans `packages/shared-types`.
 */
const UNIT_TO_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const PATTERN = /^(\d+)(s|m|h|d)$/;

export function durationToMs(duration: string): number {
  const match = PATTERN.exec(duration.trim());
  if (!match) {
    throw new Error(`Durée invalide « ${duration} » : attendu un format comme 30s, 15m, 2h ou 1d`);
  }
  const [, amount, unit] = match as unknown as [string, string, string];
  const factor = UNIT_TO_MS[unit];
  if (factor === undefined) {
    throw new Error(`Unité de durée inconnue « ${unit} »`);
  }
  return Number(amount) * factor;
}

/** Instant marquant le début d'une fenêtre glissante se terminant maintenant. */
export function windowStart(duration: string, now: Date = new Date()): Date {
  return new Date(now.getTime() - durationToMs(duration));
}
