import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateServerDto, Server } from '@sentinel/shared-types';

import { PrismaService } from '../common/prisma/prisma.service';

@Injectable()
export class ServersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<Server[]> {
    const rows = await this.prisma.server.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => this.toDto(row));
  }

  async create(dto: CreateServerDto): Promise<Server> {
    return this.toDto(await this.prisma.server.create({ data: dto }));
  }

  async getOrThrow(id: string): Promise<Server> {
    const row = await this.prisma.server.findUnique({ where: { id } });
    if (!row) throw new NotFoundException(`Serveur ${id} introuvable`);
    return this.toDto(row);
  }

  private toDto(row: { id: string; name: string; host: string; createdAt: Date; updatedAt: Date }): Server {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
