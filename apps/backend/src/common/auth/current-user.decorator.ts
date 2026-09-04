import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import { SYSTEM_USER, type RequestUser } from './request-user';

/**
 * `@CurrentUser()` — peuplé par `AuthGuard`. Le repli sur `SYSTEM_USER` couvre
 * les contextes hors HTTP (jobs planifiés, WebSocket) où la requête n'existe pas.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): RequestUser => {
  const request = context.switchToHttp().getRequest<Request>();
  return request.user ?? SYSTEM_USER;
});
