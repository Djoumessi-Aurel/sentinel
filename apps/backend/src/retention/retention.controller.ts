import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { AuthGuard } from '../common/auth/auth.guard';
import { RetentionService, type PurgeReport } from './retention.service';

@Controller('retention')
@UseGuards(AuthGuard)
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  /**
   * Déclenche la purge immédiatement, sans attendre le passage nocturne.
   *
   * Utile après avoir raccourci une durée de rétention : sans cela, l'effet du
   * réglage ne serait visible que le lendemain, et on ne saurait pas s'il a
   * réellement été pris en compte.
   */
  @Post('purge')
  @HttpCode(HttpStatus.OK)
  async purge(): Promise<{ status: 'ok' | 'busy'; report: PurgeReport | null }> {
    const report = await this.retention.purge();
    return { status: report ? 'ok' : 'busy', report };
  }
}
