import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

/**
 * Point d'ancrage du futur module d'authentification (docs/AUTH.md).
 * En Phase 1-3 il n'expose que le garde ; en Phase 4, seul le contenu du garde
 * change, aucune route n'est à reprendre.
 */
@Global()
@Module({
  providers: [AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
