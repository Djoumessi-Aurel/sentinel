import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { ENV } from '../common/config/config.module';
import type { Env } from '../common/config/env';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevDirectory } from './directory/dev.directory';
import { DIRECTORY, type Directory } from './directory/directory.interface';
import { LdapDirectory } from './directory/ldap.directory';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * Module d'authentification (docs/AUTH.md).
 *
 * Global, parce que `AuthGuard` est appliqué par tous les contrôleurs : sans
 * cela, chacun devrait importer ce module, et un oubli laisserait une route
 * ouverte sans que rien ne le signale.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.AUTH_JWT_SECRET,
        signOptions: { issuer: 'sentinel', audience: 'sentinel' },
        verifyOptions: { issuer: 'sentinel', audience: 'sentinel' },
      }),
    }),
  ],
  controllers: [AuthController, UsersController],
  providers: [
    AuthService,
    UsersService,
    AuthGuard,
    RolesGuard,
    {
      // Seul endroit connaissant les implémentations concrètes de l'annuaire :
      // le code métier ne voit que l'interface (docs/CLAUDE.md §5.1).
      provide: DIRECTORY,
      inject: [ENV],
      useFactory: (env: Env): Directory => (env.AUTH_MODE === 'ldap' ? new LdapDirectory(env) : new DevDirectory()),
    },
  ],
  exports: [AuthService, UsersService, AuthGuard, RolesGuard, DIRECTORY],
})
export class AuthModule {}
