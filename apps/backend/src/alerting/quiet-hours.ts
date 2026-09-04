import type { AlertChannelName, QuietHours } from '@sentinel/shared-types';

/**
 * Heures creuses (docs/ALERTING.md §4).
 *
 * Le filtrage porte sur la **notification**, jamais sur la détection : l'alerte
 * est bien créée et visible dans l'historique, seuls les canaux bruyants se
 * taisent. Couper la détection ferait disparaître l'incident.
 */

const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':');
  return Number(hours) * 60 + Number(minutes);
};

/**
 * Une plage peut franchir minuit (22:00 → 06:00) : c'est le cas le plus courant
 * pour des heures creuses, et le comparer naïvement l'inverserait.
 */
export function isWithinQuietHours(quietHours: QuietHours | null, now: Date): boolean {
  if (!quietHours?.enabled) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(quietHours.start);
  const end = toMinutes(quietHours.end);

  if (start === end) return false;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

/** Canaux à museler à cet instant. Vide hors des heures creuses. */
export function mutedChannelsAt(quietHours: QuietHours | null, now: Date): Set<AlertChannelName> {
  if (!isWithinQuietHours(quietHours, now)) return new Set();
  return new Set(quietHours?.mutedChannels ?? []);
}
