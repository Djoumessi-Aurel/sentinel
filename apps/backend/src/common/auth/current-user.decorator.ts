import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { RequestUser } from './request-user';

/**
 * `@CurrentUser()` — peuplé par `AuthGuard`.
 *
 * Lève si l'utilisateur est absent plutôt que de retomber sur une valeur par
 * défaut : une route qui attend un utilisateur et n'en reçoit pas révèle un
 * garde manquant, et il vaut mieux le découvrir bruyamment.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): RequestUser => {
  const user = context.switchToHttp().getRequest<Request>().user;
  if (!user) throw new UnauthorizedException('Authentification requise');
  return user;
});
