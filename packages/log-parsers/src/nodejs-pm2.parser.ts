import type { LogEntry, LogLevel, LogParser, ParseContext } from './types';
import { nowUtcIso, toUtcIso } from './time';
import { detectLevel, extractLeadingTimestamp } from './generic.parser';

/** Champs couramment utilisés par pino, winston et bunyan pour le message. */
const MESSAGE_FIELDS = ['message', 'msg'] as const;
const LEVEL_FIELDS = ['level', 'severity', 'levelname'] as const;
const TIMESTAMP_FIELDS = ['timestamp', 'time', '@timestamp'] as const;

/** pino encode le niveau en nombre. */
const PINO_LEVELS: Record<number, LogLevel> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

const RESERVED = new Set<string>([...MESSAGE_FIELDS, ...LEVEL_FIELDS, ...TIMESTAMP_FIELDS, 'v', 'pid', 'hostname']);

function normalizeLevel(value: unknown): LogLevel | null {
  if (typeof value === 'number') return PINO_LEVELS[value] ?? null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const upper = value.trim().toUpperCase();
  return upper === 'WARNING' ? 'WARN' : (upper as LogLevel);
}

function normalizeTimestamp(value: unknown, offsetMinutes: number): string | null {
  if (typeof value === 'number') {
    // pino écrit un epoch en millisecondes : instant absolu, aucun décalage à appliquer.
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string') return toUtcIso(value, offsetMinutes);
  return null;
}

/**
 * Logs Node sous PM2. Deux cas gérés, JSON prioritaire (docs/LOG_PARSERS.md §4.3) :
 * une appli qui logge en JSON structuré donne un niveau fiable, sinon on retombe
 * sur la détection par mot-clé.
 */
export class NodePm2Parser implements LogParser {
  readonly appType = 'nodejs-pm2';

  parse(rawLine: string, context: ParseContext): LogEntry | null {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (trimmed === '') return null;

    const offset = context.sourceUtcOffsetMinutes ?? 0;

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const structured = this.parseJson(trimmed, rawLine, offset);
      if (structured) return structured;
    }

    return {
      timestamp: extractLeadingTimestamp(line, offset) ?? nowUtcIso(),
      level: detectLevel(line),
      message: trimmed,
      raw: rawLine,
    };
  }

  private parseJson(trimmed: string, rawLine: string, offset: number): LogEntry | null {
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      // Ligne qui ressemble à du JSON sans en être : on laisse le repli texte agir.
      return null;
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;

    const record = payload as Record<string, unknown>;

    const message = MESSAGE_FIELDS.map((field) => record[field]).find((value) => typeof value === 'string');
    if (typeof message !== 'string') return null;

    const level = LEVEL_FIELDS.map((field) => record[field])
      .map(normalizeLevel)
      .find((value): value is LogLevel => value !== null);

    const timestamp = TIMESTAMP_FIELDS.map((field) => record[field])
      .map((value) => normalizeTimestamp(value, offset))
      .find((value): value is string => value !== null);

    const metadata: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(record)) {
      if (RESERVED.has(key)) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        metadata[key] = value;
      }
    }

    const entry: LogEntry = {
      timestamp: timestamp ?? nowUtcIso(),
      level: level ?? 'UNKNOWN',
      message,
      raw: rawLine,
    };
    if (Object.keys(metadata).length > 0) {
      entry.metadata = metadata;
    }
    return entry;
  }
}

export const nodePm2Parser = new NodePm2Parser();
