import { Global, Module } from '@nestjs/common';
import { RedactionService } from './redaction.service';

@Global()
@Module({
  providers: [RedactionService],
  exports: [RedactionService],
})
export class RedactionModule {}
