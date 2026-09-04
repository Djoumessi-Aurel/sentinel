import { Module } from '@nestjs/common';
import { LogsQueryController } from './logs-query.controller';

@Module({ controllers: [LogsQueryController] })
export class LogsQueryModule {}
