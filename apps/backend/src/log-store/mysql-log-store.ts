import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Paginated, SearchLogsQuery, StoredLogEntry } from '@sentinel/shared-types';

import { PrismaService } from '../common/prisma/prisma.service';
import type { LogCountCriteria, LogStore, LogWriteEntry } from './log-store.interface';

/**
 * Adaptateur de développement et de démonstration (docs/DECISIONS.md D002).
 *
 * **Inadapté à la production du parc complet** : `CLAUDE.md §8` rappelle que la
 * volumétrie des logs est incompatible avec MySQL à moyen terme. Il existe pour
 * que l'application soit intégralement fonctionnelle sur un poste sans Docker
 * ni OpenSearch. La bascule se fait par la seule variable `LOG_STORE`.
 */
@Injectable()
export class MysqlLogStore implements LogStore {
  readonly kind = 'mysql' as const;
  private readonly logger = new Logger(MysqlLogStore.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureReady(): Promise<void> {
    this.logger.warn(
      "Stockage des logs sur MySQL (LOG_STORE=mysql) : adapté au développement et à la démonstration, " +
        'pas à la volumétrie du parc en production. Basculer sur OpenSearch avant mise en production.',
    );
  }

  async write(entries: LogWriteEntry[]): Promise<void> {
    if (entries.length === 0) return;

    await this.prisma.logEntry.createMany({
      data: entries.map((entry) => ({
        applicationId: entry.applicationId,
        applicationType: entry.applicationType,
        server: entry.server,
        timestamp: new Date(entry.timestamp),
        level: entry.level,
        message: entry.message,
        raw: entry.raw,
        metadata: (entry.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      })),
    });
  }

  async search(query: SearchLogsQuery): Promise<Paginated<StoredLogEntry>> {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.pageSize;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.logEntry.count({ where }),
      this.prisma.logEntry.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: query.pageSize,
      }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({
        id: row.id,
        applicationId: row.applicationId,
        applicationType: row.applicationType,
        server: row.server,
        timestamp: row.timestamp.toISOString(),
        level: row.level,
        message: row.message,
        raw: row.raw,
        metadata: (row.metadata ?? undefined) as StoredLogEntry['metadata'],
      })),
    };
  }

  async count(criteria: LogCountCriteria): Promise<number> {
    const where: Prisma.LogEntryWhereInput = {
      applicationId: criteria.applicationId,
      timestamp: { gte: criteria.from, lte: criteria.to },
    };
    if (criteria.level) where.level = criteria.level;

    const metadataFilters = this.buildMetadataFilters(criteria.metadata);
    if (metadataFilters.length > 0) where.AND = metadataFilters;

    return this.prisma.logEntry.count({ where });
  }

  private buildWhere(query: SearchLogsQuery): Prisma.LogEntryWhereInput {
    const where: Prisma.LogEntryWhereInput = {};

    if (query.applicationId) where.applicationId = query.applicationId;
    if (query.level) where.level = query.level;

    if (query.from || query.to) {
      where.timestamp = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    // Recherche plein texte pauvre côté MySQL : `contains` sur le message.
    // Prisma paramètre la valeur, il n'y a donc pas d'injection possible
    // (docs/SECURITY.md A03), mais la pertinence reste bien en deçà d'OpenSearch —
    // c'est l'un des compromis assumés de cet adaptateur.
    if (query.query) where.message = { contains: query.query };

    return where;
  }

  private buildMetadataFilters(
    metadata: LogCountCriteria['metadata'],
  ): Prisma.LogEntryWhereInput[] {
    if (!metadata) return [];
    return Object.entries(metadata).map(([key, value]) => ({
      metadata: {
        // Chemin JSON MySQL. La clé vient de la configuration d'une règle, elle
        // est validée en amont par le schéma Zod de l'analyseur.
        path: `$.${key}`,
        equals: value,
      },
    }));
  }
}
