import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { ENV } from '../common/config/config.module';
import type { Env } from '../common/config/env';
import { PrismaService } from '../common/prisma/prisma.service';

export interface ResolvedAgentToken {
  tokenId: string;
  applicationId: string;
  serverId: string;
}

/**
 * Tokens d'authentification machine-à-machine des agents (docs/SECURITY.md A02).
 *
 * Trois propriétés à préserver absolument :
 *  1. le token n'existe en clair qu'une seule fois, à sa création ;
 *  2. la base ne contient qu'une empreinte HMAC-SHA256 salée par
 *     `AGENT_TOKEN_SECRET` — une fuite de la base ne donne pas de token utilisable ;
 *  3. la vérification se fait en temps constant et **sans parcourir la table**,
 *     ce que permet le fait que l'empreinte soit déterministe et indexée.
 */
@Injectable()
export class AgentTokenService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Empreinte déterministe : indexable, donc consultable en O(1). */
  private hash(token: string): string {
    return createHmac('sha256', this.env.AGENT_TOKEN_SECRET).update(token).digest('hex');
  }

  /**
   * Crée un token et retourne sa valeur en clair — la seule et unique fois où
   * elle est disponible. L'appelant doit l'afficher immédiatement.
   */
  async issue(
    applicationId: string,
    serverId: string,
    label?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string> {
    const client = tx ?? this.prisma;
    // 32 octets d'aléa cryptographique : hors de portée d'une recherche exhaustive.
    const token = randomBytes(32).toString('base64url');

    await client.ingestionAgentToken.create({
      data: {
        applicationId,
        serverId,
        tokenHash: this.hash(token),
        label: label ?? null,
      },
    });

    return token;
  }

  /**
   * Résout un token présenté par un agent. Retourne `null` si le token est
   * inconnu ou révoqué — sans jamais indiquer laquelle des deux causes, pour ne
   * pas transformer l'API en oracle d'existence de tokens.
   */
  async resolve(presentedToken: string): Promise<ResolvedAgentToken | null> {
    if (presentedToken.length === 0 || presentedToken.length > 512) return null;

    const expectedHash = this.hash(presentedToken);
    const row = await this.prisma.ingestionAgentToken.findUnique({
      where: { tokenHash: expectedHash },
      select: { id: true, applicationId: true, serverId: true, tokenHash: true, revokedAt: true },
    });
    if (!row || row.revokedAt !== null) return null;

    // La consultation par index a déjà comparé les empreintes ; cette
    // comparaison en temps constant garde la propriété si la recherche venait à
    // être remplacée un jour par un parcours.
    if (!this.constantTimeEquals(row.tokenHash, expectedHash)) return null;

    return { tokenId: row.id, applicationId: row.applicationId, serverId: row.serverId };
  }

  /** Trace de dernière utilisation, utile pour repérer un agent muet. */
  async markUsed(tokenId: string): Promise<void> {
    await this.prisma.ingestionAgentToken.update({
      where: { id: tokenId },
      data: { lastUsedAt: new Date() },
    });
  }

  async revoke(tokenId: string): Promise<void> {
    await this.prisma.ingestionAgentToken.update({
      where: { id: tokenId },
      data: { revokedAt: new Date() },
    });
  }

  private constantTimeEquals(left: string, right: string): boolean {
    const a = Buffer.from(left, 'utf8');
    const b = Buffer.from(right, 'utf8');
    // `timingSafeEqual` exige des longueurs égales ; deux empreintes SHA-256 en
    // hexadécimal les ont toujours, mais on reste défensif.
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
