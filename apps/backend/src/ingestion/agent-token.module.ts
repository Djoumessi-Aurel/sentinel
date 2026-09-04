import { Module } from '@nestjs/common';

import { AgentTokenGuard } from './agent-token.guard';
import { AgentTokenService } from './agent-token.service';

/**
 * Isolé du module d'ingestion pour casser le cycle : `ApplicationsModule` doit
 * pouvoir émettre un token à la création d'une appli, alors que
 * `IngestionModule` dépend lui-même de `ApplicationsModule`.
 */
@Module({
  providers: [AgentTokenService, AgentTokenGuard],
  exports: [AgentTokenService, AgentTokenGuard],
})
export class IngestionTokenModule {}
