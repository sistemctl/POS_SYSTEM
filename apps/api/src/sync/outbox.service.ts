import { Injectable } from '@nestjs/common';
import { EntidadSync, newId } from '@pos/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService, Tx } from '../prisma/prisma.service';

/**
 * Patrón outbox: cada cambio transaccional de la tienda se guarda en la MISMA transacción
 * junto con un evento en sync_outbox. Un worker lo sube al central cuando hay internet.
 */
@Injectable()
export class OutboxService {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async encolar(db: Tx | PrismaService, entidad: EntidadSync, entidadId: string, payload: unknown) {
    if (!this.config.isStore) return; // el central no reenvía a nadie
    await db.syncOutbox.create({
      data: {
        id: newId(),
        entidad,
        entidadId,
        payload: JSON.parse(JSON.stringify(payload)),
      },
    });
  }

  pendientes() {
    return this.prisma.syncOutbox.count({ where: { enviadoEn: null } });
  }
}
