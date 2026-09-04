import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  createAnalyzerRuleSchema,
  updateAnalyzerRuleSchema,
  type AnalyzerResult,
  type AnalyzerRule,
  type CreateAnalyzerRuleDto,
  type UpdateAnalyzerRuleDto,
} from '@sentinel/shared-types';

import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { RequestUser } from '../common/auth/request-user';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { RulesService } from './rules.service';

@Controller()
@UseGuards(AuthGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  @Get('rules/types')
  listTypes(): { types: string[] } {
    return { types: this.rules.listTypes() };
  }

  @Get('applications/:appId/rules')
  list(@Param('appId') appId: string): Promise<AnalyzerRule[]> {
    return this.rules.list(appId);
  }

  @Post('applications/:appId/rules')
  create(
    @Param('appId') appId: string,
    @Body(zodBody(createAnalyzerRuleSchema)) dto: CreateAnalyzerRuleDto,
    @CurrentUser() user: RequestUser,
  ): Promise<AnalyzerRule> {
    return this.rules.create(appId, dto, user);
  }

  @Patch('rules/:id')
  update(
    @Param('id') id: string,
    @Body(zodBody(updateAnalyzerRuleSchema)) dto: UpdateAnalyzerRuleDto,
    @CurrentUser() user: RequestUser,
  ): Promise<AnalyzerRule> {
    return this.rules.update(id, dto, user);
  }

  @Delete('rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): Promise<void> {
    return this.rules.remove(id);
  }

  /** Évalue la règle immédiatement, sans créer d'alerte ni notifier. */
  @Post('rules/:id/test')
  @HttpCode(HttpStatus.OK)
  test(@Param('id') id: string): Promise<AnalyzerResult> {
    return this.rules.test(id);
  }
}
