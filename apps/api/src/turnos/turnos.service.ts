import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { newId, PERMISOS } from '@pos/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthService } from '../auth/auth.service';
import { BackupService } from '../backup/backup.service';
import { JwtUser } from '../common/decorators';
import { AppConfig } from '../config/app-config';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { OutboxService } from '../sync/outbox.service';

@Injectable()
export class TurnosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly outbox: OutboxService,
    private readonly auditoria: AuditoriaService,
    private readonly backup: BackupService,
  ) {}

  actual(cajaId: string) {
    return this.prisma.turnoCaja.findFirst({ where: { cajaId, estado: 'ABIERTO' } });
  }

  async abrir(user: JwtUser, montoInicial: string) {
    if (!user.cajaId) throw new BadRequestException('La sesión no está asociada a una caja');
    return this.prisma.$transaction(async (tx) => {
      const abierto = await tx.turnoCaja.findFirst({ where: { cajaId: user.cajaId!, estado: 'ABIERTO' } });
      if (abierto) {
        if (abierto.usuarioId === user.sub) return abierto;
        const u = await tx.usuario.findUnique({ where: { id: abierto.usuarioId }, select: { nombre: true } });
        throw new BadRequestException(`La caja tiene un turno abierto de ${u?.nombre}. Debe cerrarse primero.`);
      }
      const turno = await tx.turnoCaja.create({
        data: {
          id: newId(),
          sucursalId: this.config.sucursalId!,
          cajaId: user.cajaId!,
          usuarioId: user.sub,
          montoInicial,
        },
      });
      await this.outbox.encolar(tx, 'turno_caja', turno.id, turno);
      return turno;
    });
  }

  /** Resumen del turno (reporte X): totales por método de pago y efectivo esperado en caja. */
  async resumen(turnoId: string, db: Tx | PrismaService = this.prisma) {
    const turno = await db.turnoCaja.findUnique({ where: { id: turnoId } });
    if (!turno) throw new NotFoundException('Turno no encontrado');
    const ventas = await db.venta.findMany({ where: { turnoId }, include: { pagos: true } });
    const movimientos = await db.movimientoCaja.findMany({ where: { turnoId }, orderBy: { creadoEn: 'asc' } });

    const porMetodo: Record<string, Decimal> = {};
    let totalVentas = new Decimal(0);
    let totalDescuentos = new Decimal(0);
    let anuladas = 0;
    let totalAnulado = new Decimal(0);
    let vueltos = new Decimal(0);
    for (const v of ventas) {
      if (v.estado === 'ANULADA') {
        anuladas++;
        totalAnulado = totalAnulado.plus(v.total.toString());
        continue;
      }
      totalVentas = totalVentas.plus(v.total.toString());
      totalDescuentos = totalDescuentos.plus(v.descuento.toString());
      vueltos = vueltos.plus(v.vuelto.toString());
      for (const p of v.pagos) {
        porMetodo[p.metodo] = (porMetodo[p.metodo] ?? new Decimal(0)).plus(p.monto.toString());
      }
    }
    const retiros = movimientos.filter((m) => m.tipo === 'RETIRO').reduce((s, m) => s.plus(m.monto.toString()), new Decimal(0));
    const ingresos = movimientos.filter((m) => m.tipo === 'INGRESO').reduce((s, m) => s.plus(m.monto.toString()), new Decimal(0));
    const efectivoVentas = (porMetodo['EFECTIVO'] ?? new Decimal(0)).minus(vueltos);
    const efectivoEsperado = new Decimal(turno.montoInicial.toString()).plus(efectivoVentas).plus(ingresos).minus(retiros);

    return {
      turno,
      cantidadVentas: ventas.length - anuladas,
      totalVentas: totalVentas.toFixed(2),
      totalDescuentos: totalDescuentos.toFixed(2),
      anuladas,
      totalAnulado: totalAnulado.toFixed(2),
      porMetodo: Object.fromEntries(
        Object.entries(porMetodo).map(([k, v]) => [k, k === 'EFECTIVO' ? v.minus(vueltos).toFixed(2) : v.toFixed(2)]),
      ),
      montoInicial: turno.montoInicial.toFixed(2),
      retiros: retiros.toFixed(2),
      ingresos: ingresos.toFixed(2),
      efectivoEsperado: efectivoEsperado.toFixed(2),
      movimientos,
    };
  }

  /** Cierre con arqueo: el cajero cuenta billetes y monedas, se compara con lo esperado. */
  async cerrar(user: JwtUser, turnoId: string, conteo: Record<string, number>, montoDeclarado: string, observacion?: string) {
    const r = await this.prisma.$transaction(async (tx) => {
      const turno = await tx.turnoCaja.findUnique({ where: { id: turnoId } });
      if (!turno || turno.estado !== 'ABIERTO') throw new BadRequestException('El turno no está abierto');
      if (turno.usuarioId !== user.sub && !user.permisos.includes(PERMISOS.TURNO_VER_TODOS)) {
        throw new ForbiddenException('Solo el cajero del turno o un supervisor puede cerrarlo');
      }
      const res = await this.resumen(turnoId, tx);
      const diferencia = new Decimal(montoDeclarado).minus(res.efectivoEsperado);
      const cerrado = await tx.turnoCaja.update({
        where: { id: turnoId },
        data: {
          estado: 'CERRADO',
          cerradoEn: new Date(),
          cerradoPorId: user.sub,
          montoCierreDeclarado: montoDeclarado,
          montoCierreEsperado: res.efectivoEsperado,
          diferencia: diferencia.toFixed(2),
          resumen: {
            conteo,
            observacion: observacion ?? null,
            porMetodo: res.porMetodo,
            cantidadVentas: res.cantidadVentas,
            totalVentas: res.totalVentas,
            totalDescuentos: res.totalDescuentos,
            anuladas: res.anuladas,
            totalAnulado: res.totalAnulado,
            retiros: res.retiros,
            ingresos: res.ingresos,
          },
        },
      });
      await this.outbox.encolar(tx, 'turno_caja', cerrado.id, cerrado);
      if (!diferencia.isZero()) {
        await this.auditoria.registrar(
          {
            sucursalId: turno.sucursalId,
            usuarioId: user.sub,
            accion: 'turno.diferencia_arqueo',
            entidad: 'turno_caja',
            entidadId: turnoId,
            detalle: { esperado: res.efectivoEsperado, declarado: montoDeclarado, diferencia: diferencia.toFixed(2) },
            motivo: observacion,
          },
          tx,
        );
      }
      return { ...res, turno: cerrado, diferencia: diferencia.toFixed(2), montoDeclarado };
    });
    // Backup automático tras cada cierre de turno (no bloquea la respuesta)
    this.backup.ejecutar('CIERRE_TURNO').catch(() => undefined);
    return r;
  }

  async movimiento(
    user: JwtUser,
    turnoId: string,
    d: { tipo: 'RETIRO' | 'INGRESO'; monto: string; motivo: string; autorizacionIds: string[] },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const turno = await tx.turnoCaja.findUnique({ where: { id: turnoId } });
      if (!turno || turno.estado !== 'ABIERTO') throw new BadRequestException('El turno no está abierto');
      if (turno.cajaId !== user.cajaId) throw new BadRequestException('El turno no corresponde a esta caja');
      let supervisor: string | null = null;
      if (d.tipo === 'RETIRO') {
        const propio = user.permisos.includes(PERMISOS.CAJA_RETIRO) && Number(d.monto) <= user.retiroMaximo;
        if (!propio) {
          supervisor = await this.auth.exigirPermiso(tx, user, PERMISOS.CAJA_RETIRO, d.autorizacionIds, true);
          const limite = await this.auth.limiteAutorizado(user, 'retiroMaximo', supervisor);
          if (Number(d.monto) > limite) throw new ForbiddenException(`El retiro máximo autorizado es ${limite}`);
        }
        const res = await this.resumen(turnoId, tx);
        if (new Decimal(d.monto).gt(res.efectivoEsperado)) {
          throw new BadRequestException(`No hay suficiente efectivo en caja (esperado: ${res.efectivoEsperado})`);
        }
      } else {
        supervisor = await this.auth.exigirPermiso(tx, user, PERMISOS.CAJA_INGRESO, d.autorizacionIds);
      }
      const mov = await tx.movimientoCaja.create({
        data: {
          id: newId(),
          turnoId,
          tipo: d.tipo,
          monto: d.monto,
          motivo: d.motivo,
          usuarioId: user.sub,
          autorizadoPorId: supervisor,
        },
      });
      await this.outbox.encolar(tx, 'movimiento_caja', mov.id, mov);
      await this.auditoria.registrar(
        { sucursalId: turno.sucursalId, usuarioId: user.sub, autorizadoPorId: supervisor, accion: `caja.${d.tipo.toLowerCase()}`, entidad: 'movimiento_caja', entidadId: mov.id, motivo: d.motivo, detalle: { monto: d.monto } },
        tx,
      );
      return mov;
    });
  }

  listar(f: { sucursalId?: string | null; usuarioId?: string; cajaId?: string; desde?: Date; hasta?: Date }) {
    return this.prisma.turnoCaja.findMany({
      where: {
        sucursalId: f.sucursalId ?? undefined,
        usuarioId: f.usuarioId,
        cajaId: f.cajaId,
        abiertoEn: { gte: f.desde, lte: f.hasta },
      },
      orderBy: { abiertoEn: 'desc' },
      take: 200,
    });
  }
}
