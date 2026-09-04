import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AuthService } from '../../auth/auth.service';
import { PUBLIC_ROUTE } from './public.decorator';
import { toRequestUser, type RequestUser } from './request-user';

declare module 'express' {
  interface Request {
    user?: RequestUser;
  }
}

/** Nom du cookie de session. */
export const SESSION_COOKIE = 'sentinel_session';

/**
 * Garde d'authentification des routes d'administration.
 *
 * Ce garde existe depuis le premier commit du backend. Il laissait alors tout
 * passer, en peuplant `request.user` avec un utilisateur factice, pour que les
 * contrôleurs puissent s'écrire dès la Phase 1 dans leur forme définitive. Son
 * contenu est aujourd'hui remplacé par la vérification réelle : **aucune route
 * n'a eu à être modifiée**, ce qui valide a posteriori la préparation faite dès
 * le départ (docs/AUTH.md §1 et §2.5).
 *
 * Le rôle et l'état du compte sont relus à chaque requête, jamais repris du
 * jeton : désactiver un utilisateur prend effet immédiatement.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const estPublique = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (estPublique) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Session absente');

    const user = await this.auth.resolveSession(token);
    if (!user) throw new UnauthorizedException('Session expirée ou révoquée');

    request.user = toRequestUser(user);
    return true;
  }

  /**
   * Le jeton est lu dans un cookie `HttpOnly`, inaccessible au JavaScript de la
   * page : un script injecté ne peut donc pas le dérober (docs/SECURITY.md A02).
   */
  private extractToken(request: Request): string | null {
    const cookies = request.cookies as Record<string, string> | undefined;
    return cookies?.[SESSION_COOKIE] ?? null;
  }
}
