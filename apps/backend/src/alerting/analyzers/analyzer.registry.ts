import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import type { Analyzer } from './analyzer.interface';

/**
 * Registre des analyseurs — même motif que `ParserRegistry`
 * (docs/LOG_PARSERS.md §3, docs/ALERTING.md §1.6).
 *
 * Contrairement au registre de parseurs, il n'y a **pas de repli** : un type de
 * règle inconnu doit être refusé bruyamment. Retomber sur un analyseur
 * générique produirait des alertes qui ne correspondent pas à ce que
 * l'utilisateur a configuré — pire qu'une erreur franche.
 */
@Injectable()
export class AnalyzerRegistry {
  private readonly logger = new Logger(AnalyzerRegistry.name);
  private readonly analyzers = new Map<string, Analyzer>();

  register(analyzer: Analyzer): void {
    if (this.analyzers.has(analyzer.type)) {
      throw new Error(`Analyseur « ${analyzer.type} » déjà enregistré`);
    }
    this.analyzers.set(analyzer.type, analyzer);
    this.logger.log(`Analyseur enregistré : ${analyzer.type} (${analyzer.mode})`);
  }

  get(type: string): Analyzer {
    const analyzer = this.analyzers.get(type);
    if (!analyzer) {
      throw new BadRequestException(
        `Type de règle inconnu « ${type} ». Types disponibles : ${this.listTypes().join(', ')}`,
      );
    }
    return analyzer;
  }

  has(type: string): boolean {
    return this.analyzers.has(type);
  }

  listTypes(): string[] {
    return [...this.analyzers.keys()].sort();
  }

  listByMode(mode: Analyzer['mode']): Analyzer[] {
    return [...this.analyzers.values()].filter((analyzer) => analyzer.mode === mode);
  }
}
