import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { createServerSchema, type CreateServerDto, type Server } from '@sentinel/shared-types';

import { AuthGuard } from '../common/auth/auth.guard';
import { zodBody } from '../common/pipes/zod-validation.pipe';
import { ServersService } from './servers.service';

@Controller('servers')
@UseGuards(AuthGuard)
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get()
  list(): Promise<Server[]> {
    return this.servers.list();
  }

  @Post()
  create(@Body(zodBody(createServerSchema)) dto: CreateServerDto): Promise<Server> {
    return this.servers.create(dto);
  }
}
