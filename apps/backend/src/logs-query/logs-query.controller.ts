import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { searchLogsQuerySchema, type Paginated, type SearchLogsQuery, type StoredLogEntry } from '@sentinel/shared-types';

import { AuthGuard } from '../common/auth/auth.guard';
import { Roles } from '../common/auth/roles.decorator';
import { RolesGuard } from '../common/auth/roles.guard';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { LOG_STORE, type LogStore } from '../log-store/log-store.interface';

/**
 * Recherche historique (docs/API.md §7). Le contrôleur ne connaît que
 * l'interface `LogStore` : la même route sert donc à l'identique que les logs
 * soient dans OpenSearch ou dans MySQL.
 */
@Controller('logs')
@UseGuards(AuthGuard, RolesGuard)
export class LogsQueryController {
  constructor(@Inject(LOG_STORE) private readonly logStore: LogStore) {}

  @Get()
  search(@Query(zodBody(searchLogsQuerySchema)) query: SearchLogsQuery): Promise<Paginated<StoredLogEntry>> {
    return this.logStore.search(query);
  }
}
