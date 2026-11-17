import { Controller, ForbiddenException, Get, Injectable, Module, Query } from '@nestjs/common';
import { PERMISOS } from '@pos/shared';
import { CurrentUser, JwtUser, RequirePermission } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

interface Rango {
  sucursalId: string | null;
  desde: Date;
  hasta: Date;
}

/** Convierte Decimal/BigInt de consultas SQL a tipos serializables */
function limpiar<T extends Record<string, any>>(filas: T[]) {
  return filas.map((f) =>
    Object.fromEntries(
      Object.entries(f).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v?.constructor?.name === 'Decimal' ? v.toString() : v]),
    ),
  );
}

@Injectable()
class ReportesService {
  constructor(private readonly prisma: PrismaService) {}

  async ventasDiarias({ sucursalId, desde, hasta }: Rango) {
    return limpiar(await this.prisma.$queryRaw<any[]>`
      SELECT to_char(date_trunc('day', v.fecha), 'YYYY-MM-DD') AS dia,
             COUNT(*) AS tickets,
             SUM(v.total) AS total,
             SUM(v.descuento) AS descuento,
             SUM(v.impuesto) AS impuesto,
             ROUND(AVG(v.total), 2) AS "ticketPromedio"
      FROM "Venta" v
      WHERE v.estado = 'COMPLETADA' AND v.fecha BETWEEN ${desde} AND ${hasta}
        AND (${sucursalId}::uuid IS NULL OR v."sucursalId" = ${sucursalId}::uuid)
      GROUP BY 1 ORDER BY 1`);
  }

  async porCajero({ sucursalId, desde, hasta }: Rango) {
    return limpiar(await this.prisma.$queryRaw<any[]>`
      SELECT u.nombre AS cajero, COUNT(*) AS tickets, SUM(v.total) AS total,
             SUM(CASE WHEN v.estado = 'ANULADA' THEN 1 ELSE 0 END) AS anuladas
      FROM "Venta" v JOIN "Usuario" u ON u.id = v."usuarioId"
      WHERE v.fecha BETWEEN ${desde} AND ${hasta}
        AND (${sucursalId}::uuid IS NULL OR v."sucursalId" = ${sucursalId}::uuid)
      GROUP BY u.nombre ORDER BY total DESC`);
  }

  async porCaja({ sucursalId, desde, hasta }: Rango) {
    return limpiar(await this.prisma.$queryRaw<any[]>`
      SELECT s.nombre AS sucursal, c.nombre AS caja, COUNT(*) AS tickets, SUM(v.total) AS total
      FROM "Venta" v JOIN "Caja" c ON c.id = v."cajaId" JOIN "Sucursal" s ON s.id = v."sucursalId"
      WHERE v.estado = 'COMPLETADA' AND v.fecha BETWEEN ${desde} AND ${hasta}
        AND (${sucursalId}::uuid IS NULL OR v."sucursalId" = ${sucursalId}::uuid)
      GROUP BY s.nombre, c.nombre ORDER BY s.nombre, c.nombre`);
  }

  /** Ventas por producto con margen (precio sin impuesto - costo) */
  async porProducto({ sucursalId, desde, hasta }: Rango) {
    return limpiar(await this.prisma.$queryRaw<any[]>`
      SELECT d."productoId", d.descripcion AS producto,
             SUM(d.cantidad) AS cantidad,
             SUM(d.total) AS total,
             SUM(d."baseImponible") AS "ventaNeta",
             SUM(d."costoUnitario" * d.cantidad) AS costo,
             SUM(d."baseImponible") - SUM(d."costoUnitario" * d.cantidad) AS margen,
             CASE WHEN SUM(d."baseImponible") > 0
                  THEN ROUND((SUM(d."baseImponible") - SUM(d."costoUnitario" * d.cantidad)) / SUM(d."baseImponible") * 100, 2)
                  ELSE 0 END AS "margenPorcentaje"
      FROM "VentaDetalle" d JOIN "Venta" v ON v.id = d."ventaId"
      WHERE v.estado = 'COMPLETADA' AND v.fecha BETWEEN ${desde} AND ${hasta}
        AND (${sucursalId}::uuid IS NULL OR v."sucursalId" = ${sucursalId}::uuid)
      GROUP BY d."productoId", d.descripcion
      ORDER BY total DESC
      LIMIT 500`);
  }

  async porMetodoPago({ sucursalId, desde, hasta }: Rango) {
    return limpiar(await this.prisma.$queryRaw<any[]>`
      SELECT p.metodo, COUNT(*) AS cantidad,
             SUM(CASE WHEN p.metodo = 'EFECTIVO' THEN p.monto - v.vuelto ELSE p.monto END) AS total
      FROM "VentaPago" p JOIN "Venta" v ON v.id = p."ventaId"
      WHERE v.estado = 'COMPLETADA' AND v.fecha BETWEEN ${desde} AND ${hasta}
        AND (${sucursalId}::uuid IS NULL OR v."sucursalId" = ${sucursalId}::uuid)
      GROUP BY p.metodo ORDER BY total DESC`);
  }
}

@Controller('reportes')
class ReportesController {
  constructor(private readonly svc: ReportesService) {}

  private rango(u: JwtUser, desde?: string, hasta?: string, sucursalId?: string): Rango {
    const hoy = new Date();
    const d = desde ? new Date(`${desde}T00:00:00`) : new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const h = hasta ? new Date(`${hasta}T23:59:59.999`) : new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59, 999);
    let suc = u.sucursalId;
    if (!suc) {
      if (!u.permisos.includes(PERMISOS.REPORTE_GLOBAL)) throw new ForbiddenException('Sin acceso a reportes globales');
      suc = sucursalId || null;
    }
    return { sucursalId: suc, desde: d, hasta: h };
  }

  @RequirePermission(PERMISOS.REPORTE_SUCURSAL)
  @Get('resumen')
  async resumen(@CurrentUser() u: JwtUser, @Query('desde') desde?: string, @Query('hasta') hasta?: string, @Query('sucursalId') s?: string) {
    const r = this.rango(u, desde, hasta, s);
    const [diario, cajeros, cajas, productos, metodos] = await Promise.all([
      this.svc.ventasDiarias(r),
      this.svc.porCajero(r),
      this.svc.porCaja(r),
      this.svc.porProducto(r),
      this.svc.porMetodoPago(r),
    ]);
    return { rango: r, diario, cajeros, cajas, productos, metodos };
  }
}

@Module({
  controllers: [ReportesController],
  providers: [ReportesService],
})
export class ReportesModule {}
