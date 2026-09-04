import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

import { SYSTEM_USER, type RequestUser } from './request-user';

declare module 'express' {
  interface Request {
    user?: RequestUser;
  }
}

/**
 * Garde d'autorisation des routes d'administration.
 *
 * En Phase 1-3, il **laisse tout passer** : il n'y a pas encore de module
 * utilisateur (docs/AUTH.md §1). Son rôle est structurel — il occupe dès
 * maintenant la place où le contrôle réel s'installera, et peuple
 * `request.user`, de sorte qu'aucune route n'aura à changer de signature en
 * Phase 4. C'est pourquoi il ne faut jamais écrire de route sans lui, même
 * provisoirement.
 *
 * Conséquence assumée et documentée (docs/SECURITY.md A07) : tant que la
 * Phase 4 n'est pas livrée, l'application ne doit pas être exposée hors du
 * réseau interne.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private warned = false;

  canActivate(context: ExecutionContext): boolean {
    if (!this.warned) {
      this.warned = true;
      this.logger.warn(
        "Authentification non implémentée (Phase 1-3) : toutes les routes d'administration sont ouvertes. " +
          "Ne pas exposer ce backend hors du réseau interne.",
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    request.user = SYSTEM_USER;
    return true;
  }
}
