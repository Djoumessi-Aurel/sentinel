import { Inject, Injectable } from '@nestjs/common';
import { patternRateParamsSchema, type AnalyzerResult, type PatternRateParams } from '@sentinel/shared-types';

import { windowStart } from '../../common/duration';
import { LOG_STORE, type LogStore } from '../../log-store/log-store.interface';
import type { Analyzer, AnalyzerContext } from './analyzer.interface';

/**
 * Taux de réussite sur une fenêtre glissante (docs/ALERTING.md §1.2).
 *
 * Reproduit le calcul des scripts de surveillance de distribcard
 * (`taux = succès / (succès + échecs) × 100`), mais **sans une ligne de code
 * spécifique à distribcard** : les champs comparés viennent de `params`. La même
 * règle sert donc au taux de SMS carte, au taux de SMS pin, ou à un futur taux
 * de 5xx sur du nginx — seule la configuration change (docs/CLAUDE.md §8).
 */
@Injectable()
export class PatternRateAnalyzer implements Analyzer {
  readonly type = 'pattern-rate';
  readonly mode = 'scheduled' as const;

  constructor(@Inject(LOG_STORE) private readonly logStore: LogStore) {}

  validateParams(params: unknown): Record<string, unknown> {
    return patternRateParamsSchema.parse(params) as unknown as Record<string, unknown>;
  }

  async evaluate(context: AnalyzerContext): Promise<AnalyzerResult> {
    const params = patternRateParamsSchema.parse(context.params);
    const from = windowStart(params.window, context.now);

    const [successes, failures] = await Promise.all([
      this.logStore.count({
        applicationId: context.applicationId,
        from,
        to: context.now,
        metadata: this.toMetadataFilter(params.successMatch),
      }),
      this.logStore.count({
        applicationId: context.applicationId,
        from,
        to: context.now,
        metadata: this.toMetadataFilter(params.failureMatch),
      }),
    ]);

    const total = successes + failures;

    // Sans volume suffisant, un taux n'a aucun sens : deux échecs sur trois
    // envois donneraient 33 % et déclencheraient une alerte critique alors que
    // rien ne permet de conclure. On ne déclenche pas, et on le dit.
    if (total < params.minSamples) {
      return {
        triggered: false,
        severity: params.severity,
        message: `Échantillon insuffisant sur ${params.window} : ${total} événement(s) pour un minimum de ${params.minSamples}`,
        details: { successes, failures, total, minSamples: params.minSamples },
      };
    }

    const rate = (successes / total) * 100;
    const triggered = this.compare(rate, params.operator, params.threshold);

    return {
      triggered,
      severity: params.severity,
      message: triggered
        ? `Taux de réussite de ${rate.toFixed(2)} % sur ${params.window} (${successes}/${total}), seuil ${this.operatorLabel(params.operator)} ${params.threshold} %`
        : `Taux de réussite de ${rate.toFixed(2)} % sur ${params.window} (${successes}/${total}), conforme au seuil de ${params.threshold} %`,
      details: { rate: Number(rate.toFixed(4)), successes, failures, total, threshold: params.threshold },
    };
  }

  /** `{ field: 'metadata.smsType', equals: 'card', outcome: 'success' }` → filtre plat. */
  private toMetadataFilter(match: PatternRateParams['successMatch']): Record<string, string | number | boolean> {
    const field = match.field.replace(/^metadata\./, '');
    return { [field]: match.equals, outcome: match.outcome };
  }

  private compare(value: number, operator: PatternRateParams['operator'], threshold: number): boolean {
    switch (operator) {
      case 'lt':
        return value < threshold;
      case 'lte':
        return value <= threshold;
      case 'gt':
        return value > threshold;
      case 'gte':
        return value >= threshold;
    }
  }

  private operatorLabel(operator: PatternRateParams['operator']): string {
    return { lt: '<', lte: '≤', gt: '>', gte: '≥' }[operator];
  }
}
