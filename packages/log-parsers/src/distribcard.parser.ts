import type { LogEntry, ParseContext } from './types';
import { SpringBootParser } from './spring-boot.parser';

/**
 * Motifs métier de distribcard, repris à l'identique des scripts shell de
 * surveillance existants. Ils alimentent `metadata.smsType` / `metadata.outcome`,
 * que l'analyseur générique `pattern-rate` agrège ensuite pour calculer le taux
 * de délivrance (docs/LOG_PARSERS.md §4.2, docs/ALERTING.md §1.2).
 *
 * Aucune logique de seuil ici : le parseur qualifie, l'analyseur décide.
 */
interface BusinessPattern {
  readonly smsType: 'card' | 'pin';
  readonly outcome: 'success' | 'failure';
  readonly pattern: RegExp;
}

const BUSINESS_PATTERNS: readonly BusinessPattern[] = [
  {
    smsType: 'card',
    outcome: 'success',
    pattern: /Notification envoy[ée]e avec succ[èe]s pour la commande de carte/i,
  },
  {
    smsType: 'card',
    outcome: 'failure',
    pattern: /SMS not sent for card availability|card availability notification scheduler failed/i,
  },
  {
    smsType: 'pin',
    outcome: 'success',
    pattern: /Notification envoy[ée]e avec succ[èe]s pour la commande de code/i,
  },
  {
    smsType: 'pin',
    outcome: 'failure',
    pattern: /SMS not sent for pin availability|pin availability notification scheduler failed/i,
  },
];

/**
 * Spécialisation du parseur Spring Boot : même format de ligne, plus
 * l'extraction des motifs métier. Aucune duplication du parsing de base.
 */
export class DistribcardParser extends SpringBootParser {
  constructor() {
    super('distribcard');
  }

  override parse(rawLine: string, context: ParseContext): LogEntry | null {
    const entry = super.parse(rawLine, context);
    if (!entry) return null;

    const matched = BUSINESS_PATTERNS.find((candidate) => candidate.pattern.test(entry.message));
    if (!matched) return entry;

    return {
      ...entry,
      metadata: {
        ...entry.metadata,
        smsType: matched.smsType,
        outcome: matched.outcome,
      },
    };
  }
}

export const distribcardParser = new DistribcardParser();
