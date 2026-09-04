import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  AgentServiceList,
  ApplicationServicesStatus,
  CreateMonitoredServiceDto,
  IngestStatusDto,
  MonitoredService,
  ServiceState,
  UpdateMonitoredServiceDto,
} from '@sentinel/shared-types';
import type { Prisma } from '@prisma/client';

import { AlertingService } from '../alerting/alerting.service';
import { RulesService } from '../alerting/rules.service';
import { SYSTEM_USER, type RequestUser } from '../common/auth/request-user';
import { PrismaService } from '../common/prisma/prisma.service';
import { INTERNAL_EVENTS, type ServiceStateChangedEvent } from '../events';
import { SettingsService } from '../settings/settings.service';

type ServiceRow = Prisma.MonitoredServiceGetPayload<Record<string, never>>;

@Injectable()
export class MonitoredServicesService {
  private readonly logger = new Logger(MonitoredServicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly rules: RulesService,
    private readonly alerting: AlertingService,
    private readonly events: EventEmitter2,
  ) {}

  async list(applicationId: string): Promise<MonitoredService[]> {
    const rows = await this.prisma.monitoredService.findMany({
      where: { applicationId },
      orderBy: { name: 'asc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Ajoute un service à surveiller, et **crée immédiatement ses deux règles**
   * `service-status` et `service-silence` (docs/ALERTING.md §1.4 et §1.5).
   *
   * Les deux vont ensemble : sans `service-silence`, un agent qui cesse
   * d'envoyer ses vérifications laisserait le service affiché dans son dernier
   * état connu — vert, très probablement — alors que plus personne ne le
   * surveille.
   */
  async create(
    applicationId: string,
    dto: CreateMonitoredServiceDto,
    user: RequestUser,
  ): Promise<MonitoredService> {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) throw new NotFoundException(`Application ${applicationId} introuvable`);

    const defaults = (await this.settings.getGlobal()).serviceCheckDefaults;

    const duplicate = await this.prisma.monitoredService.findFirst({
      where: { applicationId, name: dto.name },
    });
    if (duplicate) {
      throw new BadRequestException(`Le service « ${dto.name} » est déjà surveillé pour cette application`);
    }

    return this.prisma.$transaction(async (tx) => {
      const row = await tx.monitoredService.create({
        data: {
          applicationId,
          name: dto.name,
          checkType: dto.checkType ?? 'systemd',
          // Copie explicite depuis la config globale, jamais de lecture en
          // cascade à l'affichage (docs/CONFIG_MANAGEMENT.md §1).
          critical: dto.critical ?? defaults.criticalByDefault,
          checkInterval: dto.checkInterval ?? defaults.checkInterval,
        },
      });

      await this.rules.createServiceRules(applicationId, row.id, row.name, row.checkInterval, user, tx);
      return this.toDto(row);
    });
  }

  async update(serviceId: string, dto: UpdateMonitoredServiceDto): Promise<MonitoredService> {
    await this.findOrThrow(serviceId);
    const row = await this.prisma.monitoredService.update({ where: { id: serviceId }, data: dto });
    return this.toDto(row);
  }

  async remove(serviceId: string): Promise<void> {
    await this.findOrThrow(serviceId);
    await this.prisma.$transaction(async (tx) => {
      // Les règles référencent le service par son identifiant dans `params` :
      // les laisser produirait des alertes sur un service qui n'existe plus.
      await this.rules.removeServiceRules(serviceId, tx);
      await tx.monitoredService.delete({ where: { id: serviceId } });
    });
  }

  /** État courant agrégé, pour le dashboard (docs/API.md §2). */
  async status(applicationId: string): Promise<ApplicationServicesStatus> {
    const services = await this.list(applicationId);
    const critical = services.filter((service) => service.critical);

    const aggregate = ((): ApplicationServicesStatus['aggregate'] => {
      if (services.length === 0) return 'unknown';
      if (critical.some((service) => service.lastState !== null && service.lastState !== 'active')) return 'down';
      if (services.some((service) => service.lastState !== null && service.lastState !== 'active')) return 'degraded';
      if (services.every((service) => service.lastState === null)) return 'unknown';
      return 'ok';
    })();

    return { applicationId, aggregate, services };
  }

  /** Liste minimale consommée par `agents/refresh-services.sh`. */
  async agentList(applicationId: string): Promise<AgentServiceList> {
    const services = await this.list(applicationId);
    return {
      applicationId,
      services: services.map((service) => ({
        name: service.name,
        checkType: service.checkType,
        checkInterval: service.checkInterval,
      })),
    };
  }

  /**
   * Traite un lot de vérifications envoyé par l'agent (docs/API.md §2).
   *
   * `lastState`/`lastCheckedAt` sont mis à jour à **chaque** vérification — c'est
   * ce qui permet de détecter un silence — mais un `ServiceStatusEvent` n'est
   * écrit que sur **transition** : à 30 secondes d'intervalle, journaliser
   * chaque vérification remplirait la table pour rien (docs/DATA_MODEL.md §3).
   */
  async ingestStatus(dto: IngestStatusDto): Promise<{ updated: number; unknownServices: string[] }> {
    const services = await this.prisma.monitoredService.findMany({
      where: { applicationId: dto.applicationId },
    });
    const byName = new Map(services.map((service) => [service.name, service]));

    const unknownServices: string[] = [];
    const transitions: ServiceStateChangedEvent[] = [];
    let updated = 0;

    for (const check of dto.checks) {
      const service = byName.get(check.serviceName);
      if (!service) {
        // L'agent envoie un service qui n'est plus déclaré : sa liste locale est
        // en retard, elle se resynchronisera au prochain rafraîchissement.
        unknownServices.push(check.serviceName);
        continue;
      }

      const previousState = service.lastState as ServiceState | null;
      const checkedAt = new Date(check.checkedAt);

      await this.prisma.monitoredService.update({
        where: { id: service.id },
        data: { lastState: check.state, lastCheckedAt: checkedAt },
      });
      updated += 1;

      if (previousState !== check.state) {
        await this.prisma.serviceStatusEvent.create({
          data: { monitoredServiceId: service.id, previousState, newState: check.state, changedAt: checkedAt },
        });
        transitions.push({
          applicationId: dto.applicationId,
          serviceId: service.id,
          serviceName: service.name,
          previousState,
          newState: check.state,
          critical: service.critical,
        });
      }
    }

    for (const transition of transitions) {
      this.events.emit(INTERNAL_EVENTS.serviceStateChanged, transition);
    }

    // Évaluation en streaming des règles `service-status` : une transition vers
    // `failed` doit alerter tout de suite, pas à la prochaine passe planifiée.
    if (transitions.length > 0) {
      void this.alerting
        .evaluateApplication(dto.applicationId, 'streaming')
        .catch((error: unknown) =>
          this.logger.error(
            `Évaluation des règles de statut en échec : ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
    }

    if (unknownServices.length > 0) {
      this.logger.debug(
        `Vérifications reçues pour des services non déclarés : ${unknownServices.join(', ')}`,
      );
    }

    return { updated, unknownServices };
  }

  private async findOrThrow(serviceId: string): Promise<ServiceRow> {
    const row = await this.prisma.monitoredService.findUnique({ where: { id: serviceId } });
    if (!row) throw new NotFoundException(`Service surveillé ${serviceId} introuvable`);
    return row;
  }

  private toDto(row: ServiceRow): MonitoredService {
    return {
      id: row.id,
      applicationId: row.applicationId,
      name: row.name,
      checkType: row.checkType,
      critical: row.critical,
      checkInterval: row.checkInterval,
      lastState: (row.lastState as ServiceState | null) ?? null,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
