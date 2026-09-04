import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  createMonitoredServiceSchema,
  updateMonitoredServiceSchema,
  type ApplicationServicesStatus,
  type CreateMonitoredServiceDto,
  type MonitoredService,
  type UpdateMonitoredServiceDto,
} from '@sentinel/shared-types';

import { AuthGuard } from '../common/auth/auth.guard';
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { RequestUser } from '../common/auth/request-user';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { MonitoredServicesService } from './monitored-services.service';

@Controller()
@UseGuards(AuthGuard, RolesGuard)
export class MonitoredServicesController {
  constructor(private readonly services: MonitoredServicesService) {}

  @Get('applications/:appId/services')
  list(@Param('appId') appId: string): Promise<MonitoredService[]> {
    return this.services.list(appId);
  }

  @Get('applications/:appId/services/status')
  status(@Param('appId') appId: string): Promise<ApplicationServicesStatus> {
    return this.services.status(appId);
  }

  @Roles('admin')
  @Post('applications/:appId/services')
  create(
    @Param('appId') appId: string,
    @Body(zodBody(createMonitoredServiceSchema)) dto: CreateMonitoredServiceDto,
    @CurrentUser() user: RequestUser,
  ): Promise<MonitoredService> {
    return this.services.create(appId, dto, user);
  }

  @Roles('admin')
  @Patch('services/:id')
  update(
    @Param('id') id: string,
    @Body(zodBody(updateMonitoredServiceSchema)) dto: UpdateMonitoredServiceDto,
  ): Promise<MonitoredService> {
    return this.services.update(id, dto);
  }

  @Roles('admin')
  @Delete('services/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.services.remove(id);
  }
}
