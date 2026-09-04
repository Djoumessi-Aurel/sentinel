import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  DEFAULT_ALERT_CHANNELS_DEFAULT,
  DEFAULT_DISPLAY_COLORS,
  DEFAULT_SERVICE_CHECK_DEFAULTS,
  alertChannelsDefaultSchema,
  alertChannelsSchema,
  analyzerDefaultSchema,
  displayColorsSchema,
  quietHoursSchema,
  serviceCheckDefaultsSchema,
  type AlertChannels,
  type AnalyzerDefault,
  type AppConfig,
  type GlobalConfig,
  type UpdateAppConfigDto,
  type UpdateGlobalConfigDto,
} from '@sentinel/shared-types';
import { z } from 'zod';

import { PrismaService } from '../common/prisma/prisma.service';
import type { RequestUser } from '../common/auth/request-user';

const SINGLETON_ID = 'singleton';

/**
 * Analyseurs créés par défaut sur toute nouvelle application.
 *
 * `silence` en fait partie dès le départ, et ce n'est pas un détail : c'est le
 * type de panne le plus facilement invisible — un agent qui s'arrête ne produit
 * aucune erreur, l'écran reste simplement figé (docs/ALERTING.md §1.3).
 */
const BUILTIN_ANALYZER_DEFAULTS: AnalyzerDefault[] = [
  {
    type: 'level-threshold',
    name: 'Toute erreur ERROR',
    params: { level: 'ERROR', minCount: 1, window: '5m', severity: 'critical' },
  },
  {
    type: 'silence',
    name: 'Absence de logs',
    params: { maxSilence: '15m', severity: 'critical' },
  },
];

/** Les colonnes Json de Prisma sont typées `JsonValue` : on revalide à la lecture. */
const parseJson = <T>(schema: z.ZodType<T>, value: unknown, field: string): T => {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new Error(`Configuration « ${field} » corrompue en base : ${result.error.issues[0]?.message ?? 'forme inattendue'}`);
  }
  return result.data;
};

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Config globale. Créée à la volée si absente : le backend doit pouvoir
   * démarrer sur une base vierge sans étape manuelle.
   */
  async getGlobal(): Promise<GlobalConfig> {
    const row =
      (await this.prisma.globalConfig.findUnique({ where: { id: SINGLETON_ID } })) ??
      (await this.prisma.globalConfig.create({
        data: {
          id: SINGLETON_ID,
          displayColors: DEFAULT_DISPLAY_COLORS as unknown as Prisma.InputJsonValue,
          alertChannelsDefault: DEFAULT_ALERT_CHANNELS_DEFAULT as unknown as Prisma.InputJsonValue,
          analyzerDefaults: BUILTIN_ANALYZER_DEFAULTS as unknown as Prisma.InputJsonValue,
          serviceCheckDefaults: DEFAULT_SERVICE_CHECK_DEFAULTS as unknown as Prisma.InputJsonValue,
        },
      }));

    return {
      id: SINGLETON_ID,
      displayColors: parseJson(displayColorsSchema, row.displayColors, 'displayColors'),
      alertChannelsDefault: parseJson(alertChannelsDefaultSchema, row.alertChannelsDefault, 'alertChannelsDefault'),
      analyzerDefaults: parseJson(z.array(analyzerDefaultSchema), row.analyzerDefaults, 'analyzerDefaults'),
      serviceCheckDefaults: parseJson(serviceCheckDefaultsSchema, row.serviceCheckDefaults, 'serviceCheckDefaults'),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Modifie la config globale. **Sans aucun effet sur les applis existantes** :
   * la propagation ne se fait que par le bouton « généraliser »
   * (docs/CONFIG_MANAGEMENT.md §1). Ce choix produit est délibéré, ne pas le
   * « corriger » en ajoutant une lecture en cascade.
   */
  async updateGlobal(dto: UpdateGlobalConfigDto, user: RequestUser): Promise<GlobalConfig> {
    await this.getGlobal();
    await this.prisma.globalConfig.update({
      where: { id: SINGLETON_ID },
      data: {
        ...(dto.displayColors ? { displayColors: dto.displayColors as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.alertChannelsDefault
          ? { alertChannelsDefault: dto.alertChannelsDefault as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.analyzerDefaults ? { analyzerDefaults: dto.analyzerDefaults as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.serviceCheckDefaults
          ? { serviceCheckDefaults: dto.serviceCheckDefaults as unknown as Prisma.InputJsonValue }
          : {}),
        updatedBy: user.id,
      },
    });
    return this.getGlobal();
  }

  async getAppConfig(applicationId: string): Promise<AppConfig> {
    const row = await this.prisma.appConfig.findUnique({ where: { applicationId } });
    if (!row) throw new NotFoundException(`Aucune configuration pour l'application ${applicationId}`);

    return {
      id: row.id,
      applicationId: row.applicationId,
      displayColors: parseJson(displayColorsSchema, row.displayColors, 'displayColors'),
      alertChannels: parseJson(alertChannelsSchema, row.alertChannels, 'alertChannels'),
      quietHours: row.quietHours === null ? null : parseJson(quietHoursSchema, row.quietHours, 'quietHours'),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async updateAppConfig(applicationId: string, dto: UpdateAppConfigDto, user: RequestUser): Promise<AppConfig> {
    await this.getAppConfig(applicationId);
    await this.prisma.appConfig.update({
      where: { applicationId },
      data: {
        ...(dto.displayColors ? { displayColors: dto.displayColors as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.alertChannels ? { alertChannels: dto.alertChannels as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.quietHours !== undefined
          ? { quietHours: (dto.quietHours ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull }
          : {}),
        updatedBy: user.id,
      },
    });
    return this.getAppConfig(applicationId);
  }

  /**
   * Crée la config d'une appli **par copie** de la config globale courante.
   * Point d'entrée unique de cette copie (docs/CONFIG_MANAGEMENT.md §2) : ne
   * jamais dupliquer cette initialisation ailleurs.
   */
  async createAppConfigFromGlobal(applicationId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    const global = await this.getGlobal();

    await client.appConfig.create({
      data: {
        applicationId,
        displayColors: global.displayColors as unknown as Prisma.InputJsonValue,
        alertChannels: this.expandChannelDefaults(global.alertChannelsDefault) as unknown as Prisma.InputJsonValue,
        quietHours: Prisma.DbNull,
      },
    });
  }

  /**
   * Généralise la config globale vers les applis sélectionnées, en transaction :
   * soit toutes sont mises à jour, soit aucune (docs/CONFIG_MANAGEMENT.md §3).
   *
   * `quietHours`, les `AnalyzerRule` et les `MonitoredService` sont
   * volontairement exclus : ce sont des réglages propres à chaque appli, pas des
   * préférences d'affichage à propager.
   */
  async generalize(applicationIds: string[], user: RequestUser): Promise<string[]> {
    const global = await this.getGlobal();

    const existing = await this.prisma.appConfig.findMany({
      where: { applicationId: { in: applicationIds } },
      select: { applicationId: true },
    });
    const known = existing.map((row) => row.applicationId);

    const missing = applicationIds.filter((id) => !known.includes(id));
    if (missing.length > 0) {
      throw new NotFoundException(`Applications inconnues : ${missing.join(', ')}`);
    }

    await this.prisma.$transaction(
      known.map((applicationId) =>
        this.prisma.appConfig.update({
          where: { applicationId },
          data: {
            displayColors: global.displayColors as unknown as Prisma.InputJsonValue,
            alertChannels: this.expandChannelDefaults(global.alertChannelsDefault) as unknown as Prisma.InputJsonValue,
            updatedBy: user.id,
          },
        }),
      ),
    );

    return known;
  }

  /**
   * `alertChannelsDefault` est une simple liste d'interrupteurs ; `alertChannels`
   * porte en plus les destinataires. La conversion crée des listes vides : un
   * canal activé sans destinataire ne notifie personne, ce que le notificateur
   * signale explicitement plutôt que d'échouer en silence.
   */
  private expandChannelDefaults(defaults: GlobalConfig['alertChannelsDefault']): AlertChannels {
    return {
      visual: defaults.visual,
      sound: defaults.sound,
      email: { enabled: defaults.email, recipients: [] },
      sms: { enabled: defaults.sms, recipients: [] },
    };
  }
}
