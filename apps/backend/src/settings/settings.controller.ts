import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  generalizeConfigSchema,
  updateAppConfigSchema,
  updateGlobalConfigSchema,
  type AppConfig,
  type GeneralizeConfigDto,
  type GlobalConfig,
  type UpdateAppConfigDto,
  type UpdateGlobalConfigDto,
} from '@sentinel/shared-types';

import { AuthGuard } from '../common/auth/auth.guard';
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { RequestUser } from '../common/auth/request-user';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { SettingsService } from './settings.service';

@Controller('config')
@UseGuards(AuthGuard, RolesGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('global')
  getGlobal(): Promise<GlobalConfig> {
    return this.settings.getGlobal();
  }

  @Roles('admin')
  @Patch('global')
  updateGlobal(
    @Body(zodBody(updateGlobalConfigSchema)) dto: UpdateGlobalConfigDto,
    @CurrentUser() user: RequestUser,
  ): Promise<GlobalConfig> {
    return this.settings.updateGlobal(dto, user);
  }

  @Get('applications/:appId')
  getAppConfig(@Param('appId') appId: string): Promise<AppConfig> {
    return this.settings.getAppConfig(appId);
  }

  @Roles('admin')
  @Patch('applications/:appId')
  updateAppConfig(
    @Param('appId') appId: string,
    @Body(zodBody(updateAppConfigSchema)) dto: UpdateAppConfigDto,
    @CurrentUser() user: RequestUser,
  ): Promise<AppConfig> {
    return this.settings.updateAppConfig(appId, dto, user);
  }

  /** Écrase la config des applis cochées avec la config globale courante. */
  @Roles('admin')
  @Post('generalize')
  async generalize(
    @Body(zodBody(generalizeConfigSchema)) dto: GeneralizeConfigDto,
    @CurrentUser() user: RequestUser,
  ): Promise<{ updated: string[] }> {
    return { updated: await this.settings.generalize(dto.applicationIds, user) };
  }
}
