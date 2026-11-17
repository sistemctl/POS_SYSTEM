import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const CLAVES = {
  ULTIMO_PUSH: 'ultimo_push',
  ULTIMO_PULL: 'ultimo_pull',
  CURSOR_PULL: 'cursor_pull',
  ONLINE: 'central_online',
} as const;

@Injectable()
export class SyncEstadoService {
  constructor(private readonly prisma: PrismaService) {}

  async get(clave: string): Promise<string | null> {
    const r = await this.prisma.syncEstado.findUnique({ where: { clave } });
    return r?.valor ?? null;
  }

  async set(clave: string, valor: string) {
    await this.prisma.syncEstado.upsert({
      where: { clave },
      create: { clave, valor },
      update: { valor },
    });
  }
}
