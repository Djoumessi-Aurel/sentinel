/**
 * Normalisation des horodatages vers ISO 8601 UTC.
 *
 * Les lignes de log des applis du parc portent des horodatages *naïfs* (aucun
 * fuseau explicite). Les interpréter comme de l'UTC alors que les serveurs sont
 * en UTC+1 décalerait toute l'application d'une heure : recherches par plage de
 * dates fausses, fenêtres glissantes des règles fausses, alertes de silence
 * déclenchées à tort. Le décalage de la source est donc explicite.
 */

/** Motif `YYYY-MM-DD HH:mm:ss[.SSS]` ou `YYYY/MM/DD HH:mm:ss`, séparateur T accepté. */
const NAIVE_TIMESTAMP = /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d{1,9}))?$/;

/** Un horodatage déjà porteur d'un fuseau (`Z` ou `±HH:mm`) est repris tel quel. */
const HAS_EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/;

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

/**
 * Convertit un horodatage de log en ISO 8601 UTC.
 * Retourne `null` si la chaîne n'est pas reconnue, à charge de l'appelant de
 * retomber sur l'heure de réception plutôt que d'inventer une date.
 */
export function toUtcIso(rawTimestamp: string, sourceUtcOffsetMinutes = 0): string | null {
  const value = rawTimestamp.trim();
  if (value === '') return null;

  if (HAS_EXPLICIT_ZONE.test(value)) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const match = NAIVE_TIMESTAMP.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day, hours, minutes, seconds, fraction] = match as unknown as string[];
  const milliseconds = fraction ? Number(fraction.slice(0, 3).padEnd(3, '0')) : 0;

  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
    milliseconds,
  );
  if (Number.isNaN(asUtc)) return null;

  // L'horodatage lu est une heure locale de la source : on retire son décalage
  // pour obtenir l'instant UTC correspondant.
  return new Date(asUtc - sourceUtcOffsetMinutes * 60_000).toISOString();
}

/** Horodatage de repli, utilisé quand la ligne n'en porte pas d'exploitable. */
export function nowUtcIso(): string {
  return new Date().toISOString();
}

/** Format nginx : `13/Mar/2026:10:15:32 +0100`. */
const NGINX_MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const NGINX_CLF = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s([+-])(\d{2})(\d{2})$/;

/** Convertit un horodatage nginx "combined" (CLF) en ISO 8601 UTC. */
export function clfToUtcIso(rawTimestamp: string): string | null {
  const match = NGINX_CLF.exec(rawTimestamp.trim());
  if (!match) return null;

  const [, day, monthName, year, hours, minutes, seconds, sign, offsetHours, offsetMinutes] =
    match as unknown as string[];

  const month = NGINX_MONTHS[monthName as string];
  if (month === undefined) return null;

  const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * (sign === '-' ? -1 : 1);
  const asUtc = Date.UTC(Number(year), month, Number(day), Number(hours), Number(minutes), Number(seconds));
  if (Number.isNaN(asUtc)) return null;

  return new Date(asUtc - offset * 60_000).toISOString();
}

/** Recompose `YYYY-MM-DD HH:mm:ss` à partir du format nginx error.log `YYYY/MM/DD HH:mm:ss`. */
export function normalizeSlashDate(value: string): string {
  return value.replace(/^(\d{4})\/(\d{2})\/(\d{2})/, (_m, y: string, mo: string, d: string) => `${y}-${pad(Number(mo))}-${pad(Number(d))}`);
}
