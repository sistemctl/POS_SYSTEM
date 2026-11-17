import { Injectable } from '@nestjs/common';
import { newId } from '@pos/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { OutboxService } from '../sync/outbox.service';

export interface RegistroAuditoria {
  sucursalId?: string | null;
  usuarioId?: string | null;
  autorizadoPorId?: string | null;
  accion: string;
  entidad?: string;
  entidadId?: string;
  detalle?: unknown;
  motivo?: string | null;
}

@Injectable()
export class AuditoriaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async registrar(r: RegistroAuditoria, tx?: Tx) {
    const db = tx ?? this.prisma;
    const row = await db.auditoria.create({
      data: {
        id: newId(),
        sucursalId: r.sucursalId ?? null,
        usuarioId: r.usuarioId ?? null,
        autorizadoPorId: r.autorizadoPorId ?? null,
        accion: r.accion,
        entidad: r.entidad,
        entidadId: r.entidadId,
        detalle: (r.detalle ?? undefined) as any,
        motivo: r.motivo ?? null,
      },
    });
    await this.outbox.encolar(db, 'auditoria', row.id, row);
    return row;
  }

  listar(filtro: { sucursalId?: string; accion?: string; desde?: Date; hasta?: Date; limite?: number }) {
    return this.prisma.auditoria.findMany({
      where: {
        sucursalId: filtro.sucursalId,
        accion: filtro.accion,
        creadoEn: { gte: filtro.desde, lte: filtro.hasta },
      },
      orderBy: { creadoEn: 'desc' },
      take: Math.min(filtro.limite ?? 200, 1000),
    });
  }
}
