import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { PERMISOS } from '@pos/shared';
import { CurrentUser, JwtUser, RequirePermission, StoreOperation } from '../common/decorators';
import { decimalNoNegativo, decimalPositivo } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { TurnosService } from './turnos.service';

const abrirSchema = z.object({ montoInicial: decimalNoNegativo });
const cerrarSchema = z.object({
  conteo: z.record(z.string(), z.number().int().nonnegative()).default({}),
  montoDeclarado: decimalNoNegativo,
  observacion: z.string().max(500).optional(),
});
const movimientoSchema = z.object({
  tipo: z.enum(['RETIRO', 'INGRESO']),
  monto: decimalPositivo,
  motivo: z.string().min(3).max(300),
  autorizacionIds: z.array(z.string().uuid()).default([]),
});

@StoreOperation()
@Controller('turnos')
export class TurnosController {
  constructor(private readonly svc: TurnosService) {}

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Get('actual')
  async actual(@CurrentUser() u: JwtUser) {
    if (!u.cajaId) throw new BadRequestException('La sesión no está asociada a una caja');
    return { turno: await this.svc.actual(u.cajaId) };
  }

  @RequirePermission(PERMISOS.TURNO_ABRIR)
  @Post('abrir')
  abrir(@CurrentUser() u: JwtUser, @Body(new ZodPipe(abrirSchema)) b: z.infer<typeof abrirSchema>) {
    return this.svc.abrir(u, b.montoInicial);
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Get(':id/resumen')
  async resumen(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.svc.resumen(id);
    if (r.turno.usuarioId !== u.sub && !u.permisos.includes(PERMISOS.TURNO_VER_TODOS)) {
      throw new ForbiddenException('No puede ver turnos de otros cajeros');
    }
    return r;
  }

  @RequirePermission(PERMISOS.TURNO_CERRAR)
  @Post(':id/cerrar')
  cerrar(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cerrarSchema)) b: z.infer<typeof cerrarSchema>) {
    return this.svc.cerrar(u, id, b.conteo, b.montoDeclarado, b.observacion);
  }

  /** Retiros / ingresos de efectivo. El cajero puede enviar autorización de supervisor. */
  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Post(':id/movimientos')
  movimiento(@CurrentUser() u: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(movimientoSchema)) b: z.infer<typeof movimientoSchema>) {
    return this.svc.movimiento(u, id, b);
  }

  @RequirePermission(PERMISOS.TURNO_VER_TODOS)
  @Get()
  listar(@CurrentUser() u: JwtUser, @Query('usuarioId') usuarioId?: string, @Query('cajaId') cajaId?: string, @Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.svc.listar({
      sucursalId: u.sucursalId,
      usuarioId: usuarioId || undefined,
      cajaId: cajaId || undefined,
      desde: desde ? new Date(desde) : undefined,
      hasta: hasta ? new Date(hasta) : undefined,
    });
  }
}
