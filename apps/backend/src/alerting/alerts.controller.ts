import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  listAlertsQuerySchema,
  testChannelSchema,
  type AlertEvent,
  type ListAlertsQuery,
  type Paginated,
  type TestChannelDto,
} from '@sentinel/shared-types';

import { AuthGuard } from '../common/auth/auth.guard';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { AlertingService } from './alerting.service';
import { ChannelTestService } from './channel-test.service';

@Controller('alerts')
@UseGuards(AuthGuard)
export class AlertsController {
  constructor(
    private readonly alerting: AlertingService,
    private readonly channelTest: ChannelTestService,
  ) {}

  @Get()
  list(@Query(zodBody(listAlertsQuerySchema)) query: ListAlertsQuery): Promise<Paginated<AlertEvent>> {
    return this.alerting.list(query);
  }

  /**
   * Envoie une vraie notification de test sur un canal, pour vérifier que la
   * configuration technique (SMTP, passerelle SMS) fonctionne sans attendre un
   * incident réel (docs/ALERTING.md §6).
   */
  @Post('test-channel')
  @HttpCode(HttpStatus.OK)
  testChannel(@Body(zodBody(testChannelSchema)) dto: TestChannelDto): Promise<{ status: string; detail?: string }> {
    return this.channelTest.test(dto);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<AlertEvent> {
    return this.alerting.get(id);
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string): Promise<AlertEvent> {
    return this.alerting.resolveAlert(id);
  }
}
