import { Injectable } from '@nestjs/common';
import type { ApplicationHealth } from '@sentinel/shared-types';

import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Statut agrégé d'une application (docs/ALERTING.md §5).
 *
 * Il combine deux sources de nature différente — les alertes actives issues des
 * logs, et l'état courant des services surveillés — parce qu'un opérateur ne
 * veut pas savoir *d'où* vient le problème pour savoir *qu'il y en a un*.
 */
@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async computeHealth(applicationId: string): Promise<ApplicationHealth> {
    const [activeAlerts, services] = await Promise.all([
      this.prisma.alertEvent.findMany({
        where: { applicationId, resolvedAt: null },
        select: { severity: true },
      }),
      this.prisma.monitoredService.findMany({
        where: { applicationId, critical: true },
        select: { lastState: true },
      }),
    ]);

    // Un service critique dont l'état connu n'est pas `active` fait basculer
    // l'appli en critique. `lastState` à null signifie « jamais vérifié » : on
    // ne préjuge pas d'une panne tant qu'aucune vérification n'est arrivée,
    // c'est la règle `service-silence` qui couvre ce cas.
    const criticalDown = services.some((service) => service.lastState !== null && service.lastState !== 'active');
    if (criticalDown) return 'critical';

    const severities = activeAlerts.map((alert) => alert.severity);
    if (severities.includes('critical')) return 'critical';
    if (severities.length > 0) return 'warning';
    return 'ok';
  }
}
