import { Module, type OnModuleInit } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module';
import { AlertingScheduler } from './alerting.scheduler';
import { AlertingService } from './alerting.service';
import { AlertsController } from './alerts.controller';
import { AnalyzerRegistry } from './analyzers/analyzer.registry';
import { LevelThresholdAnalyzer } from './analyzers/level-threshold.analyzer';
import { PatternRateAnalyzer } from './analyzers/pattern-rate.analyzer';
import { ServiceSilenceAnalyzer, ServiceStatusAnalyzer } from './analyzers/service-status.analyzer';
import { SilenceAnalyzer } from './analyzers/silence.analyzer';
import { ChannelTestService } from './channel-test.service';
import { HealthService } from './health.service';
import { EmailNotifier } from './notifiers/email.notifier';
import { SmsNotifier } from './notifiers/sms.notifier';
import { SoundNotifier, VisualNotifier } from './notifiers/visual.notifier';
import { RulesController } from './rules.controller';
import { RulesService } from './rules.service';

@Module({
  imports: [SettingsModule],
  controllers: [AlertsController, RulesController],
  providers: [
    AnalyzerRegistry,
    LevelThresholdAnalyzer,
    PatternRateAnalyzer,
    SilenceAnalyzer,
    ServiceStatusAnalyzer,
    ServiceSilenceAnalyzer,
    VisualNotifier,
    SoundNotifier,
    EmailNotifier,
    SmsNotifier,
    AlertingService,
    AlertingScheduler,
    ChannelTestService,
    HealthService,
    RulesService,
  ],
  exports: [AlertingService, RulesService, HealthService],
})
export class AlertingModule implements OnModuleInit {
  constructor(
    private readonly registry: AnalyzerRegistry,
    private readonly levelThreshold: LevelThresholdAnalyzer,
    private readonly patternRate: PatternRateAnalyzer,
    private readonly silence: SilenceAnalyzer,
    private readonly serviceStatus: ServiceStatusAnalyzer,
    private readonly serviceSilence: ServiceSilenceAnalyzer,
  ) {}

  /**
   * Enregistrement des analyseurs livrés. **Seul endroit à modifier** pour
   * ajouter un type de règle : le moteur, les notificateurs et l'API n'ont pas
   * à connaître les implémentations (docs/ALERTING.md §1.6).
   */
  onModuleInit(): void {
    this.registry.register(this.levelThreshold);
    this.registry.register(this.patternRate);
    this.registry.register(this.silence);
    this.registry.register(this.serviceStatus);
    this.registry.register(this.serviceSilence);
  }
}
