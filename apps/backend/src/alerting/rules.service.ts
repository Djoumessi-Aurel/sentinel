import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AnalyzerResult,
  AnalyzerRule,
  CreateAnalyzerRuleDto,
  UpdateAnalyzerRuleDto,
} from '@sentinel/shared-types';

import type { RequestUser } from '../common/auth/request-user';
import { PrismaService } from '../common/prisma/prisma.service';
import { AnalyzerRegistry } from './analyzers/analyzer.registry';

type RuleRow = Prisma.AnalyzerRuleGetPayload<Record<string, never>>;

@Injectable()
export class RulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AnalyzerRegistry,
  ) {}

  listTypes(): string[] {
    return this.registry.listTypes();
  }

  async list(applicationId: string): Promise<AnalyzerRule[]> {
    const rows = await this.prisma.analyzerRule.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toDto(row));
  }

  /**
   * Les `params` sont validés **par l'analyseur ciblé**, pas par un schéma
   * générique : chaque type de règle connaît la forme qu'il attend, et une règle
   * enregistrée avec des paramètres incohérents ne se découvrirait qu'au moment
   * de l'incident qu'elle devait détecter.
   */
  async create(applicationId: string, dto: CreateAnalyzerRuleDto, user: RequestUser): Promise<AnalyzerRule> {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) throw new NotFoundException(`Application ${applicationId} introuvable`);

    const analyzer = this.registry.get(dto.type);
    const params = analyzer.validateParams(dto.params);

    const row = await this.prisma.analyzerRule.create({
      data: {
        applicationId,
        type: dto.type,
        name: dto.name,
        enabled: dto.enabled ?? true,
        params: params as Prisma.InputJsonValue,
        ...(dto.cooldown ? { cooldown: dto.cooldown } : {}),
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    return this.toDto(row);
  }

  async update(ruleId: string, dto: UpdateAnalyzerRuleDto, user: RequestUser): Promise<AnalyzerRule> {
    const existing = await this.findOrThrow(ruleId);

    const params =
      dto.params === undefined ? undefined : this.registry.get(existing.type).validateParams(dto.params);

    const row = await this.prisma.analyzerRule.update({
      where: { id: ruleId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
        ...(dto.cooldown !== undefined ? { cooldown: dto.cooldown } : {}),
        ...(params !== undefined ? { params: params as Prisma.InputJsonValue } : {}),
        updatedBy: user.id,
      },
    });
    return this.toDto(row);
  }

  async remove(ruleId: string): Promise<void> {
    await this.findOrThrow(ruleId);
    await this.prisma.analyzerRule.delete({ where: { id: ruleId } });
  }

  /**
   * Évaluation à blanc (docs/ALERTING.md §6) : calcule le résultat et le
   * retourne **sans créer d'alerte ni notifier personne**, pour valider un seuil
   * avant de l'activer.
   */
  async test(ruleId: string): Promise<AnalyzerResult> {
    const rule = await this.prisma.analyzerRule.findUnique({
      where: { id: ruleId },
      include: { application: { select: { name: true, type: true } } },
    });
    if (!rule) throw new NotFoundException(`Règle ${ruleId} introuvable`);

    const analyzer = this.registry.get(rule.type);
    return analyzer.evaluate({
      applicationId: rule.applicationId,
      applicationType: rule.application.type,
      ruleId: rule.id,
      ruleName: rule.name,
      params: rule.params as Record<string, unknown>,
      now: new Date(),
    });
  }

  /**
   * Crée les règles `service-status` et `service-silence` d'un service surveillé
   * (docs/ALERTING.md §1.4 et §1.5). Le seuil de silence vaut un peu plus de
   * deux intervalles de vérification : une vérification perdue ne doit pas
   * alerter, deux consécutives si.
   */
  async createServiceRules(
    applicationId: string,
    serviceId: string,
    serviceName: string,
    checkInterval: number,
    user: RequestUser,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    const maxSilenceSeconds = Math.max(checkInterval * 2 + 10, 30);

    await client.analyzerRule.createMany({
      data: [
        {
          applicationId,
          type: 'service-status',
          name: `Service ${serviceName} arrêté`,
          params: {
            monitoredServiceId: serviceId,
            expectedState: 'active',
            severity: 'critical',
          } as Prisma.InputJsonValue,
          createdBy: user.id,
          updatedBy: user.id,
        },
        {
          applicationId,
          type: 'service-silence',
          name: `Plus de vérification de ${serviceName}`,
          params: {
            monitoredServiceId: serviceId,
            maxSilence: `${maxSilenceSeconds}s`,
            severity: 'critical',
          } as Prisma.InputJsonValue,
          createdBy: user.id,
          updatedBy: user.id,
        },
      ],
    });
  }

  /** Supprime les règles rattachées à un service qu'on retire de la surveillance. */
  async removeServiceRules(serviceId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const rules = await client.analyzerRule.findMany({
      where: { type: { in: ['service-status', 'service-silence'] } },
      select: { id: true, params: true },
    });

    const toDelete = rules
      .filter((rule) => (rule.params as { monitoredServiceId?: string } | null)?.monitoredServiceId === serviceId)
      .map((rule) => rule.id);

    if (toDelete.length > 0) {
      await client.analyzerRule.deleteMany({ where: { id: { in: toDelete } } });
    }
  }

  private async findOrThrow(ruleId: string): Promise<RuleRow> {
    const row = await this.prisma.analyzerRule.findUnique({ where: { id: ruleId } });
    if (!row) throw new NotFoundException(`Règle ${ruleId} introuvable`);
    return row;
  }

  private toDto(row: RuleRow): AnalyzerRule {
    return {
      id: row.id,
      applicationId: row.applicationId,
      type: row.type,
      name: row.name,
      enabled: row.enabled,
      params: row.params as Record<string, unknown>,
      cooldown: row.cooldown,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
