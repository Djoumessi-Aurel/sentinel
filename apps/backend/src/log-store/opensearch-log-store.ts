import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { Paginated, SearchLogsQuery, StoredLogEntry } from '@sentinel/shared-types';

import type { Env } from '../common/config/env';
import type { LogCountCriteria, LogStore, LogWriteEntry } from './log-store.interface';

/**
 * Adaptateur OpenSearch — cible de production (docs/DATA_MODEL.md §2).
 *
 * Écrit directement contre l'API REST avec `fetch`, sans client officiel :
 * l'usage se limite à `_bulk`, `_search` et `_count`, et chaque dépendance
 * ajoutée est une surface d'attaque supplémentaire (docs/SECURITY.md A06).
 */

const MAPPINGS = {
  properties: {
    timestamp: { type: 'date' },
    applicationId: { type: 'keyword' },
    applicationType: { type: 'keyword' },
    server: { type: 'keyword' },
    level: { type: 'keyword' },
    message: { type: 'text' },
    // Conservé pour audit, non indexé en plein texte pour ne pas alourdir l'index.
    raw: { type: 'text', index: false },
    metadata: { type: 'object', enabled: true },
  },
} as const;

interface SearchHit {
  _id: string;
  _source: Omit<StoredLogEntry, 'id'>;
}

@Injectable()
export class OpenSearchLogStore implements LogStore {
  readonly kind = 'opensearch' as const;
  private readonly logger = new Logger(OpenSearchLogStore.name);
  private readonly baseUrl: string;
  private readonly index: string;
  private readonly authHeader: string | null;

  constructor(env: Env) {
    if (!env.OPENSEARCH_URL) {
      throw new Error("OPENSEARCH_URL est obligatoire lorsque LOG_STORE vaut 'opensearch'");
    }
    this.baseUrl = env.OPENSEARCH_URL.replace(/\/+$/, '');
    this.index = env.OPENSEARCH_INDEX;
    this.authHeader =
      env.OPENSEARCH_USERNAME && env.OPENSEARCH_PASSWORD
        ? `Basic ${Buffer.from(`${env.OPENSEARCH_USERNAME}:${env.OPENSEARCH_PASSWORD}`).toString('base64')}`
        : null;

    if (!this.authHeader) {
      this.logger.warn(
        "OpenSearch est contacté sans authentification. Acceptable uniquement sur un réseau interne fermé ; " +
          'à corriger avant toute mise en production (docs/SECURITY.md A05).',
      );
    }
  }

  async ensureReady(): Promise<void> {
    const exists = await this.request('HEAD', `/${this.index}`, undefined, [200, 404]);
    if (exists.status === 404) {
      this.logger.log(`Création de l'index « ${this.index} »`);
      await this.request('PUT', `/${this.index}`, { mappings: MAPPINGS });
    }
    this.logger.log(`Stockage des logs sur OpenSearch, index « ${this.index} »`);
  }

  async write(entries: LogWriteEntry[]): Promise<void> {
    if (entries.length === 0) return;

    // Format `_bulk` : une ligne d'action, une ligne de document, saut de ligne final obligatoire.
    const body = entries
      .flatMap((entry) => {
        const { id: _ignored, ...document } = entry;
        return [JSON.stringify({ index: { _index: this.index } }), JSON.stringify(document)];
      })
      .join('\n')
      .concat('\n');

    const response = await this.request('POST', '/_bulk', body, [200], 'application/x-ndjson');
    const payload = (await response.json()) as { errors?: boolean; items?: unknown[] };

    if (payload.errors) {
      // Un lot partiellement rejeté doit être visible : perdre des logs en
      // silence est exactement ce que cette application doit empêcher.
      throw new ServiceUnavailableException("OpenSearch a rejeté une partie du lot de logs");
    }
  }

  async search(query: SearchLogsQuery): Promise<Paginated<StoredLogEntry>> {
    const filters: unknown[] = [];
    if (query.applicationId) filters.push({ term: { applicationId: query.applicationId } });
    if (query.level) filters.push({ term: { level: query.level } });
    if (query.from || query.to) {
      filters.push({
        range: {
          timestamp: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        },
      });
    }

    // `match` sur un champ analysé : la valeur est transportée comme donnée
    // dans le corps JSON, jamais concaténée dans une expression de requête
    // (docs/SECURITY.md A03).
    const must = query.query ? [{ match: { message: query.query } }] : [];

    const response = await this.request('POST', `/${this.index}/_search`, {
      from: (query.page - 1) * query.pageSize,
      size: query.pageSize,
      sort: [{ timestamp: { order: 'desc' } }],
      track_total_hits: true,
      query: { bool: { filter: filters, must } },
    });

    const payload = (await response.json()) as {
      hits: { total: { value: number }; hits: SearchHit[] };
    };

    return {
      total: payload.hits.total.value,
      page: query.page,
      pageSize: query.pageSize,
      items: payload.hits.hits.map((hit) => ({ id: hit._id, ...hit._source })),
    };
  }

  async count(criteria: LogCountCriteria): Promise<number> {
    const filters: unknown[] = [
      { term: { applicationId: criteria.applicationId } },
      { range: { timestamp: { gte: criteria.from.toISOString(), lte: criteria.to.toISOString() } } },
    ];
    if (criteria.level) filters.push({ term: { level: criteria.level } });

    for (const [key, value] of Object.entries(criteria.metadata ?? {})) {
      // `.keyword` : les champs texte dynamiques d'OpenSearch exposent un
      // sous-champ non analysé, seul utilisable pour une égalité exacte.
      const field = typeof value === 'string' ? `metadata.${key}.keyword` : `metadata.${key}`;
      filters.push({ term: { [field]: value } });
    }

    const response = await this.request('POST', `/${this.index}/_count`, {
      query: { bool: { filter: filters } },
    });
    const payload = (await response.json()) as { count: number };
    return payload.count;
  }

  async purge(olderThan: Date): Promise<number> {
    // `_delete_by_query` plutôt qu'une politique ILM : la rétention est un
    // réglage modifiable depuis l'interface, appliqué sans redéploiement ni
    // reconfiguration du cluster (docs/DATA_MODEL.md §4).
    const response = await this.request('POST', `/${this.index}/_delete_by_query?conflicts=proceed&refresh=false`, {
      query: { range: { timestamp: { lt: olderThan.toISOString() } } },
    });
    const payload = (await response.json()) as { deleted?: number };
    return payload.deleted ?? 0;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    acceptedStatuses: number[] = [200, 201],
    contentType = 'application/json',
  ): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': contentType };
    if (this.authHeader) headers['Authorization'] = this.authHeader;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `OpenSearch injoignable : ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!acceptedStatuses.includes(response.status)) {
      const detail = await response.text().catch(() => '');
      throw new ServiceUnavailableException(
        `OpenSearch a répondu ${response.status} sur ${method} ${path}${detail ? ` : ${detail.slice(0, 500)}` : ''}`,
      );
    }
    return response;
  }
}
