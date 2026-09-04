import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';

/**
 * Limitation de débit comptée par **agent**, et non par adresse IP
 * (docs/SECURITY.md A04).
 *
 * Compter par IP serait faux dans ce parc : plusieurs applications partagent un
 * même serveur — filemanager et planning backoffice, les quatre composants de
 * LTM, les trois de Card Companion. Leurs agents sortent donc de la même
 * adresse et se brideraient mutuellement, jusqu'à faire perdre des logs à une
 * application parfaitement saine parce qu'une autre est bavarde.
 *
 * La clé est l'empreinte du token présenté : chaque agent dispose de son propre
 * quota, et un token compromis ne peut pas épuiser celui des autres. Le repli
 * sur l'IP couvre les requêtes sans token (interface d'administration).
 */
@Injectable()
export class AgentAwareThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(request: Record<string, unknown>): Promise<string> {
    const headers = request['headers'] as Record<string, string | undefined> | undefined;
    const authorization = headers?.['authorization'];

    if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
      const token = authorization.slice(7).trim();
      if (token !== '') {
        // Empreinte tronquée : la clé de quota ne doit pas être le secret
        // lui-même, qui pourrait se retrouver dans un état interne ou un log.
        return `agent:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
      }
    }

    const forwarded = (request['ips'] as string[] | undefined) ?? [];
    return `ip:${forwarded[0] ?? (request['ip'] as string | undefined) ?? 'inconnue'}`;
  }
}
