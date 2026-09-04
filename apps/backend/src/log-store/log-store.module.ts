import { Global, Module } from '@nestjs/common';

import { ENV } from '../common/config/config.module';
import type { Env } from '../common/config/env';
import { PrismaService } from '../common/prisma/prisma.service';
import { LOG_STORE, type LogStore } from './log-store.interface';
import { MysqlLogStore } from './mysql-log-store';
import { OpenSearchLogStore } from './opensearch-log-store';

/**
 * Sélection de l'adaptateur de stockage. C'est **le seul endroit** du backend
 * qui connaît les implémentations concrètes : partout ailleurs on injecte
 * `LOG_STORE`, conformément au principe « extensibilité par plugin, pas par
 * branchement conditionnel » (docs/CLAUDE.md §5.1, docs/DECISIONS.md D002).
 */
@Global()
@Module({
  providers: [
    {
      provide: LOG_STORE,
      inject: [ENV, PrismaService],
      useFactory: (env: Env, prisma: PrismaService): LogStore =>
        env.LOG_STORE === 'opensearch' ? new OpenSearchLogStore(env) : new MysqlLogStore(prisma),
    },
  ],
  exports: [LOG_STORE],
})
export class LogStoreModule {}
