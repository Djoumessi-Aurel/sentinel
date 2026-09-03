import type { LogEntry, LogLevel } from '@sentinel/shared-types';

export type { LogEntry, LogLevel };

export interface ParseContext {
  applicationId: string;
  server: string;
  /**
   * Décalage, en minutes, du fuseau dans lequel l'application source écrit ses
   * horodatages naïfs (sans fuseau explicite dans la ligne de log).
   * Les serveurs du GIE sont en UTC+1, soit 60. Vaut 0 (UTC) par défaut.
   * Tous les `LogEntry.timestamp` produits sont, eux, toujours en UTC.
   */
  sourceUtcOffsetMinutes?: number;
  /** Nom du fichier d'origine, quand l'agent le transmet (nginx : access.log vs error.log). */
  sourceFile?: string;
}

export interface LogParser {
  /** Identifiant du type d'appli géré, ex. `spring-boot`. */
  readonly appType: string;

  /**
   * Parse une ligne brute. Retourne `null` si la ligne ne produit pas d'entrée
   * autonome — typiquement une ligne de stack trace, que l'appelant doit
   * rattacher à l'entrée précédente (voir `isContinuation`).
   */
  parse(rawLine: string, context: ParseContext): LogEntry | null;

  /**
   * Indique qu'une ligne prolonge l'entrée précédente au lieu d'en ouvrir une
   * nouvelle. Le rattachement est fait par l'appelant (module d'ingestion), ce
   * qui garde les parseurs sans état et donc testables et sûrs en concurrence.
   */
  isContinuation?(rawLine: string): boolean;
}
