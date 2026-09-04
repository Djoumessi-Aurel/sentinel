import { Inject, Injectable } from '@nestjs/common';
import { levelThresholdParamsSchema, type AnalyzerResult } from '@sentinel/shared-types';

import { windowStart } from '../../common/duration';
import { LOG_STORE, type LogStore } from '../../log-store/log-store.interface';
import type { Analyzer, AnalyzerContext } from './analyzer.interface';

/**
 * « S'il y a une ERROR, il y a forcément un problème » — la règle de base,
 * créée par défaut sur toute nouvelle application (docs/ALERTING.md §1.1).
 *
 * En mode `streaming` : évaluée à chaque lot de logs reçu, pour une détection
 * immédiate plutôt qu'à la prochaine passe du planificateur.
 */
@Injectable()
export class LevelThresholdAnalyzer implements Analyzer {
  readonly type = 'level-threshold';
  readonly mode = 'streaming' as const;

  constructor(@Inject(LOG_STORE) private readonly logStore: LogStore) {}

  validateParams(params: unknown): Record<string, unknown> {
    return levelThresholdParamsSchema.parse(params) as unknown as Record<string, unknown>;
  }

  async evaluate(context: AnalyzerContext): Promise<AnalyzerResult> {
    const params = levelThresholdParamsSchema.parse(context.params);

    const count = await this.logStore.count({
      applicationId: context.applicationId,
      from: windowStart(params.window, context.now),
      to: context.now,
      level: params.level,
    });

    const triggered = count >= params.minCount;

    return {
      triggered,
      severity: params.severity,
      message: triggered
        ? `${count} log(s) de niveau ${params.level} sur les ${params.window} écoulées (seuil : ${params.minCount})`
        : `${count} log(s) de niveau ${params.level} sur les ${params.window} écoulées, sous le seuil de ${params.minCount}`,
      details: { count, level: params.level, window: params.window, minCount: params.minCount },
    };
  }
}
