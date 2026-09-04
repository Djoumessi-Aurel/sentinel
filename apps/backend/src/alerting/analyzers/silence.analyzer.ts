import { Injectable } from '@nestjs/common';
import { silenceParamsSchema, type AnalyzerResult } from '@sentinel/shared-types';

import { durationToMs } from '../../common/duration';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Analyzer, AnalyzerContext } from './analyzer.interface';

/**
 * Watchdog d'absence de logs (docs/ALERTING.md §1.3).
 *
 * C'est la règle qui répond au principe « rien ne doit échouer silencieusement »
 * (docs/CLAUDE.md §5.4). Un agent arrêté, un serveur éteint ou un fichier de log
 * qui a cessé d'être alimenté ne produisent **aucune erreur** : l'écran reste
 * simplement figé, ce qui passe facilement pour du calme. Sans cette règle, la
 * supervision s'arrête sans que personne ne le sache.
 */
@Injectable()
export class SilenceAnalyzer implements Analyzer {
  readonly type = 'silence';
  readonly mode = 'scheduled' as const;

  constructor(private readonly prisma: PrismaService) {}

  validateParams(params: unknown): Record<string, unknown> {
    return silenceParamsSchema.parse(params) as unknown as Record<string, unknown>;
  }

  async evaluate(context: AnalyzerContext): Promise<AnalyzerResult> {
    const params = silenceParamsSchema.parse(context.params);

    const application = await this.prisma.application.findUnique({
      where: { id: context.applicationId },
      select: { lastLogAt: true, createdAt: true },
    });
    if (!application) {
      return { triggered: false, severity: params.severity, message: 'Application introuvable' };
    }

    const maxSilenceMs = durationToMs(params.maxSilence);

    // Aucun log reçu depuis la création : on laisse le temps de l'installation
    // de l'agent avant d'alerter, en comptant le délai depuis la création.
    const reference = application.lastLogAt ?? application.createdAt;
    const silenceMs = context.now.getTime() - reference.getTime();
    const triggered = silenceMs > maxSilenceMs;

    const minutes = Math.floor(silenceMs / 60_000);
    const origin = application.lastLogAt ? 'dernier log reçu' : 'création de l’application';

    return {
      triggered,
      severity: params.severity,
      message: triggered
        ? `Aucun log depuis ${minutes} minute(s) (${origin}), au-delà du seuil de ${params.maxSilence}. L'agent ou le serveur est peut-être arrêté.`
        : `Dernière activité il y a ${minutes} minute(s), sous le seuil de ${params.maxSilence}`,
      details: {
        silenceMinutes: minutes,
        maxSilence: params.maxSilence,
        lastLogAt: application.lastLogAt?.toISOString() ?? null,
      },
    };
  }
}
