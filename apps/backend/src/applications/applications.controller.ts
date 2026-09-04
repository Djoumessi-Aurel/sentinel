import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  createApplicationSchema,
  updateApplicationSchema,
  type Application,
  type ApplicationSummary,
  type CreateApplicationDto,
  type CreatedApplication,
  type UpdateApplicationDto,
} from '@sentinel/shared-types';

import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { RequestUser } from '../common/auth/request-user';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { ApplicationsService } from './applications.service';

@Controller('applications')
@UseGuards(AuthGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(): Promise<ApplicationSummary[]> {
    return this.applications.list();
  }

  /**
   * Types disponibles, alimentés par le registre de parseurs. Déclaré avant
   * `:id` : sans cela, « types » serait capturé comme un identifiant.
   */
  @Get('types')
  listTypes(): { types: string[] } {
    return { types: this.applications.listTypes() };
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Application> {
    return this.applications.getOrThrow(id);
  }

  /** Le token d'agent renvoyé ici n'est plus jamais consultable ensuite. */
  @Post()
  create(
    @Body(zodBody(createApplicationSchema)) dto: CreateApplicationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreatedApplication> {
    return this.applications.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(zodBody(updateApplicationSchema)) dto: UpdateApplicationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Application> {
    return this.applications.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.applications.remove(id);
  }
}
