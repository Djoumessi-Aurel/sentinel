import type { AlertEvent } from './alerting';
import type { ApplicationHealth } from './application';
import type { StoredLogEntry } from './log';
import type { ServiceState } from './monitored-service';

/** Namespace Socket.IO (docs/API.md §8). */
export const REALTIME_NAMESPACE = '/realtime';

/** Nom de la room Socket.IO d'une application. */
export const applicationRoom = (applicationId: string): string => `application:${applicationId}`;

/**
 * Room recevant les alertes de **toutes** les applications.
 *
 * Le filtrage par application vaut pour les *logs*, dont le volume interdit une
 * diffusion globale. Les alertes, elles, sont rares — quelques dizaines par jour
 * — et doivent être entendues quel que soit l'écran affiché : un poste ouvert
 * sur le tableau de bord, ou une télévision d'open space, doit sonner quand
 * n'importe quelle application passe en critique.
 */
export const GLOBAL_ALERTS_ROOM = 'alerts:all';

export interface JoinPayload {
  applicationId: string;
}

export interface LogNewEvent {
  applicationId: string;
  entry: StoredLogEntry;
}

export interface AlertNewEvent {
  applicationId: string;
  /** Nom de l'application : le flux global est lu hors du contexte d'une appli. */
  applicationName: string;
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
  /** Abonnement au flux d'alertes de tout le parc. */
  joinGlobalAlerts: () => void;
  leaveGlobalAlerts: () => void;
}
