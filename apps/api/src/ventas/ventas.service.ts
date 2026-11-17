import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  calcularPago,
  calcularVenta,
  formatTicketNumber,
  mismoMonto,
  newId,
  PERMISOS,
} from '@pos/shared';
import type { CrearVentaDto, CrearVentaResponse, TicketData } from '@pos/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthService } from '../auth/auth.service';
import { CatalogoService } from '../catalogo/catalogo.service';
import { JwtUser } from '../common/decorators';
import { ComprobanteProvider } from '../comprobantes/comprobante.provider';
import { AppConfig } from '../config/app-config';
import { MediaService } from '../media/media.module';
import { ParametrosService } from '../parametros/parametros.module';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { OutboxService } from '../sync/outbox.service';

const METODO_TEXTO: Record<string, string> = {
  EFECTIVO: 'Efectivo',
  TARJETA: 'Tarjeta',
  TRANSFERENCIA: 'Transferencia',
  BILLETERA: 'Billetera digital',
  OTRO: 'Otro',
};

@Injectable()
export class VentasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly auth: AuthService,
    private readonly catalogo: CatalogoService,
    private readonly outbox: OutboxService,
    private readonly auditoria: AuditoriaService,
    private readonly comprobante: ComprobanteProvider,
    private readonly parametros: ParametrosService,
    private readonly media: MediaService,
  ) {}

  private sucursalId(): string {
    return this.config.sucursalId!;
  }

  /** Si la configuración no permite vender sin stock, verifica existencias (ledger de movimientos). */
  private async verificarStock(
    tx: Tx,
    sucursalId: string,
    items: CrearVentaDto['items'],
    porId: Map<string, { nombre: string }>,
  ) {
    const pedido = new Map<string, Decimal>();
    for (const i of items) pedido.set(i.productoId, (pedido.get(i.productoId) ?? new Decimal(0)).plus(i.cantidad));
    const ids = [...pedido.keys()];
    const filas = await tx.movimientoInventario.groupBy({
      by: ['productoId'],
      where: { sucursalId, productoId: { in: ids } },
      _sum: { cantidad: true },
    });
    const stock = new Map(filas.map((f) => [f.productoId, new Decimal(f._sum.cantidad?.toString() ?? 0)]));
    for (const [id, cant] of pedido) {
      const hay = stock.get(id) ?? new Decimal(0);
      if (hay.lt(cant)) {
        throw new BadRequestException(`Sin stock suficiente de "${porId.get(id)?.nombre}" (disponible: ${hay.toString()})`);
      }
    }
  }

  /** Registra una venta. Idempotente por id (la caja puede reintentar sin duplicar). */
  async crear(user: JwtUser, dto: CrearVentaDto): Promise<CrearVentaResponse> {
    const existente = await this.prisma.venta.findUnique({ where: { id: dto.id } });
    if (existente) {
      return {
        ventaId: existente.id,
        numero: existente.numeroCompleto,
        total: existente.total.toFixed(2),
        vuelto: existente.vuelto.toFixed(2),
        ticket: await this.ticket(existente.id),
      };
    }
    if (!user.cajaId) throw new BadRequestException('La sesión no está asociada a una caja');
    if (!dto.items.length) throw new BadRequestException('La venta no tiene productos');

    const ventaId = await this.prisma.$transaction(
      async (tx) => {
        const turno = await tx.turnoCaja.findUnique({ where: { id: dto.turnoId } });
        if (!turno || turno.estado !== 'ABIERTO') throw new BadRequestException('No hay un turno abierto');
        if (turno.cajaId !== user.cajaId) throw new BadRequestException('El turno no corresponde a esta caja');
        if (turno.usuarioId !== user.sub) throw new ForbiddenException('El turno pertenece a otro cajero');

        const sucursalId = this.sucursalId();
        const caja = await tx.caja.findUniqueOrThrow({ where: { id: user.cajaId! } });

        // Productos y precios vigentes en la sucursal
        const ids = [...new Set(dto.items.map((i) => i.productoId))];
        const productos = await tx.producto.findMany({
          where: { id: { in: ids } },
          include: { precios: { where: { sucursalId } } },
        });
        const porId = new Map(productos.map((p) => [p.id, p]));

        const autorizaciones = dto.autorizacionIds ?? [];
        let supervisorPrecio: string | null = null;
        let supervisorDescuento: string | null = null;
        const cambiosPrecio: unknown[] = [];

        for (const it of dto.items) {
          const p = porId.get(it.productoId);
          if (!p || !p.activo || p.deletedAt) throw new BadRequestException(`Producto no disponible: ${it.productoId}`);
          if (!p.pesable && !new Decimal(it.cantidad).isInteger()) {
            throw new BadRequestException(`"${p.nombre}" se vende por unidad`);
          }
          const lista = CatalogoService.precioEn(p, sucursalId);
          if (!mismoMonto(lista, it.precioUnitario)) {
            supervisorPrecio ??= await this.auth.exigirPermiso(tx, user, PERMISOS.PRECIO_MODIFICAR, autorizaciones);
            cambiosPrecio.push({ productoId: p.id, nombre: p.nombre, precioLista: lista, precioVenta: it.precioUnitario });
          }
          const pct = Number(it.descuentoPorcentaje ?? 0);
          if (pct > 0) {
            const propio = user.permisos.includes(PERMISOS.VENTA_DESCUENTO) && pct <= user.descuentoMaximo;
            if (!propio) {
              supervisorDescuento ??= await this.auth.exigirPermiso(tx, user, PERMISOS.VENTA_DESCUENTO, autorizaciones, true);
              const limite = await this.auth.limiteAutorizado(user, 'descuentoMaximo', supervisorDescuento);
              if (pct > limite) throw new ForbiddenException(`El descuento máximo autorizado es ${limite}%`);
            }
          }
        }

        const params = await this.parametros.obtener();
        const decimales = params.regional.decimales;
        if (!params.caja.formasPago.length || dto.pagos.some((p) => !params.caja.formasPago.includes(p.metodo))) {
          throw new BadRequestException('Forma de pago no habilitada en la configuración');
        }
        if (!params.caja.venderSinStock) await this.verificarStock(tx, sucursalId, dto.items, porId);

        const promociones = await this.catalogo.promocionesVigentes(sucursalId, tx);
        const calc = calcularVenta(
          dto.items.map((i) => ({
            productoId: i.productoId,
            cantidad: i.cantidad,
            precioUnitario: i.precioUnitario,
            tasaImpuesto: porId.get(i.productoId)!.tasaImpuesto.toString(),
            descuentoPorcentaje: i.descuentoPorcentaje,
          })),
          { promociones, decimales },
        );
        if (!mismoMonto(calc.total, dto.totalEsperado, decimales)) {
          throw new ConflictException({
            message: `El total cambió (precios o promociones actualizados). Total correcto: ${calc.total}`,
            totalCorrecto: calc.total,
          });
        }
        const pago = calcularPago(calc.total, dto.pagos, decimales);
        if (!pago.valido) throw new BadRequestException(pago.error ?? 'Pago inválido');

        // Correlativo atómico por caja (solo esta tienda lo incrementa)
        const [{ ultimoNumero }] = await tx.$queryRaw<{ ultimoNumero: number }[]>`
          INSERT INTO "CajaCorrelativo" ("cajaId", "ultimoNumero", "ultimaActividad")
          VALUES (${caja.id}::uuid, 1, now())
          ON CONFLICT ("cajaId") DO UPDATE
            SET "ultimoNumero" = "CajaCorrelativo"."ultimoNumero" + 1, "ultimaActividad" = now()
          RETURNING "ultimoNumero"`;

        const tipoComprobante = dto.tipoComprobante ?? 'TICKET';
        const comp = await this.comprobante.preparar({
          id: dto.id,
          tipoComprobante,
          serie: caja.serie,
          numero: ultimoNumero,
          total: calc.total,
          clienteId: dto.clienteId ?? null,
        });

        await tx.venta.create({
          data: {
            id: dto.id,
            sucursalId,
            cajaId: caja.id,
            turnoId: turno.id,
            usuarioId: user.sub,
            clienteId: dto.clienteId ?? null,
            tipoComprobante,
            serie: caja.serie,
            numero: ultimoNumero,
            numeroCompleto: formatTicketNumber(caja.serie, ultimoNumero),
            subtotal: calc.subtotal,
            impuesto: calc.impuesto,
            descuento: calc.descuento,
            total: calc.total,
            pagado: pago.pagado,
            vuelto: pago.vuelto,
            estadoEnvio: comp.estadoEnvio,
            respuestaEnvio: (comp.respuesta ?? undefined) as any,
            detalles: {
              create: calc.lineas.map((l, idx) => {
                const p = porId.get(l.productoId)!;
                return {
                  id: newId(),
                  productoId: l.productoId,
                  descripcion: p.nombre,
                  unidad: p.unidad,
                  cantidad: l.cantidad,
                  precioUnitario: l.precioUnitario,
                  precioLista: CatalogoService.precioEn(p, sucursalId),
                  costoUnitario: p.costo,
                  descuentoPromocion: l.descuentoPromocion,
                  descuentoManual: l.descuentoManual,
                  baseImponible: l.baseImponible,
                  impuesto: l.impuesto,
                  tasaImpuesto: l.tasaImpuesto,
                  total: l.total,
                  promocionId: l.promocionId,
                };
              }),
            },
            pagos: {
              create: dto.pagos.map((pg) => ({
                id: newId(),
                metodo: pg.metodo,
                monto: new Decimal(pg.monto).toFixed(2),
                referencia: pg.referencia ?? null,
              })),
            },
          },
        });

        // Inventario (ledger): salida por venta
        for (const l of calc.lineas) {
          const mov = await tx.movimientoInventario.create({
            data: {
              id: newId(),
              sucursalId,
              productoId: l.productoId,
              tipo: 'VENTA',
              cantidad: new Decimal(l.cantidad).negated().toFixed(3),
              costoUnitario: porId.get(l.productoId)!.costo,
              referenciaId: dto.id,
              usuarioId: user.sub,
            },
          });
          await this.outbox.encolar(tx, 'movimiento_inventario', mov.id, mov);
        }

        if (cambiosPrecio.length) {
          await this.auditoria.registrar(
            { sucursalId, usuarioId: user.sub, autorizadoPorId: supervisorPrecio, accion: 'venta.cambio_precio', entidad: 'venta', entidadId: dto.id, detalle: cambiosPrecio },
            tx,
          );
        }
        if (calc.lineas.some((l) => Number(l.descuentoManual) > 0)) {
          await this.auditoria.registrar(
            {
              sucursalId,
              usuarioId: user.sub,
              autorizadoPorId: supervisorDescuento,
              accion: 'venta.descuento',
              entidad: 'venta',
              entidadId: dto.id,
              detalle: calc.lineas.filter((l) => Number(l.descuentoManual) > 0),
            },
            tx,
          );
        }

        // La venta en curso ya no se necesita para recuperación
        await tx.ventaBorrador.deleteMany({ where: { cajaId: caja.id } });

        await this.encolarVenta(tx, dto.id);
        return dto.id;
      },
      // Serializable no es necesario: el correlativo se resuelve con UPSERT atómico
      { timeout: 20_000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );

    const v = await this.prisma.venta.findUniqueOrThrow({ where: { id: ventaId } });
    return {
      ventaId,
      numero: v.numeroCompleto,
      total: v.total.toFixed(2),
      vuelto: v.vuelto.toFixed(2),
      ticket: await this.ticket(ventaId),
    };
  }

  private async encolarVenta(tx: Tx, id: string) {
    const completa = await tx.venta.findUniqueOrThrow({ where: { id }, include: { detalles: true, pagos: true } });
    await this.outbox.encolar(tx, 'venta', id, completa);
  }

  async anular(user: JwtUser, id: string, motivo: string, autorizacionIds: string[]) {
    await this.prisma.$transaction(async (tx) => {
      const v = await tx.venta.findUnique({ where: { id }, include: { detalles: true, turno: true } });
      if (!v || v.sucursalId !== this.sucursalId()) throw new NotFoundException('Venta no encontrada');
      if (v.estado === 'ANULADA') throw new BadRequestException('La venta ya está anulada');
      if (v.turno.estado !== 'ABIERTO') {
        throw new BadRequestException('Solo se pueden anular ventas de un turno abierto. Use devolución.');
      }
      const supervisor = await this.auth.exigirPermiso(tx, user, PERMISOS.VENTA_ANULAR, autorizacionIds);
      await tx.venta.update({
        where: { id },
        data: { estado: 'ANULADA', anuladaEn: new Date(), anuladaPorId: supervisor ?? user.sub, motivoAnulacion: motivo },
      });
      for (const d of v.detalles) {
        const mov = await tx.movimientoInventario.create({
          data: {
            id: newId(),
            sucursalId: v.sucursalId,
            productoId: d.productoId,
            tipo: 'ANULACION',
            cantidad: d.cantidad,
            costoUnitario: d.costoUnitario,
            referenciaId: v.id,
            usuarioId: user.sub,
          },
        });
        await this.outbox.encolar(tx, 'movimiento_inventario', mov.id, mov);
      }
      await this.auditoria.registrar(
        { sucursalId: v.sucursalId, usuarioId: user.sub, autorizadoPorId: supervisor, accion: 'venta.anular', entidad: 'venta', entidadId: id, motivo, detalle: { numero: v.numeroCompleto, total: v.total } },
        tx,
      );
      await this.encolarVenta(tx, id);
    });
    return this.ticket(id);
  }

  async ticket(id: string, reimpresion = false): Promise<TicketData> {
    const v = await this.prisma.venta.findUnique({
      where: { id },
      include: { detalles: true, pagos: true },
    });
    if (!v) throw new NotFoundException('Venta no encontrada');
    const [sucursal, caja, cajero] = await Promise.all([
      this.prisma.sucursal.findUnique({ where: { id: v.sucursalId } }),
      this.prisma.caja.findUnique({ where: { id: v.cajaId } }),
      this.prisma.usuario.findUnique({ where: { id: v.usuarioId }, select: { nombre: true } }),
    ]);
    const params = await this.parametros.obtener();
    const r = params.regional;
    const dec = r.decimales;
    const m = (d: Prisma.Decimal) => d.toFixed(dec);

    // Desglose de impuestos por tasa
    const porTasa = new Map<string, { base: Prisma.Decimal; impuesto: Prisma.Decimal }>();
    for (const d of v.detalles) {
      const k = d.tasaImpuesto.toFixed(2);
      const a = porTasa.get(k);
      porTasa.set(k, a ? { base: a.base.plus(d.baseImponible), impuesto: a.impuesto.plus(d.impuesto) } : { base: d.baseImponible, impuesto: d.impuesto });
    }
    const nombreTasa = (tasa: string) =>
      r.impuestos.find((i) => i.tasa === Number(tasa) && i.tasa > 0)?.nombre ?? (Number(tasa) === 0 ? 'Exento' : `${r.nombreImpuesto} ${Number(tasa)}%`);

    let logo = null;
    if (params.ticket.mostrarLogo && params.marca.logoId) {
      logo = await this.media.logoTicket(params.marca.logoId).catch(() => null);
    }

    return {
      empresa: params.marca.nombreComercial || sucursal?.nombre || 'SUPERMERCADO',
      sucursal: sucursal?.nombre ?? '',
      direccion: sucursal?.direccion ?? null,
      ruc: params.ticket.mostrarDatosFiscales ? (sucursal?.ruc ?? null) : null,
      telefono: sucursal?.telefono ?? null,
      etiquetaFiscal: r.etiquetaFiscal,
      nombreImpuesto: r.nombreImpuesto,
      encabezado: params.ticket.encabezado.filter((l) => l.trim()),
      logo,
      qr: params.ticket.qr || null,
      mostrarAhorro: params.ticket.mostrarAhorro,
      copias: params.ticket.copias,
      formato: { monedaSimbolo: r.monedaSimbolo, decimales: dec, separadorMiles: r.separadorMiles, separadorDecimal: r.separadorDecimal },
      impuestos: [...porTasa.entries()].map(([tasa, x]) => ({ nombre: nombreTasa(tasa), base: m(x.base), impuesto: m(x.impuesto) })),
      caja: caja?.nombre ?? '',
      cajero: cajero?.nombre ?? '',
      numero: v.numeroCompleto,
      fecha: v.fecha.toISOString(),
      items: v.detalles.map((d) => ({
        nombre: d.descripcion,
        cantidad: d.unidad === 'UND' ? d.cantidad.toFixed(0) : d.cantidad.toFixed(3),
        unidad: d.unidad,
        precioUnitario: m(d.precioUnitario),
        total: m(d.total),
        descuento: m(d.descuentoPromocion.plus(d.descuentoManual)),
      })),
      subtotal: m(v.subtotal),
      impuesto: m(v.impuesto),
      descuento: m(v.descuento),
      total: m(v.total),
      pagos: v.pagos.map((p) => ({ metodo: METODO_TEXTO[p.metodo] ?? p.metodo, monto: m(p.monto) })),
      vuelto: m(v.vuelto),
      pie: sucursal?.pieTicket || params.ticket.pie || null,
      anulada: v.estado === 'ANULADA',
      reimpresion,
    };
  }

  async reimprimir(user: JwtUser, id: string) {
    await this.auditoria.registrar({
      sucursalId: this.config.sucursalId,
      usuarioId: user.sub,
      accion: 'venta.reimprimir',
      entidad: 'venta',
      entidadId: id,
    });
    return this.ticket(id, true);
  }

  listar(f: { turnoId?: string; desde?: Date; hasta?: Date; numero?: string; sucursalId?: string | null; limite?: number }) {
    return this.prisma.venta.findMany({
      where: {
        sucursalId: f.sucursalId ?? undefined,
        turnoId: f.turnoId,
        fecha: { gte: f.desde, lte: f.hasta },
        ...(f.numero ? { numeroCompleto: { contains: f.numero } } : {}),
      },
      include: { pagos: true },
      orderBy: { fecha: 'desc' },
      take: Math.min(f.limite ?? 100, 1000),
    });
  }

  async ultimaDeCaja(cajaId: string) {
    return this.prisma.venta.findFirst({ where: { cajaId }, orderBy: { fecha: 'desc' } });
  }

  // ───── Recuperación ante cortes de luz: borrador de la venta en curso ─────

  obtenerBorrador(cajaId: string) {
    return this.prisma.ventaBorrador.findUnique({ where: { cajaId } });
  }

  guardarBorrador(user: JwtUser, data: unknown) {
    return this.prisma.ventaBorrador.upsert({
      where: { cajaId: user.cajaId! },
      create: { cajaId: user.cajaId!, usuarioId: user.sub, data: data as any },
      update: { usuarioId: user.sub, data: data as any },
    });
  }

  async borrarBorrador(cajaId: string) {
    await this.prisma.ventaBorrador.deleteMany({ where: { cajaId } });
    return { ok: true };
  }

  // ───── Ventas suspendidas (en espera) ─────

  listarSuspendidas(cajaId: string) {
    return this.prisma.ventaSuspendida.findMany({ where: { cajaId }, orderBy: { creadoEn: 'asc' } });
  }

  suspender(user: JwtUser, etiqueta: string | null, data: unknown) {
    return this.prisma.ventaSuspendida.create({
      data: { id: newId(), cajaId: user.cajaId!, usuarioId: user.sub, etiqueta, data: data as any },
    });
  }

  async recuperarSuspendida(cajaId: string, id: string) {
    const s = await this.prisma.ventaSuspendida.findUnique({ where: { id } });
    if (!s || s.cajaId !== cajaId) throw new NotFoundException('Venta en espera no encontrada');
    await this.prisma.ventaSuspendida.delete({ where: { id } });
    return s;
  }
}
