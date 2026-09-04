import { Injectable, NotFoundException } from '@nestjs/common';
import type { TestChannelDto } from '@sentinel/shared-types';

import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { EmailNotifier } from './notifiers/email.notifier';
import type { Notifier } from './notifiers/notifier.interface';
import { SmsNotifier } from './notifiers/sms.notifier';
import { SoundNotifier, VisualNotifier } from './notifiers/visual.notifier';

/**
 * Test manuel d'un canal (docs/ALERTING.md §6).
 *
 * Contrairement à `POST /api/rules/:id/test`, celui-ci envoie **réellement** la
 * notification : c'est tout l'intérêt, vérifier que le SMTP ou la passerelle SMS
 * répond. Aucun `AlertEvent` n'est créé pour autant, l'historique reste propre.
 */
@Injectable()
export class ChannelTestService {
  private readonly notifiers: Notifier[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    visual: VisualNotifier,
    sound: SoundNotifier,
    email: EmailNotifier,
    sms: SmsNotifier,
  ) {
    this.notifiers = [visual, sound, email, sms];
  }

  async test(dto: TestChannelDto): Promise<{ status: string; detail?: string }> {
    const application = await this.prisma.application.findUnique({
      where: { id: dto.applicationId },
      select: { name: true },
    });
    if (!application) throw new NotFoundException(`Application ${dto.applicationId} introuvable`);

    const notifier = this.notifiers.find((candidate) => candidate.channel === dto.channel);
    if (!notifier) throw new NotFoundException(`Canal ${dto.channel} inconnu`);

    const config = await this.settings.getAppConfig(dto.applicationId);
    const now = new Date();

    const outcome = await notifier.send({
      alert: {
        id: 'test',
        applicationId: dto.applicationId,
        ruleId: null,
        severity: 'warning',
        message: `Notification de test émise depuis Sentinel le ${now.toLocaleString('fr-FR')}. Aucune anomalie réelle.`,
        triggeredAt: now.toISOString(),
        resolvedAt: null,
        lastNotifiedAt: null,
        channelsNotified: [],
      },
      applicationName: application.name,
      channels: config.alertChannels,
    });

    return outcome;
  }
}
