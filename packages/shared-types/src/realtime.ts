import type { AlertEvent } from './alerting';
import type { ApplicationHealth } from './application';
import type { StoredLogEntry } from './log';
import type { ServiceState } from './monitored-service';

/** Namespace Socket.IO (docs/API.md §8). */
export const REALTIME_NAMESPACE = '/realtime';

/** Nom de la room Socket.IO d'une application. */
export const applicationRoom = (applicationId: string): string => `application:${applicationId}`;

export interface JoinPayload {
  applicationId: string;
}

export interface LogNewEvent {
  applicationId: string;
  entry: StoredLogEntry;
}

export interface AlertNewEvent {
  applicationId: string;
  alert: AlertEvent;
  /** Statut agrégé recalculé, pour que le badge se mette à jour sans requête REST. */
  health: ApplicationHealth;
}

export interface AlertResolvedEvent {
  applicationId: string;
  alertId: string;
  health: ApplicationHealth;
}

export interface ServiceStatusChangedEvent {
  applicationId: string;
  serviceId: string;
  serviceName: string;
  previousState: ServiceState | null;
  newState: ServiceState;
  health: ApplicationHealth;
}

/** Événements serveur → client. */
export interface ServerToClientEvents {
  'log:new': (payload: LogNewEvent) => void;
  'alert:new': (payload: AlertNewEvent) => void;
  'alert:resolved': (payload: AlertResolvedEvent) => void;
  'service:status': (payload: ServiceStatusChangedEvent) => void;
}

/** Événements client → serveur. */
export interface ClientToServerEvents {
  join: (payload: JoinPayload) => void;
  leave: (payload: JoinPayload) => void;
}
