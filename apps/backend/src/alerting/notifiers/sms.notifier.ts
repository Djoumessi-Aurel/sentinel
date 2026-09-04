import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AlertChannels } from '@sentinel/shared-types';

import { ENV } from '../../common/config/config.module';
import type { Env } from '../../common/config/env';
import type { NotificationContext, NotificationOutcome, Notifier } from './notifier.interface';

/** Un SMS long est facturé en plusieurs messages : on tronque proprement. */
const MAX_SMS_LENGTH = 300;

/**
 * Canal SMS, via la passerelle interne déjà utilisée par distribcard
 * (docs/ALERTING.md §2, docs/DEPLOYMENT.md §3).
 *
 * L'URL de la passerelle vient **exclusivement** de la configuration serveur,
 * jamais d'une donnée reçue : c'est ce qui interdit qu'une ligne de log forgée
 * puisse faire émettre une requête vers un hôte arbitraire (docs/SECURITY.md A10).
 */
@Injectable()
export class SmsNotifier implements Notifier {
  readonly channel = 'sms' as const;
  private readonly logger = new Logger(SmsNotifier.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  isEnabled(channels: AlertChannels): boolean {
    return channels.sms.enabled && channels.sms.recipients.length > 0;
  }

  async send(context: NotificationContext): Promise<NotificationOutcome> {
    const recipients = context.channels.sms.recipients;

    if (recipients.length === 0) {
      return { status: 'skipped', detail: 'Canal activé mais aucun destinataire configuré' };
    }
    if (!this.env.SMS_GATEWAY_URL) {
      return { status: 'skipped', detail: 'SMS_GATEWAY_URL non configurée sur ce backend' };
    }

    const severity = context.alert.severity === 'critical' ? 'CRITIQUE' : 'ALERTE';
    const text = `[Sentinel][${severity}] ${context.applicationName} : ${context.alert.message}`.slice(
      0,
      MAX_SMS_LENGTH,
    );

    const results = await Promise.allSettled(
      recipients.map((recipient) => this.sendOne(this.env.SMS_GATEWAY_URL as string, recipient, text)),
    );

    const failures = results.filter((result) => result.status === 'rejected');

    if (failures.length === 0) {
      return { status: 'sent', detail: `${recipients.length} destinataire(s)` };
    }
    // Envoi partiel : c'est un échec à signaler, pas un succès. L'historique
    // doit permettre de voir qu'un opérateur n'a pas été joint.
    const detail = `${failures.length}/${recipients.length} envoi(s) en échec`;
    this.logger.error(`Échec d'envoi de SMS d'alerte : ${detail}`);
    return { status: failures.length === recipients.length ? 'failed' : 'sent', detail };
  }

  private async sendOne(gatewayUrl: string, recipient: string, text: string): Promise<void> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.env.SMS_GATEWAY_API_KEY) headers['Authorization'] = `Bearer ${this.env.SMS_GATEWAY_API_KEY}`;

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to: recipient, message: text }),
      // Pas de suivi de redirection : une redirection vers un hôte interne
      // transformerait la passerelle en relais (docs/SECURITY.md A10).
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`Passerelle SMS : réponse ${response.status}`);
    }
  }
}
