import { Module } from '@nestjs/common';

import { AlertingModule } from '../alerting/alerting.module';
import { ApplicationsModule } from '../applications/applications.module';
import { MonitoredServicesModule } from '../monitored-services/monitored-services.module';
import { IngestionTokenModule } from './agent-token.module';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [IngestionTokenModule, ApplicationsModule, MonitoredServicesModule, AlertingModule],
  controllers: [IngestionController],
  providers: [IngestionService],
})
export class IngestionModule {}
