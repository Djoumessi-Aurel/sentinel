import type { LogParser } from './types';

/**
 * Registre des parseurs. Ajouter un type d'appli = enregistrer un parseur, sans
 * jamais toucher au moteur d'ingestion ni au moteur de règles
 * (docs/CLAUDE.md §5.1, docs/LOG_PARSERS.md §3).
 */
export class ParserRegistry {
  private readonly parsers = new Map<string, LogParser>();
  private fallback: LogParser | null = null;

  register(parser: LogParser): void {
    this.parsers.set(parser.appType, parser);
  }

  /** Parseur utilisé quand aucun parseur n'est enregistré pour un type donné. */
  setFallback(parser: LogParser): void {
    this.fallback = parser;
    this.parsers.set(parser.appType, parser);
  }

  has(appType: string): boolean {
    return this.parsers.has(appType);
  }

  /**
   * Retourne le parseur du type demandé, ou le parseur de repli.
   * Ne lève jamais : un type inconnu ne doit pas faire perdre des logs, la
   * détection générique reste préférable à une exception d'ingestion.
   */
  get(appType: string): LogParser {
    const parser = this.parsers.get(appType);
    if (parser) return parser;
    if (this.fallback) return this.fallback;
    throw new Error(`Aucun parseur enregistré pour le type '${appType}' et aucun parseur de repli défini`);
  }

  /** Types disponibles, exposés par l'API pour alimenter le formulaire de création d'appli. */
  listTypes(): string[] {
    return [...this.parsers.keys()].sort();
  }
}

export const parserRegistry = new ParserRegistry();
