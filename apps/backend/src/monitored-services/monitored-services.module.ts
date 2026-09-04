import { Module } from '@nestjs/common';

import { AlertingModule } from '../alerting/alerting.module';
import { SettingsModule } from '../settings/settings.module';
import { MonitoredServicesController } from './monitored-services.controller';
import { MonitoredServicesService } from './monitored-services.service';

@Module({
  imports: [AlertingModule, SettingsModule],
  controllers: [MonitoredServicesController],
  providers: [MonitoredServicesService],
  exports: [MonitoredServicesService],
})
export class MonitoredServicesModule {}
