import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AlertChannels } from '@sentinel/shared-types';
import { createTransport, type Transporter } from 'nodemailer';

import { ENV } from '../../common/config/config.module';
import type { Env } from '../../common/config/env';
import type { NotificationContext, NotificationOutcome, Notifier } from './notifier.interface';

/**
 * Canal email, via la passerelle SMTP interne (docs/DEPLOYMENT.md §3).
 *
 * Les destinataires viennent exclusivement de `AppConfig.alertChannels.email`.
 * Aucune adresse en dur nulle part : en Phase 4 ces chaînes deviendront des
 * références à des utilisateurs, et un destinataire codé en dur serait alors
 * introuvable (docs/AUTH.md §1).
 */
@Injectable()
export class EmailNotifier implements Notifier {
  readonly channel = 'email' as const;
  private readonly logger = new Logger(EmailNotifier.name);
  private transporter: Transporter | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  isEnabled(channels: AlertChannels): boolean {
    return channels.email.enabled && channels.email.recipients.length > 0;
  }

  async send(context: NotificationContext): Promise<NotificationOutcome> {
    const recipients = context.channels.email.recipients;

    if (recipients.length === 0) {
      // Canal activé sans destinataire : dit explicitement plutôt que compté
      // comme un envoi réussi. Une alerte que personne ne reçoit doit se voir.
      return { status: 'skipped', detail: 'Canal activé mais aucun destinataire configuré' };
    }
    if (!this.env.SMTP_HOST) {
      return { status: 'skipped', detail: 'SMTP_HOST non configuré sur ce backend' };
    }

    try {
      const transporter = this.getTransporter();
      const severity = context.alert.severity === 'critical' ? 'CRITIQUE' : 'AVERTISSEMENT';

      await transporter.sendMail({
        from: this.env.SMTP_FROM ?? 'sentinel@localhost',
        to: recipients.join(', '),
        subject: `[Sentinel][${severity}] ${context.applicationName}`,
        // Corps en texte brut : le contenu provient de logs applicatifs, donc de
        // sources non fiables. Le composer en HTML ouvrirait une injection dans
        // le client de messagerie (docs/SECURITY.md A03).
        text: [
          `Application : ${context.applicationName}`,
          `Gravité     : ${severity}`,
          `Déclenchée  : ${context.alert.triggeredAt}`,
          '',
          context.alert.message,
        ].join('\n'),
      });

      return { status: 'sent', detail: `${recipients.length} destinataire(s)` };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.error(`Échec d'envoi du mail d'alerte : ${detail}`);
      return { status: 'failed', detail };
    }
  }

  private getTransporter(): Transporter {
    if (!this.transporter) {
      this.transporter = createTransport({
        host: this.env.SMTP_HOST,
        port: this.env.SMTP_PORT,
        secure: this.env.SMTP_SECURE,
        auth:
          this.env.SMTP_USER && this.env.SMTP_PASSWORD
            ? { user: this.env.SMTP_USER, pass: this.env.SMTP_PASSWORD }
            : undefined,
      });
    }
    return this.transporter;
  }
}
