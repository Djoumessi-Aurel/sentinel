import { Module } from '@nestjs/common';

import { IngestionTokenModule } from '../ingestion/agent-token.module';
import { SettingsModule } from '../settings/settings.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

@Module({
  imports: [SettingsModule, IngestionTokenModule],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
