import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import type {
  AlertEvent,
  AlertSeverity,
  AnalyzerResult,
  ChannelNotificationResult,
  ListAlertsQuery,
  Paginated,
} from '@sentinel/shared-types';

import { durationToMs } from '../common/duration';
import { PrismaService } from '../common/prisma/prisma.service';
import { INTERNAL_EVENTS, type AlertResolvedEvent, type AlertTriggeredEvent } from '../events';
import { SettingsService } from '../settings/settings.service';
import { AnalyzerRegistry } from './analyzers/analyzer.registry';
import { EmailNotifier } from './notifiers/email.notifier';
import type { Notifier } from './notifiers/notifier.interface';
import { SmsNotifier } from './notifiers/sms.notifier';
import { SoundNotifier, VisualNotifier } from './notifiers/visual.notifier';
import { mutedChannelsAt } from './quiet-hours';

type RuleRow = Prisma.AnalyzerRuleGetPayload<{ include: { application: { select: { name: true; type: true } } } }>;

@Injectable()
export class AlertingService {
  private readonly logger = new Logger(AlertingService.name);
  private readonly notifiers: Notifier[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AnalyzerRegistry,
    private readonly settings: SettingsService,
    private readonly events: EventEmitter2,
    visual: VisualNotifier,
    sound: SoundNotifier,
    email: EmailNotifier,
    sms: SmsNotifier,
  ) {
    this.notifiers = [visual, sound, email, sms];
  }

  /**
   * Évalue une règle et réconcilie l'état de l'alerte associée.
   * Ne lève jamais : une règle mal configurée ne doit pas interrompre
   * l'évaluation des autres règles de l'application.
   */
  async evaluateRule(rule: RuleRow, now: Date = new Date()): Promise<AnalyzerResult | null> {
    if (!rule.enabled) return null;

    try {
      const analyzer = this.registry.get(rule.type);
      const result = await analyzer.evaluate({
        applicationId: rule.applicationId,
        applicationType: rule.application.type,
        ruleId: rule.id,
        ruleName: rule.name,
        params: rule.params as Record<string, unknown>,
        now,
      });

      await this.reconcile(rule, result, now);
      return result;
    } catch (error) {
      this.logger.error(
        `Évaluation de la règle « ${rule.name} » (${rule.type}) en échec : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** Évalue toutes les règles actives d'une application pour un mode donné. */
  async evaluateApplication(applicationId: string, mode: 'streaming' | 'scheduled', now = new Date()): Promise<void> {
    const types = this.registry.listByMode(mode).map((analyzer) => analyzer.type);
    if (types.length === 0) return;

    const rules = await this.prisma.analyzerRule.findMany({
      where: { applicationId, enabled: true, type: { in: types } },
      include: { application: { select: { name: true, type: true } } },
    });

    for (const rule of rules) {
      await this.evaluateRule(rule, now);
    }
  }

  /**
   * Rapproche le résultat d'une évaluation de l'alerte en cours.
   *
   * Trois cas, dans cet ordre :
   *  - condition vraie, aucune alerte active → création + notification ;
   *  - condition vraie, alerte déjà active → renotification **seulement** si le
   *    cooldown est écoulé (docs/ALERTING.md §3), l'alerte restant ouverte ;
   *  - condition fausse, alerte active → résolution automatique.
   */
  private async reconcile(rule: RuleRow, result: AnalyzerResult, now: Date): Promise<void> {
    const active = await this.prisma.alertEvent.findFirst({
      where: { ruleId: rule.id, resolvedAt: null },
      orderBy: { triggeredAt: 'desc' },
    });

    if (result.triggered) {
      if (!active) {
        await this.openAlert(rule, result, now);
        return;
      }

      const cooldownMs = durationToMs(rule.cooldown);
      const lastNotified = active.lastNotifiedAt ?? active.triggeredAt;

      if (now.getTime() - lastNotified.getTime() >= cooldownMs) {
        // La condition dure : on renotifie, sans rouvrir une seconde alerte,
        // pour ne pas transformer l'historique en liste de doublons.
        await this.notifyAndRecord(active.id, rule, result.severity, active.message, now);
      }
      return;
    }

    if (active) {
      await this.resolveAlert(active.id, rule.applicationId);
    }
  }

  private async openAlert(rule: RuleRow, result: AnalyzerResult, now: Date): Promise<void> {
    const created = await this.prisma.alertEvent.create({
      data: {
        applicationId: rule.applicationId,
        ruleId: rule.id,
        severity: result.severity,
        message: `${rule.name} — ${result.message}`,
        triggeredAt: now,
        channelsNotified: [] as unknown as Prisma.InputJsonValue,
      },
    });

    await this.notifyAndRecord(created.id, rule, result.severity, created.message, now);
  }

  /**
   * Exécute tous les canaux actifs **en parallèle et sans court-circuit** :
   * l'échec d'un canal ne doit jamais empêcher les autres de partir
   * (docs/ALERTING.md §2).
   */
  private async notifyAndRecord(
    alertId: string,
    rule: RuleRow,
    severity: AlertSeverity,
    message: string,
    now: Date,
  ): Promise<void> {
    const config = await this.settings.getAppConfig(rule.applicationId);
    const muted = mutedChannelsAt(config.quietHours, now);

    const alert = await this.toDto(alertId);

    const outcomes = await Promise.allSettled(
      this.notifiers.map(async (notifier): Promise<ChannelNotificationResult> => {
        if (!notifier.isEnabled(config.alertChannels)) {
          return { channel: notifier.channel, status: 'skipped', detail: 'Canal désactivé', at: now.toISOString() };
        }
        if (muted.has(notifier.channel)) {
          return {
            channel: notifier.channel,
            status: 'skipped',
            detail: 'Heures creuses : canal mis en sourdine',
            at: now.toISOString(),
          };
        }

        const outcome = await notifier.send({
          alert: { ...alert, severity, message },
          applicationName: rule.application.name,
          channels: config.alertChannels,
        });
        return { channel: notifier.channel, ...outcome, at: now.toISOString() };
      }),
    );

    const channelsNotified: ChannelNotificationResult[] = outcomes.map((outcome, index) =>
      outcome.status === 'fulfilled'
        ? outcome.value
        : {
            channel: this.notifiers[index]!.channel,
            status: 'failed' as const,
            detail: String(outcome.reason),
            at: now.toISOString(),
          },
    );

    const updated = await this.prisma.alertEvent.update({
      where: { id: alertId },
      data: {
        lastNotifiedAt: now,
        channelsNotified: channelsNotified as unknown as Prisma.InputJsonValue,
      },
    });

    const payload: AlertTriggeredEvent = {
      applicationId: rule.applicationId,
      alert: this.rowToDto(updated),
    };
    this.events.emit(INTERNAL_EVENTS.alertTriggered, payload);
  }

  async resolveAlert(alertId: string, applicationId?: string): Promise<AlertEvent> {
    const updated = await this.prisma.alertEvent.update({
      where: { id: alertId },
      data: { resolvedAt: new Date() },
    });

    const payload: AlertResolvedEvent = {
      applicationId: applicationId ?? updated.applicationId,
      alertId,
    };
    // Message « résolu » diffusé sans alerte sonore ni SMS : rassurer ne doit
    // pas coûter une seconde interruption (docs/ALERTING.md §3).
    this.events.emit(INTERNAL_EVENTS.alertResolved, payload);

    return this.rowToDto(updated);
  }

  async list(query: ListAlertsQuery): Promise<Paginated<AlertEvent>> {
    const where: Prisma.AlertEventWhereInput = {};
    if (query.applicationId) where.applicationId = query.applicationId;
    if (query.severity) where.severity = query.severity;
    if (query.status) where.resolvedAt = query.status === 'active' ? null : { not: null };
    if (query.from || query.to) {
      where.triggeredAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.alertEvent.count({ where }),
      this.prisma.alertEvent.findMany({
        where,
        orderBy: { triggeredAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);

    return { total, page: query.page, pageSize: query.pageSize, items: rows.map((row) => this.rowToDto(row)) };
  }

  async get(alertId: string): Promise<AlertEvent> {
    return this.toDto(alertId);
  }

  private async toDto(alertId: string): Promise<AlertEvent> {
    const row = await this.prisma.alertEvent.findUniqueOrThrow({ where: { id: alertId } });
    return this.rowToDto(row);
  }

  private rowToDto(row: Prisma.AlertEventGetPayload<Record<string, never>>): AlertEvent {
    return {
      id: row.id,
      applicationId: row.applicationId,
      ruleId: row.ruleId,
      severity: row.severity as AlertSeverity,
      message: row.message,
      triggeredAt: row.triggeredAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      lastNotifiedAt: row.lastNotifiedAt?.toISOString() ?? null,
      channelsNotified: (row.channelsNotified ?? []) as unknown as ChannelNotificationResult[],
    };
  }
}
