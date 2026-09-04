import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../common/prisma/prisma.service';
import { LOG_STORE, type LogStore } from '../log-store/log-store.interface';
import { SettingsService } from '../settings/settings.service';

export interface PurgeReport {
  logs: number;
  resolvedAlerts: number;
  serviceEvents: number;
}

/**
 * Purge des données au-delà de la durée de rétention (docs/DATA_MODEL.md §4).
 *
 * Sans elle, le stockage croît indéfiniment : la question n'est pas de savoir
 * *si* le disque se remplira, mais quand — et l'outil censé détecter les pannes
 * tomberait alors lui-même, au pire moment.
 *
 * Les durées viennent de la configuration globale, donc modifiables depuis
 * l'interface sans redéploiement.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(LOG_STORE) private readonly logStore: LogStore,
  ) {}

  /**
   * Purge quotidienne, à 3 h du matin.
   *
   * Volontairement en heures creuses : une suppression massive sollicite le
   * stockage, et le faire en pleine journée ralentirait l'ingestion et les
   * recherches au moment où l'outil sert le plus.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'retention-purge' })
  async scheduledPurge(): Promise<void> {
    await this.purge();
  }

  /** Exécute la purge. Ne lève jamais : un échec ne doit pas arrêter le backend. */
  async purge(now: Date = new Date()): Promise<PurgeReport | null> {
    if (this.running) {
      this.logger.warn('Purge déjà en cours : exécution ignorée');
      return null;
    }
    this.running = true;

    try {
      const { retention } = await this.settings.getGlobal();
      const limite = (jours: number) => new Date(now.getTime() - jours * 86_400_000);

      const logs = await this.logStore.purge(limite(retention.logsDays));

      // Seules les alertes **résolues** sont purgées : une alerte encore active
      // décrit un incident en cours, quel que soit son âge.
      const { count: resolvedAlerts } = await this.prisma.alertEvent.deleteMany({
        where: { resolvedAt: { not: null, lt: limite(retention.resolvedAlertsDays) } },
      });

      const { count: serviceEvents } = await this.prisma.serviceStatusEvent.deleteMany({
        where: { changedAt: { lt: limite(retention.serviceEventsDays) } },
      });

      const report: PurgeReport = { logs, resolvedAlerts, serviceEvents };

      if (logs + resolvedAlerts + serviceEvents > 0) {
        this.logger.log(
          `Purge : ${logs} log(s) au-delà de ${retention.logsDays} j, ` +
            `${resolvedAlerts} alerte(s) résolue(s) au-delà de ${retention.resolvedAlertsDays} j, ` +
            `${serviceEvents} transition(s) de service au-delà de ${retention.serviceEventsDays} j`,
        );
      }

      return report;
    } catch (error) {
      this.logger.error(`Purge en échec : ${error instanceof Error ? error.message : String(error)}`);
      return null;
    } finally {
      this.running = false;
    }
  }
}
