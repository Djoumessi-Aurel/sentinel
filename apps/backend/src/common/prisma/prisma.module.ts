import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global : l'accès à la base est transverse, et le répéter dans les `imports`
 * de chaque module n'apporte rien de plus qu'une ligne à oublier.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
