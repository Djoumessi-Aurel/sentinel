import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { INGESTION_LIMITS } from '@sentinel/shared-types';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ENV } from './common/config/config.module';
import type { Env } from './common/config/env';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LOG_STORE, type LogStore } from './log-store/log-store.interface';
import { SecureIoAdapter } from './realtime/secure-io.adapter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: false });

  const env = app.get<Env>(ENV);

  // En-têtes de sécurité. `contentSecurityPolicy` est désactivée : ce backend ne
  // sert que du JSON, la CSP se règle sur le frontend qui, lui, sert du HTML.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.disable('x-powered-by');

  // Corps de requête borné : les routes d'ingestion sont la principale surface
  // de déni de service du backend (docs/SECURITY.md A04).
  app.useBodyParser('json', { limit: INGESTION_LIMITS.maxBodyBytes });

  app.setGlobalPrefix('api');

  // Origines explicites, jamais `*` — y compris pour le WebSocket, qui reçoit la
  // même liste via son adaptateur (docs/SECURITY.md A05).
  app.enableCors({
    origin: env.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useWebSocketAdapter(new SecureIoAdapter(app, env.CORS_ORIGINS));

  // Pas de `ValidationPipe` global : toute la validation d'entrée passe par les
  // schémas Zod de `packages/shared-types`, appliqués route par route via
  // `zodBody` (docs/SECURITY.md A03). En ajouter un second, adossé à
  // class-validator, n'apporterait aucune protection sur des DTO sans
  // décorateurs, et ferait croire à une couche de contrôle qui ne s'exécute pas.
  app.useGlobalFilters(new AllExceptionsFilter());

  // Prépare le stockage avant d'accepter du trafic : mieux vaut échouer au
  // démarrage que rejeter le premier lot de logs d'un agent.
  await app.get<LogStore>(LOG_STORE).ensureReady();

  app.enableShutdownHooks();
  await app.listen(env.PORT);

  logger.log(`Sentinel démarré sur http://localhost:${env.PORT}/api (environnement : ${env.NODE_ENV})`);
  logger.log(`Origines autorisées : ${env.CORS_ORIGINS.join(', ')}`);
}

void bootstrap();
