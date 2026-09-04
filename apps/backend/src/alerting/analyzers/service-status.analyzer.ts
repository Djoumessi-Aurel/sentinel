import { Injectable } from '@nestjs/common';
import {
  serviceSilenceParamsSchema,
  serviceStatusParamsSchema,
  type AnalyzerResult,
} from '@sentinel/shared-types';

import { durationToMs } from '../../common/duration';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Analyzer, AnalyzerContext } from './analyzer.interface';

/**
 * État d'un service surveillé (docs/ALERTING.md §1.4).
 *
 * Répond directement au besoin d'origine : savoir que `httpd.service` ou
 * `mysqld.service` est tombé sans attendre qu'un utilisateur le signale.
 * Évalué en streaming, à chaque vérification reçue de l'agent.
 */
@Injectable()
export class ServiceStatusAnalyzer implements Analyzer {
  readonly type = 'service-status';
  readonly mode = 'streaming' as const;

  constructor(private readonly prisma: PrismaService) {}

  validateParams(params: unknown): Record<string, unknown> {
    return serviceStatusParamsSchema.parse(params) as unknown as Record<string, unknown>;
  }

  async evaluate(context: AnalyzerContext): Promise<AnalyzerResult> {
    const params = serviceStatusParamsSchema.parse(context.params);

    const service = await this.prisma.monitoredService.findUnique({
      where: { id: params.monitoredServiceId },
      select: { name: true, lastState: true, lastCheckedAt: true, critical: true },
    });
    if (!service) {
      return { triggered: false, severity: params.severity, message: 'Service surveillé introuvable' };
    }

    // Jamais vérifié : ce n'est pas une panne du service, c'est une absence de
    // donnée — c'est `service-silence` qui doit s'en saisir.
    if (service.lastState === null) {
      return {
        triggered: false,
        severity: params.severity,
        message: `Aucune vérification reçue pour ${service.name}`,
        details: { serviceName: service.name, lastState: null },
      };
    }

    const triggered = service.lastState !== params.expectedState;

    return {
      triggered,
      severity: params.severity,
      message: triggered
        ? `Le service ${service.name} est « ${service.lastState} » alors que « ${params.expectedState} » est attendu`
        : `Le service ${service.name} est « ${service.lastState} », conforme`,
      details: {
        serviceName: service.name,
        lastState: service.lastState,
        expectedState: params.expectedState,
        critical: service.critical,
        lastCheckedAt: service.lastCheckedAt?.toISOString() ?? null,
      },
    };
  }
}

/**
 * Absence de vérification reçue pour un service (docs/ALERTING.md §1.5).
 *
 * Cas le plus grave des deux : quand plus aucune vérification n'arrive, on ne
 * sait plus si le service tourne. C'est souvent l'agent ou le serveur lui-même
 * qui est tombé — donc potentiellement toutes les applications de la machine.
 */
@Injectable()
export class ServiceSilenceAnalyzer implements Analyzer {
  readonly type = 'service-silence';
  readonly mode = 'scheduled' as const;

  constructor(private readonly prisma: PrismaService) {}

  validateParams(params: unknown): Record<string, unknown> {
    return serviceSilenceParamsSchema.parse(params) as unknown as Record<string, unknown>;
  }

  async evaluate(context: AnalyzerContext): Promise<AnalyzerResult> {
    const params = serviceSilenceParamsSchema.parse(context.params);

    const service = await this.prisma.monitoredService.findUnique({
      where: { id: params.monitoredServiceId },
      select: { name: true, lastCheckedAt: true, createdAt: true, checkInterval: true },
    });
    if (!service) {
      return { triggered: false, severity: params.severity, message: 'Service surveillé introuvable' };
    }

    const reference = service.lastCheckedAt ?? service.createdAt;
    const silenceMs = context.now.getTime() - reference.getTime();
    const triggered = silenceMs > durationToMs(params.maxSilence);
    const seconds = Math.floor(silenceMs / 1000);

    return {
      triggered,
      severity: params.severity,
      message: triggered
        ? `Aucune vérification de ${service.name} depuis ${seconds} s (seuil ${params.maxSilence}). L'agent ou le serveur est peut-être injoignable : l'état réel du service est inconnu.`
        : `Dernière vérification de ${service.name} il y a ${seconds} s`,
      details: {
        serviceName: service.name,
        silenceSeconds: seconds,
        maxSilence: params.maxSilence,
        lastCheckedAt: service.lastCheckedAt?.toISOString() ?? null,
      },
    };
  }
}
