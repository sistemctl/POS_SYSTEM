import { BadRequestException, Body, Controller, Get, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { newId, PERMISOS } from '@pos/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CurrentUser, JwtUser, RequirePermission, StoreOperation } from '../common/decorators';
import { decimal, decimalNoNegativo, decimalPositivo } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from '../sync/outbox.service';

/**
 * Inventario como libro mayor (ledger): el stock = suma de movimientos.
 * Las tiendas solo agregan movimientos, nunca sobrescriben el stock → no hay conflictos al sincronizar.
 */
@Injectable()
export class InventarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly outbox: OutboxService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async stock(sucursalId: string | null, f: { buscar?: string; bajoMinimo?: boolean }) {
    const buscar = f.buscar ? `%${f.buscar}%` : null;
    const filas = await this.prisma.$queryRaw<
      { id: string; sku: string; nombre: string; unidad: string; pesable: boolean; stockMinimo: Prisma.Decimal; costo: Prisma.Decimal; stock: Prisma.Decimal | null }[]
    >`
      SELECT p.id, p.sku, p.nombre, p.unidad, p.pesable, p."stockMinimo", p.costo,
             COALESCE(SUM(m.cantidad), 0) AS stock
      FROM "Producto" p
      LEFT JOIN "MovimientoInventario" m
        ON m."productoId" = p.id
       AND (${sucursalId}::uuid IS NULL OR m."sucursalId" = ${sucursalId}::uuid)
      WHERE p."deletedAt" IS NULL AND p.activo = true
        AND (${buscar}::text IS NULL OR p.nombre ILIKE ${buscar} OR p.sku ILIKE ${buscar}
             OR p.plu = ${f.buscar ?? null}
             OR EXISTS (SELECT 1 FROM "ProductoCodigo" c
                        WHERE c."productoId" = p.id AND c."deletedAt" IS NULL AND c.codigo = ${f.buscar ?? null}))
      GROUP BY p.id
      ORDER BY p.nombre
      LIMIT 2000`;
    const r = filas.map((x) => ({
      ...x,
      stock: new Decimal(x.stock?.toString() ?? 0).toFixed(3),
      stockMinimo: x.stockMinimo.toString(),
      costo: x.costo.toString(),
      bajoMinimo: new Decimal(x.stock?.toString() ?? 0).lte(x.stockMinimo.toString()),
    }));
    return f.bajoMinimo ? r.filter((x) => x.bajoMinimo) : r;
  }

  /** Producto exacto por código de barras, SKU o PLU, con su existencia (para escanear al recibir mercancía). */
  async porCodigo(sucursalId: string | null, codigo: string) {
    const c = codigo.trim();
    const p = await this.prisma.producto.findFirst({
      where: { deletedAt: null, activo: true, OR: [{ sku: c }, { plu: c }, { codigos: { some: { codigo: c, deletedAt: null } } }] },
    });
    if (!p) throw new NotFoundException(`No existe un producto con el código ${c}`);
    const agg = await this.prisma.movimientoInventario.aggregate({
      where: { productoId: p.id, ...(sucursalId ? { sucursalId } : {}) },
      _sum: { cantidad: true },
    });
    const stock = new Decimal(agg._sum.cantidad?.toString() ?? 0);
    return {
      id: p.id,
      sku: p.sku,
      nombre: p.nombre,
      unidad: p.unidad,
      pesable: p.pesable,
      precio: p.precio.toString(),
      costo: p.costo.toString(),
      stockMinimo: p.stockMinimo.toString(),
      stock: stock.toFixed(3),
      bajoMinimo: stock.lte(p.stockMinimo.toString()),
    };
  }

  /** Historial del producto, del más reciente al más antiguo, con el saldo que quedó tras cada movimiento. */
  async kardex(sucursalId: string | null, productoId: string) {
    const where = { productoId, ...(sucursalId ? { sucursalId } : {}) };
    const [movs, total] = await Promise.all([
      this.prisma.movimientoInventario.findMany({ where, orderBy: { creadoEn: 'desc' }, take: 500 }),
      this.prisma.movimientoInventario.aggregate({ where, _sum: { cantidad: true } }),
    ]);
    let saldo = new Decimal(total._sum.cantidad?.toString() ?? 0);
    return movs.map((m) => {
      const fila = { ...m, saldo: saldo.toFixed(3) };
      saldo = saldo.minus(m.cantidad.toString());
      return fila;
    });
  }

  /**
   * Conteo físico: el usuario dice cuántas unidades hay realmente y el sistema
   * registra la diferencia como AJUSTE (nadie tiene que calcular +/−).
   */
  async conteo(user: JwtUser, items: { productoId: string; contado: string }[], motivo: string | null) {
    const sucursalId = this.config.sucursalId!;
    const referenciaId = newId();
    return this.prisma.$transaction(async (tx) => {
      const filas = await tx.movimientoInventario.groupBy({
        by: ['productoId'],
        where: { sucursalId, productoId: { in: items.map((i) => i.productoId) } },
        _sum: { cantidad: true },
      });
      const actual = new Map(filas.map((f) => [f.productoId, new Decimal(f._sum.cantidad?.toString() ?? 0)]));
      const resultado = [];
      for (const it of items) {
        const sistema = actual.get(it.productoId) ?? new Decimal(0);
        const contado = new Decimal(it.contado);
        const diferencia = contado.minus(sistema);
        resultado.push({ productoId: it.productoId, sistema: sistema.toFixed(3), contado: contado.toFixed(3), diferencia: diferencia.toFixed(3) });
        if (diferencia.isZero()) continue;
        const mov = await tx.movimientoInventario.create({
          data: {
            id: newId(),
            sucursalId,
            productoId: it.productoId,
            tipo: 'AJUSTE',
            cantidad: diferencia.toFixed(3),
            referenciaId,
            motivo: `${motivo || 'Conteo físico'} · sistema ${sistema.toString()} → contado ${contado.toString()}`,
            usuarioId: user.sub,
          },
        });
        await this.outbox.encolar(tx, 'movimiento_inventario', mov.id, mov);
      }
      await this.auditoria.registrar(
        { sucursalId, usuarioId: user.sub, accion: 'inventario.conteo', entidad: 'movimiento_inventario', entidadId: referenciaId, motivo, detalle: { items: resultado } },
        tx,
      );
      return { referenciaId, items: resultado };
    });
  }

  async registrar(
    user: JwtUser,
    tipo: 'COMPRA' | 'AJUSTE' | 'MERMA',
    items: { productoId: string; cantidad: string; costoUnitario?: string }[],
    motivo: string | null,
    documento?: string | null,
  ) {
    const sucursalId = this.config.sucursalId!;
    const referenciaId = newId();
    return this.prisma.$transaction(async (tx) => {
      const movs = [];
      for (const it of items) {
        let cantidad = new Decimal(it.cantidad);
        if (tipo === 'COMPRA' && cantidad.lte(0)) throw new BadRequestException('Cantidad de compra debe ser positiva');
        if (tipo === 'MERMA') cantidad = cantidad.abs().negated();
        const mov = await tx.movimientoInventario.create({
          data: {
            id: newId(),
            sucursalId,
            productoId: it.productoId,
            tipo,
            cantidad: cantidad.toFixed(3),
            costoUnitario: it.costoUnitario ?? null,
            referenciaId,
            motivo: [motivo, documento].filter(Boolean).join(' · ') || null,
            usuarioId: user.sub,
          },
        });
        await this.outbox.encolar(tx, 'movimiento_inventario', mov.id, mov);
        movs.push(mov);
      }
      await this.auditoria.registrar(
        { sucursalId, usuarioId: user.sub, accion: `inventario.${tipo.toLowerCase()}`, entidad: 'movimiento_inventario', entidadId: referenciaId, motivo, detalle: { documento, items } },
        tx,
      );
      return { referenciaId, movimientos: movs };
    });
  }
}

const compraSchema = z.object({
  documento: z.string().max(100).nullable().optional(),
  proveedor: z.string().max(200).nullable().optional(),
  items: z.array(z.object({ productoId: z.string().uuid(), cantidad: decimalPositivo, costoUnitario: decimalNoNegativo.optional() })).min(1),
});
const ajusteSchema = z.object({
  tipo: z.enum(['AJUSTE', 'MERMA']),
  motivo: z.string().min(3).max(300),
  items: z.array(z.object({ productoId: z.string().uuid(), cantidad: decimal })).min(1),
});
const conteoSchema = z.object({
  motivo: z.string().max(300).nullable().optional(),
  items: z.array(z.object({ productoId: z.string().uuid(), contado: decimalNoNegativo })).min(1),
});

@Controller('inventario')
class InventarioController {
  constructor(private readonly svc: InventarioService) {}

  @RequirePermission(PERMISOS.INVENTARIO_VER)
  @Get('stock')
  stock(@CurrentUser() u: JwtUser, @Query('buscar') buscar?: string, @Query('bajoMinimo') bajoMinimo?: string, @Query('sucursalId') sucursalId?: string) {
    return this.svc.stock(u.sucursalId ?? (sucursalId || null), { buscar: buscar || undefined, bajoMinimo: bajoMinimo === 'true' });
  }

  @RequirePermission(PERMISOS.INVENTARIO_VER)
  @Get('producto/:codigo')
  porCodigo(@CurrentUser() u: JwtUser, @Param('codigo') codigo: string) {
    return this.svc.porCodigo(u.sucursalId, codigo);
  }

  @RequirePermission(PERMISOS.INVENTARIO_VER)
  @Get('kardex/:productoId')
  kardex(@CurrentUser() u: JwtUser, @Param('productoId', ParseUUIDPipe) productoId: string) {
    return this.svc.kardex(u.sucursalId, productoId);
  }

  @StoreOperation()
  @RequirePermission(PERMISOS.COMPRA_REGISTRAR)
  @Post('compras')
  compra(@CurrentUser() u: JwtUser, @Body(new ZodPipe(compraSchema)) b: z.infer<typeof compraSchema>) {
    return this.svc.registrar(u, 'COMPRA', b.items, b.proveedor ? `Proveedor: ${b.proveedor}` : null, b.documento);
  }

  @StoreOperation()
  @RequirePermission(PERMISOS.INVENTARIO_AJUSTAR)
  @Post('ajustes')
  ajuste(@CurrentUser() u: JwtUser, @Body(new ZodPipe(ajusteSchema)) b: z.infer<typeof ajusteSchema>) {
    return this.svc.registrar(u, b.tipo, b.items, b.motivo);
  }

  @StoreOperation()
  @RequirePermission(PERMISOS.INVENTARIO_AJUSTAR)
  @Post('conteo')
  conteo(@CurrentUser() u: JwtUser, @Body(new ZodPipe(conteoSchema)) b: z.infer<typeof conteoSchema>) {
    return this.svc.conteo(u, b.items, b.motivo ?? null);
  }
}

@Module({
  controllers: [InventarioController],
  providers: [InventarioService],
})
export class InventarioModule {}
