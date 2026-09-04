import type { Paginated, SearchLogsQuery, StoredLogEntry } from '@sentinel/shared-types';

/**
 * Port de stockage des logs (docs/DECISIONS.md D002).
 *
 * L'interface est délibérément pauvre : elle ne doit exposer que ce que les
 * deux adaptateurs savent honorer honnêtement. Faire dépendre une
 * fonctionnalité d'une capacité propre à OpenSearch la rendrait fausse — et non
 * simplement plus lente — sur l'autre adaptateur.
 */

export interface LogWriteEntry extends StoredLogEntry {}

export interface LogCountCriteria {
  applicationId: string;
  from: Date;
  to: Date;
  level?: string;
  /** Égalités sur les champs de `metadata`, ex. `{ smsType: 'card', outcome: 'success' }`. */
  metadata?: Record<string, string | number | boolean>;
}

export interface LogStore {
  /** Identifiant de l'adaptateur, journalisé au démarrage. */
  readonly kind: 'mysql' | 'opensearch';

  /** Prépare le stockage (création d'index, vérification de connexion). */
  ensureReady(): Promise<void>;

  /** Écrit un lot d'entrées. Doit être atomique par lot autant que possible. */
  write(entries: LogWriteEntry[]): Promise<void>;

  /** Recherche paginée, du plus récent au plus ancien. */
  search(query: SearchLogsQuery): Promise<Paginated<StoredLogEntry>>;

  /** Compte les entrées correspondant aux critères — base des analyseurs. */
  count(criteria: LogCountCriteria): Promise<number>;

  /**
   * Supprime les entrées antérieures à une date. Retourne le nombre supprimé.
   *
   * Sans purge, le stockage croît indéfiniment : la question n'est pas de savoir
   * *si* le disque se remplira, mais quand — et l'outil censé détecter les
   * pannes tomberait alors lui-même (docs/DATA_MODEL.md §4).
   */
  purge(olderThan: Date): Promise<number>;
}

/** Jeton d'injection NestJS : on injecte l'interface, jamais une implémentation. */
export const LOG_STORE = Symbol('LOG_STORE');
