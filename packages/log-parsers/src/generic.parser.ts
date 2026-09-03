import type { LogEntry, LogLevel, LogParser, ParseContext } from './types';
import { nowUtcIso, toUtcIso } from './time';

/**
 * Détection de niveau la plus large possible, utilisée par le parseur générique
 * et comme repli par les parseurs spécialisés.
 * Le mot doit être isolé, pour ne pas voir « ERROR » dans « ERRORS_TOTAL=0 ».
 */
const LEVEL_PATTERN = /\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|SEVERE|CRITICAL)\b/i;

const LEVEL_ALIASES: Record<string, LogLevel> = {
  WARNING: 'WARN',
  SEVERE: 'ERROR',
  CRITICAL: 'FATAL',
};

export function detectLevel(line: string): LogLevel {
  const match = LEVEL_PATTERN.exec(line);
  if (!match?.[1]) return 'UNKNOWN';
  const found = match[1].toUpperCase();
  return LEVEL_ALIASES[found] ?? (found as LogLevel);
}

/** Horodatage en début de ligne, quel que soit le séparateur date/heure. */
const LEADING_TIMESTAMP = /^\[?(\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})?)\]?/;

export function extractLeadingTimestamp(line: string, offsetMinutes: number): string | null {
  const match = LEADING_TIMESTAMP.exec(line);
  if (!match?.[1]) return null;
  return toUtcIso(match[1], offsetMinutes);
}

/**
 * Parseur de repli. Utilisé quand aucun parseur spécifique n'est enregistré pour
 * le type d'appli, et comme base des parseurs spécialisés.
 */
export class GenericParser implements LogParser {
  readonly appType: string;

  constructor(appType = 'generic') {
    this.appType = appType;
  }

  parse(rawLine: string, context: ParseContext): LogEntry | null {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') return null;

    const offset = context.sourceUtcOffsetMinutes ?? 0;
    const timestamp = extractLeadingTimestamp(line, offset) ?? nowUtcIso();

    return {
      timestamp,
      level: detectLevel(line),
      message: line.trim(),
      raw: rawLine,
    };
  }
}

export const genericParser = new GenericParser();
