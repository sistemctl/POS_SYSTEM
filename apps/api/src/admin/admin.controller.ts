import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { PERMISOS, TODOS_LOS_PERMISOS } from '@pos/shared';
import type { Permiso } from '@pos/shared';
import { CentralOnly, CurrentUser, JwtUser, Public, RequirePermission } from '../common/decorators';
import { decimalNoNegativo } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { AdminService } from './admin.service';

const sucursalSchema = z.object({
  codigo: z.string().min(1).max(10),
  nombre: z.string().min(1).max(150),
  direccion: z.string().max(300).nullable().optional(),
  ruc: z.string().max(20).nullable().optional(),
  telefono: z.string().max(30).nullable().optional(),
  pieTicket: z.string().max(500).nullable().optional(),
  configBalanza: z
    .object({
      prefijos: z.array(z.string().regex(/^\d{2}$/)),
      longitudCodigo: z.number().int().min(4).max(6),
      tipoValor: z.enum(['PESO', 'PRECIO']),
      decimales: z.number().int().min(0).max(3),
      validarDigito: z.boolean(),
    })
    .nullable()
    .optional(),
  activa: z.boolean().optional(),
});

const puertoSerie = z.string().regex(/^(|auto|COM\d{1,3})$/i, 'Puerto: COM1…COM255 o auto').optional();
const baudios = z.number().int().refine((v) => [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].includes(v), 'Baudios inválidos').optional();

/** Periféricos de una caja, editables desde la web (Sucursales y cajas). Debe coincidir con ConfigHardware de la caja. */
const hardwareCajaSchema = z.object({
  impresora: z.object({
    tipo: z.enum(['windows', 'red', 'serie', 'ninguna']),
    nombre: z.string().max(200).optional(),
    host: z.string().max(100).optional(),
    puerto: z.number().int().min(1).max(65535).optional(),
    com: puertoSerie,
    baudios,
    ancho: z.union([z.literal(58), z.literal(80)]),
    abrirCajon: z.boolean(),
  }),
  balanza: z.object({
    driver: z.enum(['ninguna', 'generico', 'toledo', 'cas', 'datalogic', 'simulada']),
    puerto: puertoSerie,
    baudios,
  }),
  escaner: z.object({
    driver: z.enum(['ninguno', 'datalogic', 'serie']),
    puerto: puertoSerie,
    baudios,
  }),
  visorCliente: z.boolean(),
});

const cajaSchema = z.object({
  sucursalId: z.string().uuid(),
  codigo: z.string().min(1).max(10),
  nombre: z.string().min(1).max(100),
  serie: z.string().regex(/^[A-Z0-9]{2,10}$/, 'Serie en mayúsculas/números (2-10)'),
  activa: z.boolean().optional(),
  /** null = la caja se configura localmente */
  hardware: hardwareCajaSchema.nullable().optional(),
});

const rolSchema = z.object({
  codigo: z.string().regex(/^[A-Z_]{2,30}$/),
  nombre: z.string().min(1).max(100),
  permisos: z.array(z.enum(TODOS_LOS_PERMISOS as [Permiso, ...Permiso[]])),
  descuentoMaximo: decimalNoNegativo,
  retiroMaximo: decimalNoNegativo,
});

const usuarioSchema = z.object({
  usuario: z.string().regex(/^[a-zA-Z0-9._-]{3,30}$/),
  nombre: z.string().min(1).max(150),
  password: z.string().min(6).optional(),
  pin: z.string().regex(/^\d{4,6}$/, 'PIN de 4 a 6 dígitos').optional(),
  codigoTarjeta: z.string().max(50).nullable().optional(),
  foto: z.string().max(500_000).nullable().optional(),
  activo: z.boolean().optional(),
  roles: z.array(z.object({ rolId: z.string().uuid(), sucursalId: z.string().uuid().nullable() })).min(1, 'Asigne al menos un rol'),
});

@Controller()
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  // Sucursales y cajas (lectura pública: la caja la necesita en su configuración inicial)
  @Public()
  @Get('sucursales')
  sucursales() {
    return this.svc.listarSucursales();
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.SUCURSAL_GESTIONAR)
  @Post('sucursales')
  crearSucursal(@Body(new ZodPipe(sucursalSchema)) b: z.infer<typeof sucursalSchema>) {
    return this.svc.guardarSucursal(null, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.SUCURSAL_GESTIONAR)
  @Put('sucursales/:id')
  actualizarSucursal(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(sucursalSchema)) b: z.infer<typeof sucursalSchema>) {
    return this.svc.guardarSucursal(id, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.SUCURSAL_GESTIONAR)
  @Post('sucursales/:id/token-sync')
  tokenSync(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.generarTokenSync(id);
  }

  @Public()
  @Get('cajas')
  cajas() {
    return this.svc.listarCajas();
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.CAJA_GESTIONAR)
  @Post('cajas')
  crearCaja(@Body(new ZodPipe(cajaSchema)) b: z.infer<typeof cajaSchema>) {
    return this.svc.guardarCaja(null, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.CAJA_GESTIONAR)
  @Put('cajas/:id')
  actualizarCaja(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(cajaSchema)) b: z.infer<typeof cajaSchema>) {
    return this.svc.guardarCaja(id, b);
  }

  // Roles
  @RequirePermission(PERMISOS.USUARIO_GESTIONAR)
  @Get('roles')
  roles() {
    return this.svc.listarRoles();
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.ROL_GESTIONAR)
  @Post('roles')
  crearRol(@Body(new ZodPipe(rolSchema)) b: z.infer<typeof rolSchema>) {
    return this.svc.guardarRol(null, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.ROL_GESTIONAR)
  @Put('roles/:id')
  actualizarRol(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(rolSchema)) b: z.infer<typeof rolSchema>) {
    return this.svc.guardarRol(id, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.ROL_GESTIONAR)
  @Delete('roles/:id')
  eliminarRol(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.eliminarRol(id);
  }

  // Usuarios
  @RequirePermission(PERMISOS.USUARIO_GESTIONAR)
  @Get('usuarios')
  usuarios(@CurrentUser() u: JwtUser) {
    return this.svc.listarUsuarios(u.sucursalId);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.USUARIO_GESTIONAR)
  @Post('usuarios')
  crearUsuario(@Body(new ZodPipe(usuarioSchema)) b: z.infer<typeof usuarioSchema>) {
    return this.svc.guardarUsuario(null, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.USUARIO_GESTIONAR)
  @Put('usuarios/:id')
  actualizarUsuario(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(usuarioSchema)) b: z.infer<typeof usuarioSchema>) {
    return this.svc.guardarUsuario(id, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.USUARIO_GESTIONAR)
  @Delete('usuarios/:id')
  eliminarUsuario(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.eliminarUsuario(id);
  }

  // Monitoreo
  @CentralOnly()
  @RequirePermission(PERMISOS.MONITOREO_VER)
  @Get('monitoreo/sucursales')
  monitoreo() {
    return this.svc.estadoSucursales();
  }
}
