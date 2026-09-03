import type { LogEntry, LogLevel, LogParser, ParseContext } from './types';
import { nowUtcIso, toUtcIso } from './time';
import { detectLevel } from './generic.parser';

/**
 * Format logback typique :
 *   2026-03-13 10:15:32.123  INFO 12345 --- [main] c.example.Service : message
 *   2026-03-13 10:15:32.123 ERROR [main] c.example.Service - message
 *
 * Le séparateur avant le message est `-` ou `:`, précédé du logger. On capture
 * séparément le bloc intermédiaire pour en extraire thread et logger en metadata.
 */
const SPRING_BOOT_LINE =
  /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d{1,9})?)\s+(TRACE|DEBUG|INFO|WARN|ERROR|FATAL)\s+(.*)$/;

/** Bloc intermédiaire : `12345 --- [thread] logger : reste` ou `[thread] logger - reste`. */
const TAIL = /^(?:\d+\s+---\s+)?(?:\[(?<thread>[^\]]+)\]\s*)?(?<logger>[\w$.]+)?\s*[-:]\s?(?<message>[\s\S]*)$/;

/** Une nouvelle entrée commence toujours par une date : tout le reste prolonge la précédente. */
const STARTS_ENTRY = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/;

export class SpringBootParser implements LogParser {
  readonly appType: string;

  constructor(appType = 'spring-boot') {
    this.appType = appType;
  }

  isContinuation(rawLine: string): boolean {
    const line = rawLine.replace(/\r$/, '');
    return line.trim() !== '' && !STARTS_ENTRY.test(line);
  }

  parse(rawLine: string, context: ParseContext): LogEntry | null {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') return null;

    const offset = context.sourceUtcOffsetMinutes ?? 0;
    const match = SPRING_BOOT_LINE.exec(line);

    if (!match) {
      // Ligne hors format (bannière de démarrage, sortie d'un autre outil) :
      // on la conserve plutôt que de la perdre, avec le parsing générique.
      return {
        timestamp: nowUtcIso(),
        level: detectLevel(line),
        message: line.trim(),
        raw: rawLine,
      };
    }

    const [, rawTimestamp, rawLevel, tail] = match as unknown as string[];
    const timestamp = toUtcIso(rawTimestamp as string, offset) ?? nowUtcIso();
    const level = (rawLevel as string).toUpperCase() as LogLevel;

    const tailMatch = TAIL.exec(tail as string);
    const message = (tailMatch?.groups?.['message'] ?? tail ?? '').trim();
    const thread = tailMatch?.groups?.['thread'];
    const logger = tailMatch?.groups?.['logger'];

    const metadata: Record<string, string> = {};
    if (thread) metadata['thread'] = thread;
    if (logger) metadata['logger'] = logger;

    const entry: LogEntry = {
      timestamp,
      level,
      message: message === '' ? (tail as string).trim() : message,
      raw: rawLine,
    };
    if (Object.keys(metadata).length > 0) {
      entry.metadata = metadata;
    }
    return entry;
  }
}

export const springBootParser = new SpringBootParser();

/**
 * `java-simple` partage le format logback : même parseur, type distinct pour que
 * l'utilisateur puisse choisir explicitement dans l'interface et que le template
 * Vector associé diffère (chemins de logs différents).
 */
export const javaSimpleParser = new SpringBootParser('java-simple');
