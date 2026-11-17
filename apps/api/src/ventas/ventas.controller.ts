import { BadRequestException, Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { PERMISOS } from '@pos/shared';
import type { CrearVentaDto } from '@pos/shared';
import { CurrentUser, JwtUser, RequirePermission, StoreOperation } from '../common/decorators';
import { decimalNoNegativo, decimalPositivo } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { VentasService } from './ventas.service';

const ventaSchema = z.object({
  id: z.string().uuid(),
  turnoId: z.string().uuid(),
  items: z
    .array(
      z.object({
        productoId: z.string().uuid(),
        cantidad: decimalPositivo,
        precioUnitario: decimalNoNegativo,
        descuentoPorcentaje: decimalNoNegativo.optional(),
      }),
    )
    .min(1)
    .max(500),
  pagos: z
    .array(
      z.object({
        metodo: z.enum(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'BILLETERA', 'OTRO']),
        monto: decimalPositivo,
        referencia: z.string().max(100).nullable().optional(),
      }),
    )
    .min(1),
  totalEsperado: decimalNoNegativo,
  clienteId: z.string().uuid().nullable().optional(),
  tipoComprobante: z.enum(['TICKET', 'BOLETA', 'FACTURA']).optional(),
  autorizacionIds: z.array(z.string().uuid()).optional(),
});

const anularSchema = z.object({
  motivo: z.string().min(3).max(300),
  autorizacionIds: z.array(z.string().uuid()).default([]),
});

@StoreOperation()
@Controller('ventas')
export class VentasController {
  constructor(private readonly svc: VentasService) {}

  private caja(u: JwtUser) {
    if (!u.cajaId) throw new BadRequestException('La sesión no está asociada a una caja');
    return u.cajaId;
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Post()
  crear(@CurrentUser() u: JwtUser, @Body(new ZodPipe(ventaSchema)) b: CrearVentaDto) {
    return this.svc.crear(u, b);
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Get()
  listar(
    @CurrentUser() u: JwtUser,
    @Query('turnoId') turnoId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('numero') numero?: string,
  ) {
    return this.svc.listar({
      sucursalId: u.sucursalId,
      turnoId: turnoId || undefined,
      desde: desde ? new Date(desde) : undefined,
      hasta: hasta ? new Date(hasta) : undefined,
      numero: numero || undefined,
    });
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Get('borrador')
  borrador(@CurrentUser() u: JwtUser) {
    return this.svc.obtenerBorrador(this.caja(u)).then((b) => b ?? { data: null });
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Put('borrador')
  guardarBorrador(@CurrentUser() u: JwtUser, @Body() body: { data: unknown }) {
    this.caja(u);
    return this.svc.guardarBorrador(u, body.data).then(() => ({ ok: true }));
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Delete('borrador')
  borrarBorrador(@CurrentUser() u: JwtUser) {
    return this.svc.borrarBorrador(this.caja(u));
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Get('suspendidas')
  suspendidas(@CurrentUser() u: JwtUser) {
    return this.svc.listarSuspendidas(this.caja(u));
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Post('suspendidas')
  suspender(@CurrentUser() u: JwtUser, @Body() body: { etiqueta?: string; data: unknown }) {
    this.caja(u);
    return this.svc.suspender(u, body.etiqueta ?? null, body.data);
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Post('suspendidas/:id/recuperar')
  recuperar(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.recuperarSuspendida(this.caja(u), id);
  }

  @RequirePermission(PERMISOS.VENTA_REIMPRIMIR)
  @Get('ultima')
  async ultima(@CurrentUser() u: JwtUser) {
    const v = await this.svc.ultimaDeCaja(this.caja(u));
    if (!v) throw new BadRequestException('No hay ventas en esta caja');
    return this.svc.reimprimir(u, v.id);
  }

  @RequirePermission(PERMISOS.VENTA_REIMPRIMIR)
  @Get(':id/ticket')
  ticket(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.reimprimir(u, id);
  }

  /** El cajero puede llamar con autorizacionIds de un supervisor */
  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Post(':id/anular')
  anular(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(anularSchema)) b: z.infer<typeof anularSchema>) {
    return this.svc.anular(u, id, b.motivo, b.autorizacionIds);
  }
}
