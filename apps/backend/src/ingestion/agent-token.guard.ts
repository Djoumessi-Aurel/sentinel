import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

import { AgentTokenService, type ResolvedAgentToken } from './agent-token.service';

declare module 'express' {
  interface Request {
    agent?: ResolvedAgentToken;
  }
}

/**
 * Authentification des agents de collecte (docs/SECURITY.md A01/A02).
 *
 * Garde **distinct** de `AuthGuard` : ce sont deux natures d'accès. `AuthGuard`
 * protège les routes d'administration destinées à un humain ; celui-ci
 * authentifie une machine et, surtout, **borne sa portée** — le contrôleur
 * vérifie ensuite que l'`applicationId` du corps correspond bien à celui du
 * token. Un agent compromis ne peut donc injecter que dans son application, pas
 * dans les autres applications du même serveur (docs/DECISIONS.md D004).
 */
@Injectable()
export class AgentTokenGuard implements CanActivate {
  private readonly logger = new Logger(AgentTokenGuard.name);

  constructor(private readonly tokens: AgentTokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractBearer(request.header('authorization'));

    if (!token) {
      throw new UnauthorizedException("Token d'agent manquant");
    }

    const agent = await this.tokens.resolve(token);
    if (!agent) {
      // Journalisé sans le token (docs/SECURITY.md A09 : ne jamais écrire un
      // secret dans les logs, même tronqué).
      this.logger.warn(`Token d'agent refusé — ${request.method} ${request.url} depuis ${request.ip ?? 'origine inconnue'}`);
      throw new UnauthorizedException("Token d'agent invalide ou révoqué");
    }

    request.agent = agent;
    return true;
  }

  private extractBearer(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, value] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
    return value.trim();
  }
}
