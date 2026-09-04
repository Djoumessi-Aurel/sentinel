import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { AlertingModule } from './alerting/alerting.module';
import { ApplicationsModule } from './applications/applications.module';
import { AppConfigModule } from './common/config/config.module';
import { AuthModule } from './common/auth/auth.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { HealthController } from './health.controller';
import { IngestionModule } from './ingestion/ingestion.module';
import { LogStoreModule } from './log-store/log-store.module';
import { LogsQueryModule } from './logs-query/logs-query.module';
import { MonitoredServicesModule } from './monitored-services/monitored-services.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedactionModule } from './redaction/redaction.module';
import { ServersModule } from './servers/servers.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthModule,
    RedactionModule,
    LogStoreModule,

    // Limitation de débit globale (docs/SECURITY.md A04). Le quota nommé
    // `ingestion` est bien plus large : un agent Vector émet légitimement un lot
    // toutes les deux secondes, là où le quota par défaut vise un usage humain.
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
      { name: 'ingestion', ttl: 60_000, limit: 300 },
    ]),

    EventEmitterModule.forRoot({ wildcard: false, maxListeners: 20 }),
    ScheduleModule.forRoot(),

    SettingsModule,
    ServersModule,
    ApplicationsModule,
    AlertingModule,
    MonitoredServicesModule,
    IngestionModule,
    LogsQueryModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
