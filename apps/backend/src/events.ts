import type { AlertEvent, ServiceState, StoredLogEntry } from '@sentinel/shared-types';

/**
 * Bus d'événements interne (`@nestjs/event-emitter`).
 *
 * L'ingestion écrit d'abord, puis publie : l'évaluation des règles et la
 * diffusion temps réel sont des consommateurs asynchrones, jamais un préalable
 * à l'acquittement de l'agent (docs/CLAUDE.md §8, docs/ARCHITECTURE.md §7).
 */
export const INTERNAL_EVENTS = {
  logIngested: 'log.ingested',
  serviceStateChanged: 'service.state-changed',
  alertTriggered: 'alert.triggered',
  alertResolved: 'alert.resolved',
} as const;

export interface LogIngestedEvent {
  applicationId: string;
  entries: StoredLogEntry[];
}

export interface ServiceStateChangedEvent {
  applicationId: string;
  serviceId: string;
  serviceName: string;
  previousState: ServiceState | null;
  newState: ServiceState;
  critical: boolean;
}

export interface AlertTriggeredEvent {
  applicationId: string;
  alert: AlertEvent;
}

export interface AlertResolvedEvent {
  applicationId: string;
  alertId: string;
}
