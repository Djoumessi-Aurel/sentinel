import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { ENV } from './common/config/config.module';
import type { Env } from './common/config/env';
import { PrismaService } from './common/prisma/prisma.service';
import { LOG_STORE, type LogStore } from './log-store/log-store.interface';

/**
 * Sonde de disponibilité, volontairement **hors du garde d'authentification** :
 * un superviseur externe ou un reverse proxy doit pouvoir l'interroger sans
 * secret. Elle ne divulgue donc aucune information exploitable — ni version, ni
 * URL de base, ni détail d'erreur (docs/SECURITY.md A05).
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOG_STORE) private readonly logStore: LogStore,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  async check(): Promise<{ status: 'ok' | 'degraded'; database: boolean; logStore: string }> {
    let database = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = false;
    }

    return {
      status: database ? 'ok' : 'degraded',
      database,
      logStore: this.logStore.kind,
    };
  }
}
