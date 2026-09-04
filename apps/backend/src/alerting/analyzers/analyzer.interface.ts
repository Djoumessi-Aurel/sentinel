import type { AnalyzerResult } from '@sentinel/shared-types';

/**
 * Contrat d'un analyseur (docs/ALERTING.md §1.6).
 *
 * Ajouter un type de règle = ajouter une classe et l'enregistrer, sans jamais
 * toucher au moteur ni aux notificateurs (docs/CLAUDE.md §5.1). Aucun analyseur
 * ne doit contenir de logique propre à une application donnée : toute variation
 * passe par `params`, validés par `paramsSchema`.
 */

export interface AnalyzerContext {
  applicationId: string;
  applicationType: string;
  ruleId: string;
  ruleName: string;
  params: Record<string, unknown>;
  /** Instant d'évaluation, injecté pour rendre les analyseurs testables. */
  now: Date;
}

export type AnalyzerMode =
  /** Évalué à chaque événement reçu — détection immédiate. */
  | 'streaming'
  /** Évalué périodiquement par le planificateur — fenêtres glissantes. */
  | 'scheduled';

export interface Analyzer {
  readonly type: string;
  readonly mode: AnalyzerMode;

  /** Schéma Zod des `params`, utilisé à la création et à la modification d'une règle. */
  validateParams(params: unknown): Record<string, unknown>;

  evaluate(context: AnalyzerContext): Promise<AnalyzerResult>;
}
