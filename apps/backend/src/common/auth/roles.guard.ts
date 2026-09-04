import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@sentinel/shared-types';
import type { Request } from 'express';

import { REQUIRED_ROLES } from './roles.decorator';

/**
 * Contrôle du rôle, séparé de l'authentification (docs/AUTH.md §2.5).
 *
 * Sans annotation `@Roles`, une route est accessible à tout utilisateur
 * authentifié — c'est le cas des lectures. Les écritures portent `@Roles('admin')`.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requis = this.reflector.getAllAndOverride<UserRole[] | undefined>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requis || requis.length === 0) return true;

    const user = context.switchToHttp().getRequest<Request>().user;
    // Sans utilisateur, c'est `AuthGuard` qui aurait dû refuser : on ne laisse
    // pas passer par défaut si l'ordre des gardes venait à changer.
    if (!user) throw new ForbiddenException('Accès refusé');

    if (!requis.includes(user.role)) {
      throw new ForbiddenException(
        `Cette action requiert le rôle ${requis.join(' ou ')}. Votre rôle est « ${user.role} ».`,
      );
    }
    return true;
  }
}
