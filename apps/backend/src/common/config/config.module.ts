import { Global, Module } from '@nestjs/common';

import { validateEnv, type Env } from './env';

/** Jeton d'injection de la configuration validée. */
export const ENV = Symbol('ENV');

/**
 * Expose l'environnement **déjà validé** comme un objet typé unique.
 *
 * On préfère cela à `ConfigService.get()` : la validation Zod a lieu une seule
 * fois au démarrage (docs/SECURITY.md A05), et les consommateurs reçoivent un
 * objet dont TypeScript connaît la forme exacte — plus de clé mal orthographiée
 * qui renverrait `undefined` à l'exécution.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => validateEnv(process.env),
    },
  ],
  exports: [ENV],
})
export class AppConfigModule {}
