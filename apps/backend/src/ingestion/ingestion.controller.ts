import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ingestLogsSchema,
  ingestStatusSchema,
  type AgentServiceList,
  type IngestLogsDto,
  type IngestStatusDto,
  type IngestionAccepted,
} from '@sentinel/shared-types';
import type { Request } from 'express';

import { zodBody } from '../common/pipes/zod-validation.pipe';
import { MonitoredServicesService } from '../monitored-services/monitored-services.service';
import { AgentTokenGuard } from './agent-token.guard';
import { AgentTokenService } from './agent-token.service';
import { IngestionService } from './ingestion.service';

/**
 * Routes machine-à-machine des agents (docs/API.md §1 et §2).
 *
 * C'est la surface la plus exposée du backend : elle reçoit du contenu non
 * fiable, en volume, depuis des serveurs applicatifs. D'où trois protections
 * cumulées — garde par token, limites de taille dans les schémas Zod
 * (`INGESTION_LIMITS`), et quota de débit propre.
 */
@Controller('ingestion')
@UseGuards(AgentTokenGuard)
export class IngestionController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly services: MonitoredServicesService,
    private readonly tokens: AgentTokenService,
  ) {}

  /**
   * Quota large : un agent envoie légitimement un lot toutes les 2 secondes
   * (`batch.timeout_secs` des templates Vector). Le quota par défaut de l'API,
   * calibré pour un humain, couperait un agent parfaitement normal.
   */
  @Post('logs')
  @Throttle({ ingestion: { limit: 300, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestLogs(
    @Req() request: Request,
    @Body(zodBody(ingestLogsSchema)) dto: IngestLogsDto,
  ): Promise<IngestionAccepted> {
    this.assertOwnsApplication(request, dto.applicationId);
    const result = await this.ingestion.ingestLogs(dto);
    await this.tokens.markUsed(request.agent!.tokenId);
    return result;
  }

  @Post('status')
  @Throttle({ ingestion: { limit: 300, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestStatus(
    @Req() request: Request,
    @Body(zodBody(ingestStatusSchema)) dto: IngestStatusDto,
  ): Promise<{ updated: number; unknownServices: string[] }> {
    this.assertOwnsApplication(request, dto.applicationId);
    const result = await this.services.ingestStatus(dto);
    await this.tokens.markUsed(request.agent!.tokenId);
    return result;
  }

  /**
   * Liste des services à vérifier, consommée par `refresh-services.sh` toutes
   * les 5 minutes. C'est ce qui permet d'ajouter ou de retirer un service depuis
   * l'interface web sans retourner sur le serveur (docs/AGENT_SETUP.md §8).
   */
  @Get('applications/:appId/services')
  agentServiceList(@Req() request: Request, @Param('appId') appId: string): Promise<AgentServiceList> {
    this.assertOwnsApplication(request, appId);
    return this.services.agentList(appId);
  }

  /**
   * Le token borne l'agent à **son** application. Sans cette vérification, un
   * agent compromis sur un serveur mutualisé — filemanager et planning
   * backoffice, les quatre composants de LTM — pourrait injecter au nom des
   * autres applications du même serveur (docs/SECURITY.md A01, DECISIONS.md D004).
   */
  private assertOwnsApplication(request: Request, applicationId: string): void {
    if (request.agent?.applicationId !== applicationId) {
      throw new ForbiddenException("Ce token d'agent n'est pas rattaché à cette application");
    }
  }
}
