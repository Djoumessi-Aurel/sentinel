import type { LogEntry, LogLevel, LogParser, ParseContext } from './types';
import { clfToUtcIso, nowUtcIso, normalizeSlashDate, toUtcIso } from './time';

/** `2026/03/13 10:15:32 [error] 1234#0: *1 message` */
const NGINX_ERROR =
  /^(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})\s+\[(emerg|alert|crit|error|warn|notice|info|debug)\]\s+(.*)$/;

/** Format « combined » : host - user [date] "METHOD path proto" status bytes "referer" "ua" */
const NGINX_ACCESS =
  /^(\S+) \S+ (\S+) \[([^\]]+)\] "(?:(\S+) (\S+)(?: (\S+))?)?" (\d{3}) (\d+|-)/;

const ERROR_LEVELS: Record<string, LogLevel> = {
  emerg: 'FATAL',
  alert: 'FATAL',
  crit: 'FATAL',
  error: 'ERROR',
  warn: 'WARN',
  notice: 'INFO',
  info: 'INFO',
  debug: 'DEBUG',
};

/**
 * Nginx, pour un frontend statique type React.
 *
 * Les deux fichiers n'ont pas le même rôle : `error.log` porte les erreurs
 * serveur, `access.log` n'est pas une source d'erreur applicative mais alimente
 * un analyseur `pattern-rate` sur le code HTTP (docs/LOG_PARSERS.md §4.4).
 * On reconnaît le format par la ligne elle-même, sans dépendre du nom de
 * fichier, qui n'est pas toujours transmis par l'agent.
 */
export class ReactNginxParser implements LogParser {
  readonly appType = 'react-nginx';

  parse(rawLine: string, context: ParseContext): LogEntry | null {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') return null;

    const offset = context.sourceUtcOffsetMinutes ?? 0;

    const errorMatch = NGINX_ERROR.exec(line);
    if (errorMatch) {
      const [, rawTimestamp, severity, message] = errorMatch as unknown as string[];
      return {
        timestamp: toUtcIso(normalizeSlashDate(rawTimestamp as string), offset) ?? nowUtcIso(),
        level: ERROR_LEVELS[severity as string] ?? 'ERROR',
        message: (message as string).trim(),
        raw: rawLine,
        metadata: { source: 'error.log', nginxLevel: severity as string },
      };
    }

    const accessMatch = NGINX_ACCESS.exec(line);
    if (accessMatch) {
      const [, remoteAddr, , rawTimestamp, method, path, , statusText, bytes] = accessMatch as unknown as string[];
      const status = Number(statusText);

      const metadata: Record<string, string | number | boolean> = {
        source: 'access.log',
        status,
        statusClass: `${Math.floor(status / 100)}xx`,
        remoteAddr: remoteAddr as string,
      };
      if (method) metadata['method'] = method;
      if (path) metadata['path'] = path;
      if (bytes && bytes !== '-') metadata['bytes'] = Number(bytes);

      return {
        timestamp: clfToUtcIso(rawTimestamp as string) ?? nowUtcIso(),
        // Un 5xx est une erreur serveur, un 4xx reste une requête cliente.
        level: status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO',
        message: `${method ?? '-'} ${path ?? '-'} → ${status}`,
        raw: rawLine,
        metadata,
      };
    }

    return {
      timestamp: nowUtcIso(),
      level: 'UNKNOWN',
      message: line.trim(),
      raw: rawLine,
    };
  }
}

export const reactNginxParser = new ReactNginxParser();
