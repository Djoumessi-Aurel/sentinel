import { Module } from '@nestjs/common';

import { AlertingModule } from '../alerting/alerting.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AlertingModule],
  providers: [RealtimeGateway],
})
export class RealtimeModule {}
