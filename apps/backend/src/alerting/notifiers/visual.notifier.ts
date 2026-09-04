import { Injectable } from '@nestjs/common';
import type { AlertChannels } from '@sentinel/shared-types';

import type { NotificationContext, NotificationOutcome, Notifier } from './notifier.interface';

/**
 * Canal visuel : le bandeau et la couleur dans l'interface.
 *
 * Il n'émet rien lui-même — la diffusion WebSocket est déjà faite par
 * `RealtimeGateway`, qui écoute l'événement interne `alert.triggered`. Ce
 * notificateur existe pour que le canal apparaisse dans
 * `AlertEvent.channelsNotified` comme les autres : l'historique doit dire ce
 * qui a été notifié et par quel canal, sans exception.
 */
@Injectable()
export class VisualNotifier implements Notifier {
  readonly channel = 'visual' as const;

  isEnabled(channels: AlertChannels): boolean {
    return channels.visual;
  }

  async send(_context: NotificationContext): Promise<NotificationOutcome> {
    return { status: 'sent', detail: 'Diffusé sur le WebSocket aux clients abonnés' };
  }
}

/**
 * Canal sonore : entièrement côté client (docs/ALERTING.md §2, FRONTEND.md §3).
 *
 * Le backend ne joue pas de son ; il signale, et le navigateur décide. Ce
 * notificateur ne fait donc qu'acter que le canal était actif au moment de
 * l'alerte, ce qui rend l'historique lisible a posteriori.
 */
@Injectable()
export class SoundNotifier implements Notifier {
  readonly channel = 'sound' as const;

  isEnabled(channels: AlertChannels): boolean {
    return channels.sound;
  }

  async send(_context: NotificationContext): Promise<NotificationOutcome> {
    return { status: 'sent', detail: 'Signal envoyé au client, qui joue le son localement' };
  }
}
