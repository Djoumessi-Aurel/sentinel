import type { AlertChannelName, AlertChannels, AlertEvent } from '@sentinel/shared-types';

/**
 * Contrat d'un canal de notification (docs/ALERTING.md §2).
 *
 * Chaque canal est indépendant : l'échec de l'un ne doit jamais empêcher les
 * autres de partir. Un SMS non envoyé faute de crédit ne doit pas priver
 * l'équipe du mail et du bandeau visuel.
 */
export interface NotificationContext {
  alert: AlertEvent;
  applicationName: string;
  channels: AlertChannels;
}

export interface NotificationOutcome {
  status: 'sent' | 'failed' | 'skipped';
  detail?: string;
}

export interface Notifier {
  readonly channel: AlertChannelName;

  /** Le canal est-il activé et exploitable pour cette application ? */
  isEnabled(channels: AlertChannels): boolean;

  send(context: NotificationContext): Promise<NotificationOutcome>;
}

export const NOTIFIERS = Symbol('NOTIFIERS');
