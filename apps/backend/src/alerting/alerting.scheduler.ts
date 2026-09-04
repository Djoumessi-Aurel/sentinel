import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../common/prisma/prisma.service';
import { AlertingService } from './alerting.service';
import { AnalyzerRegistry } from './analyzers/analyzer.registry';

/**
 * Évaluation périodique des règles à fenêtre glissante (docs/ARCHITECTURE.md §7).
 *
 * Deux cadences distinctes, et ce n'est pas un détail :
 *  - les silences se vérifient **toutes les minutes**, parce que leur seuil est
 *    de l'ordre de la minute ; les vérifier toutes les 5 minutes ajouterait
 *    jusqu'à 5 minutes de retard à la détection d'un agent tombé ;
 *  - les taux (`pattern-rate`) portent sur des fenêtres d'heures ou de jours :
 *    les recalculer chaque minute coûterait des agrégations pour rien.
 */
@Injectable()
export class AlertingScheduler {
  private readonly logger = new Logger(AlertingScheduler.name);
  /** Empêche deux passes concurrentes si une évaluation dépasse son intervalle. */
  private running = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly alerting: AlertingService,
    private readonly registry: AnalyzerRegistry,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'silence-watchdog' })
  async evaluateSilenceRules(): Promise<void> {
    await this.runPass('silence-watchdog', ['silence', 'service-silence']);
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'rate-rules' })
  async evaluateRateRules(): Promise<void> {
    const scheduledTypes = this.registry
      .listByMode('scheduled')
      .map((analyzer) => analyzer.type)
      .filter((type) => type !== 'silence' && type !== 'service-silence');

    if (scheduledTypes.length > 0) {
      await this.runPass('rate-rules', scheduledTypes);
    }
  }

  private async runPass(passName: string, types: string[]): Promise<void> {
    if (this.running.has(passName)) {
      this.logger.warn(`Passe « ${passName} » encore en cours : exécution suivante ignorée`);
      return;
    }
    this.running.add(passName);

    try {
      const rules = await this.prisma.analyzerRule.findMany({
        where: {
          enabled: true,
          type: { in: types },
          // Les applis en pause ou archivées ne doivent plus alerter : sinon
          // mettre une appli en maintenance déclencherait aussitôt un silence.
          application: { status: 'active' },
        },
        include: { application: { select: { name: true, type: true } } },
      });

      const now = new Date();
      for (const rule of rules) {
        await this.alerting.evaluateRule(rule, now);
      }
    } catch (error) {
      this.logger.error(
        `Passe « ${passName} » interrompue : ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running.delete(passName);
    }
  }
}
