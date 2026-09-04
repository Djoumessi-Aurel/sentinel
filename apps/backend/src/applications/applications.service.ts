import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { parserRegistry } from '@sentinel/log-parsers';
import type {
  Application,
  ApplicationHealth,
  ApplicationSummary,
  CreateApplicationDto,
  CreatedApplication,
  UpdateApplicationDto,
} from '@sentinel/shared-types';

import type { RequestUser } from '../common/auth/request-user';
import { PrismaService } from '../common/prisma/prisma.service';
import { AgentTokenService } from '../ingestion/agent-token.service';
import { SettingsService } from '../settings/settings.service';

type ApplicationRow = Prisma.ApplicationGetPayload<Record<string, never>>;

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly tokens: AgentTokenService,
  ) {}

  /** Types d'appli disponibles, lus dans le registre de parseurs (docs/LOG_PARSERS.md §5). */
  listTypes(): string[] {
    return parserRegistry.listTypes();
  }

  async list(): Promise<ApplicationSummary[]> {
    const rows = await this.prisma.application.findMany({
      orderBy: { name: 'asc' },
      include: {
        server: { select: { name: true } },
        services: { select: { critical: true, lastState: true } },
        alerts: { where: { resolvedAt: null }, select: { severity: true } },
      },
    });

    return rows.map((row) => {
      const activeAlerts = row.alerts;
      const criticalServicesDown = row.services.filter(
        (service) => service.critical && service.lastState !== null && service.lastState !== 'active',
      ).length;

      return {
        ...this.toDto(row),
        serverName: row.server.name,
        health: this.computeHealth(
          activeAlerts.map((alert) => alert.severity),
          criticalServicesDown,
        ),
        activeAlertCount: activeAlerts.length,
        servicesDown: row.services.filter((s) => s.lastState !== null && s.lastState !== 'active').length,
        servicesTotal: row.services.length,
      };
    });
  }

  /**
   * Statut agrégé (docs/ALERTING.md §5) : `critical` dès qu'une alerte critique
   * active existe ou qu'un service **critique** est tombé ; `warning` s'il n'y a
   * que des alertes de moindre gravité. Un service non critique qui tombe alerte
   * bien, mais ne fait pas basculer le badge de l'appli.
   */
  private computeHealth(activeSeverities: string[], criticalServicesDown: number): ApplicationHealth {
    if (criticalServicesDown > 0 || activeSeverities.includes('critical')) return 'critical';
    if (activeSeverities.length > 0) return 'warning';
    return 'ok';
  }

  async getOrThrow(id: string): Promise<Application> {
    return this.toDto(await this.findRowOrThrow(id));
  }

  async findRowOrThrow(id: string): Promise<ApplicationRow> {
    const row = await this.prisma.application.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Application ${id} introuvable`);
    return row;
  }

  /**
   * Création d'une application.
   *
   * Trois effets indissociables, donc en transaction : l'appli, sa config
   * copiée depuis la config globale, et ses analyseurs par défaut
   * (docs/CONFIG_MANAGEMENT.md §2). Une appli créée sans sa règle `silence`
   * serait supervisée sans filet.
   *
   * Le token d'agent est renvoyé en clair ici, et uniquement ici.
   */
  async create(dto: CreateApplicationDto, user: RequestUser): Promise<CreatedApplication> {
    const server = await this.prisma.server.findUnique({ where: { id: dto.serverId } });
    if (!server) throw new BadRequestException(`Serveur ${dto.serverId} introuvable`);

    const global = await this.settings.getGlobal();

    const created = await this.prisma.$transaction(async (tx) => {
      const application = await tx.application.create({
        data: {
          name: dto.name,
          type: dto.type,
          serverId: dto.serverId,
          logPath: dto.logPath,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });

      await this.settings.createAppConfigFromGlobal(application.id, tx);

      if (global.analyzerDefaults.length > 0) {
        await tx.analyzerRule.createMany({
          data: global.analyzerDefaults.map((analyzer) => ({
            applicationId: application.id,
            type: analyzer.type,
            name: analyzer.name,
            params: analyzer.params as Prisma.InputJsonValue,
            createdBy: user.id,
            updatedBy: user.id,
          })),
        });
      }

      const agentToken = await this.tokens.issue(application.id, dto.serverId, `Agent ${dto.name}`, tx);
      return { application, agentToken };
    });

    return { application: this.toDto(created.application), agentToken: created.agentToken };
  }

  async update(id: string, dto: UpdateApplicationDto, user: RequestUser): Promise<Application> {
    await this.findRowOrThrow(id);
    const row = await this.prisma.application.update({
      where: { id },
      data: { ...dto, updatedBy: user.id },
    });
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.findRowOrThrow(id);
    // Les config, règles, alertes, services et tokens tombent en cascade
    // (contraintes déclarées dans le schéma Prisma).
    await this.prisma.application.delete({ where: { id } });
  }

  /** Horodatage du dernier log reçu — base de la détection de silence. */
  async touchLastLogAt(applicationId: string, at: Date): Promise<void> {
    await this.prisma.application.update({
      where: { id: applicationId },
      data: { lastLogAt: at },
    });
  }

  private toDto(row: ApplicationRow): Application {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      serverId: row.serverId,
      logPath: row.logPath,
      status: row.status as Application['status'],
      lastLogAt: row.lastLogAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
