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
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { RequestUser } from '../common/auth/request-user';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { ApplicationsService } from './applications.service';

@Controller('applications')
@UseGuards(AuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<ApplicationSummary[]> {
    return this.applications.list(user);
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
  get(@Param('id') id: string, @CurrentUser() user: RequestUser): Promise<Application> {
    return this.applications.getOrThrow(id, user);
  }

  /** Le token d'agent renvoyé ici n'est plus jamais consultable ensuite. */
  @Roles('admin')
  @Post()
  create(
    @Body(zodBody(createApplicationSchema)) dto: CreateApplicationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<CreatedApplication> {
    return this.applications.create(dto, user);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(zodBody(updateApplicationSchema)) dto: UpdateApplicationDto,
    @CurrentUser() user: RequestUser,
  ): Promise<Application> {
    return this.applications.update(id, dto, user);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.applications.remove(id);
  }

  /**
   * Émet un nouveau token d'agent. Renvoyé en clair une seule fois, comme à la
   * création : la base ne contient que son empreinte.
   */
  @Roles('admin')
  @Post(':id/tokens')
  @HttpCode(HttpStatus.CREATED)
  issueToken(@Param('id') id: string): Promise<{ agentToken: string }> {
    return this.applications.issueToken(id, 'Token régénéré');
  }

  @Get(':id/tokens')
  listTokens(@Param('id') id: string) {
    return this.applications.listTokens(id);
  }

  @Roles('admin')
  @Delete('tokens/:tokenId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeToken(@Param('tokenId') tokenId: string): Promise<void> {
    return this.applications.revokeToken(tokenId);
  }
}
