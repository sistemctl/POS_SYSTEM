import { Injectable, Logger } from '@nestjs/common';
import type { HeartbeatDto, SyncEvento, SyncPullResponse, SyncPushResponse } from '@pos/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { CursorPull, LIMITE_PULL, TABLAS_MAESTRAS } from './tablas-maestras';

/** Lógica del lado CENTRAL: recibe eventos de las tiendas y entrega cambios de datos maestros. */
@Injectable()
export class SyncCentralService {
  private readonly log = new Logger('SyncCentral');

  constructor(private readonly prisma: PrismaService) {}

  // ───────── PUSH (tienda → central) ─────────

  async recibir(sucursalId: string, eventos: SyncEvento[]): Promise<SyncPushResponse> {
    const aceptados: string[] = [];
    const rechazados: { id: string; error: string }[] = [];

    for (const ev of eventos) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const ya = await tx.syncRecibido.findUnique({ where: { id: ev.id } });
          if (ya) return; // idempotente: ya aplicado
          await this.aplicar(tx, sucursalId, ev);
          await tx.syncRecibido.create({ data: { id: ev.id, sucursalId, entidad: ev.entidad } });
        });
        aceptados.push(ev.id);
      } catch (e: any) {
        this.log.warn(`Evento ${ev.id} (${ev.entidad}) rechazado: ${e.message}`);
        rechazados.push({ id: ev.id, error: String(e.message).slice(0, 500) });
      }
    }
    return { aceptados, rechazados };
  }

  private async aplicar(tx: Tx, sucursalId: string, ev: SyncEvento) {
    const p = ev.payload as any;
    // Una tienda solo puede escribir datos de su propia sucursal
    if (p.sucursalId && p.sucursalId !== sucursalId) {
      throw new Error('El evento pertenece a otra sucursal');
    }
    switch (ev.entidad) {
      case 'cliente': {
        await tx.cliente.upsert({ where: { id: p.id }, create: p, update: p });
        break;
      }
      case 'turno_caja': {
        await tx.turnoCaja.upsert({ where: { id: p.id }, create: p, update: p });
        break;
      }
      case 'movimiento_caja': {
        await tx.movimientoCaja.upsert({ where: { id: p.id }, create: p, update: p });
        break;
      }
      case 'movimiento_inventario': {
        await tx.movimientoInventario.upsert({ where: { id: p.id }, create: p, update: p });
        break;
      }
      case 'auditoria': {
        await tx.auditoria.upsert({ where: { id: p.id }, create: p, update: p });
        break;
      }
      case 'venta': {
        const { detalles, pagos, ...cabecera } = p;
        const existe = await tx.venta.findUnique({ where: { id: p.id }, select: { id: true } });
        if (existe) {
          await tx.venta.update({ where: { id: p.id }, data: cabecera });
        } else {
          await tx.venta.create({
            data: {
              ...cabecera,
              detalles: { create: (detalles ?? []).map(({ ventaId, ...d }: any) => d) },
              pagos: { create: (pagos ?? []).map(({ ventaId, ...d }: any) => d) },
            },
          });
        }
        break;
      }
      default:
        throw new Error(`Entidad desconocida: ${ev.entidad}`);
    }
  }

  // ───────── PULL (central → tienda) ─────────

  async cambios(cursorRaw: string | undefined): Promise<SyncPullResponse> {
    const cursor: CursorPull = cursorRaw ? JSON.parse(Buffer.from(cursorRaw, 'base64url').toString()) : {};
    const nuevo: CursorPull = { ...cursor };
    let hayMas = false;
    const cambios: SyncPullResponse['cambios'] = [];

    for (const { tabla, omitir } of TABLAS_MAESTRAS) {
      const c = cursor[tabla];
      const where = c
        ? {
            OR: [
              { updatedAt: { gt: new Date(c.t) } },
              { updatedAt: new Date(c.t), id: { gt: c.id } },
            ],
          }
        : {};
      const filas: any[] = await (this.prisma as any)[tabla].findMany({
        where,
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: LIMITE_PULL,
      });
      if (filas.length === LIMITE_PULL) hayMas = true;
      if (filas.length) {
        const ultima = filas[filas.length - 1];
        nuevo[tabla] = { t: ultima.updatedAt.toISOString(), id: ultima.id };
        for (const f of filas) for (const o of omitir ?? []) delete f[o];
        cambios.push({ tabla, filas: JSON.parse(JSON.stringify(filas)) });
      }
    }

    return {
      cursor: Buffer.from(JSON.stringify(nuevo)).toString('base64url'),
      hayMas,
      cambios,
    };
  }

  // ───────── Heartbeat / monitoreo ─────────

  async heartbeat(sucursalId: string, data: HeartbeatDto) {
    await this.prisma.sucursalEstado.upsert({
      where: { sucursalId },
      create: { sucursalId, data: data as any, ultimoHeartbeat: new Date() },
      update: { data: data as any, ultimoHeartbeat: new Date() },
    });
  }
}
