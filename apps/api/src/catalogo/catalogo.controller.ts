import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import { PERMISOS } from '@pos/shared';
import { CentralOnly, CurrentUser, JwtUser, RequirePermission, SyncAuth } from '../common/decorators';
import { decimal, decimalNoNegativo, decimalPositivo } from '../common/schemas';
import { ZodPipe } from '../common/zod.pipe';
import { CatalogoService } from './catalogo.service';
import { ImportacionService, ModoImportacion } from './importacion.service';

const MAX_ARCHIVO = 15 * 1024 * 1024;

const productoSchema = z.object({
  /** Vacío = el sistema asigna un código interno consecutivo (P00001…) */
  sku: z.string().max(50).default(''),
  nombre: z.string().min(1).max(200),
  categoriaId: z.string().uuid().nullable().optional(),
  unidad: z.string().min(1).max(10).default('UND'),
  pesable: z.boolean().default(false),
  plu: z.string().regex(/^\d{1,6}$/, 'PLU numérico').nullable().optional(),
  precio: decimalNoNegativo,
  costo: decimalNoNegativo.optional(),
  tasaImpuesto: decimalNoNegativo,
  impuestoCodigo: z.string().max(20).nullable().optional(),
  stockMinimo: decimalNoNegativo.optional(),
  /** Id de /media (o data URL de versiones anteriores, que se convierte a archivo) */
  imagen: z.string().max(5_000_000).nullable().optional(),
  color: z.string().max(20).nullable().optional(),
  favorito: z.boolean().optional(),
  activo: z.boolean().optional(),
  codigos: z.array(z.string().max(50)).default([]),
  preciosSucursal: z.array(z.object({ sucursalId: z.string().uuid(), precio: decimalNoNegativo })).optional(),
});

const categoriaSchema = z.object({
  nombre: z.string().min(1).max(100),
  color: z.string().max(20).nullable().optional(),
  orden: z.number().int().optional(),
});

const promocionSchema = z
  .object({
    nombre: z.string().min(1).max(150),
    tipo: z.enum(['PORCENTAJE', 'NXM', 'PRECIO_CANTIDAD']),
    productoIds: z.array(z.string().uuid()).min(1),
    porcentaje: decimal.nullable().optional(),
    llevar: z.number().int().positive().nullable().optional(),
    pagar: z.number().int().nonnegative().nullable().optional(),
    cantidadMinima: decimalPositivo.nullable().optional(),
    precioPromo: decimalNoNegativo.nullable().optional(),
    sucursalId: z.string().uuid().nullable().optional(),
    desde: z.coerce.date().nullable().optional(),
    hasta: z.coerce.date().nullable().optional(),
    activa: z.boolean().default(true),
  })
  .refine((p) => p.tipo !== 'PORCENTAJE' || (p.porcentaje && Number(p.porcentaje) > 0 && Number(p.porcentaje) <= 100), {
    message: 'Porcentaje entre 0 y 100',
  })
  .refine((p) => p.tipo !== 'NXM' || (p.llevar && p.pagar !== undefined && p.pagar !== null && p.pagar < p.llevar), {
    message: 'En NxM "pagar" debe ser menor que "llevar"',
  })
  .refine((p) => p.tipo !== 'PRECIO_CANTIDAD' || (p.cantidadMinima && p.precioPromo), {
    message: 'Indique cantidad mínima y precio promocional',
  });

@Controller('catalogo')
export class CatalogoController {
  constructor(
    private readonly svc: CatalogoService,
    private readonly importacion: ImportacionService,
  ) {}

  /** Catálogo de la caja. Con ?desde=<version> devuelve solo lo cambiado desde esa versión. */
  @RequirePermission(PERMISOS.PRODUCTO_VER)
  @Get('caja')
  catalogoCaja(@CurrentUser() u: JwtUser, @Query('desde') desde?: string) {
    const d = desde ? new Date(desde) : null;
    return this.svc.catalogoCaja(u.sucursalId, d && !isNaN(d.getTime()) ? d : null);
  }

  // ───────── Importación / exportación (Excel o CSV) ─────────

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Get('importacion/plantilla')
  async plantilla(@Res() res: any) {
    this.enviarExcel(res, 'plantilla-productos.xlsx', await this.importacion.plantilla());
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_VER)
  @Get('exportar')
  async exportar(@Res() res: any) {
    const fecha = new Date().toISOString().slice(0, 10);
    this.enviarExcel(res, `productos-${fecha}.xlsx`, await this.importacion.exportar());
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Post('importacion/validar')
  @UseInterceptors(FileInterceptor('archivo', { storage: memoryStorage(), limits: { fileSize: MAX_ARCHIVO } }))
  validarImportacion(@CurrentUser() u: JwtUser, @UploadedFile() archivo: any, @Query('modo') modo?: string) {
    if (!archivo?.buffer) throw new BadRequestException('Adjunte un archivo .xlsx o .csv');
    const m = (['TODO', 'CREAR', 'PRECIOS'].includes(modo ?? '') ? modo : 'TODO') as ModoImportacion;
    return this.importacion.validar(u.sub, { originalname: archivo.originalname, buffer: archivo.buffer }, m);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Get('importacion/:loteId')
  estadoImportacion(@Param('loteId', ParseUUIDPipe) loteId: string) {
    return this.importacion.estado(loteId);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Post('importacion/:loteId/aplicar')
  aplicarImportacion(@CurrentUser() u: JwtUser, @Param('loteId', ParseUUIDPipe) loteId: string) {
    return this.importacion.aplicar(loteId, u.sub);
  }

  private enviarExcel(res: any, nombre: string, buf: Buffer) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(buf);
  }

  @RequirePermission(PERMISOS.PRODUCTO_VER)
  @Get('codigo/:codigo')
  resolver(@CurrentUser() u: JwtUser, @Param('codigo') codigo: string) {
    return this.svc.resolverCodigo(codigo, u.sucursalId);
  }

  @RequirePermission(PERMISOS.PRODUCTO_VER)
  @Get('config-balanza')
  configBalanza(@CurrentUser() u: JwtUser) {
    return this.svc.configBalanza(u.sucursalId);
  }

  // Productos
  @RequirePermission(PERMISOS.PRODUCTO_VER)
  @Get('productos')
  listar(
    @Query('buscar') buscar?: string,
    @Query('categoriaId') categoriaId?: string,
    @Query('pagina') pagina?: string,
    @Query('porPagina') porPagina?: string,
    @Query('incluirInactivos') incluirInactivos?: string,
  ) {
    return this.svc.listarProductos({
      buscar: buscar || undefined,
      categoriaId: categoriaId || undefined,
      pagina: pagina ? Number(pagina) : 1,
      porPagina: porPagina ? Number(porPagina) : 50,
      incluirInactivos: incluirInactivos === 'true',
    });
  }

  @RequirePermission(PERMISOS.PRODUCTO_VER)
  @Get('productos/:id')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.obtenerProducto(id);
  }

  /** Producto nuevo desde cualquier servidor (en la tienda se reenvía al central). Debe ir antes de productos/:id. */
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Post('productos/rapido')
  crearRapido(@Body(new ZodPipe(productoSchema)) b: z.infer<typeof productoSchema>) {
    return this.svc.crearRapido(b);
  }

  /** Llamado por el servidor de tienda (token de sincronización) */
  @SyncAuth()
  @Post('productos/desde-tienda')
  desdeTienda(@Body(new ZodPipe(productoSchema)) b: z.infer<typeof productoSchema>) {
    return this.svc.crearParaTienda(b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Post('productos')
  crear(@Body(new ZodPipe(productoSchema)) b: z.infer<typeof productoSchema>) {
    return this.svc.guardarProducto(null, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Put('productos/:id')
  actualizar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(productoSchema)) b: z.infer<typeof productoSchema>) {
    return this.svc.guardarProducto(id, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Delete('productos/:id')
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.eliminarProducto(id);
  }

  // Categorías
  @Get('categorias')
  categorias() {
    return this.svc.listarCategorias();
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Post('categorias')
  crearCategoria(@Body(new ZodPipe(categoriaSchema)) b: z.infer<typeof categoriaSchema>) {
    return this.svc.guardarCategoria(null, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Put('categorias/:id')
  actualizarCategoria(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(categoriaSchema)) b: z.infer<typeof categoriaSchema>) {
    return this.svc.guardarCategoria(id, b);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PRODUCTO_GESTIONAR)
  @Delete('categorias/:id')
  eliminarCategoria(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.eliminarCategoria(id);
  }

  // Promociones
  @RequirePermission(PERMISOS.PRODUCTO_VER)
  @Get('promociones')
  promociones() {
    return this.svc.listarPromociones();
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PROMOCION_GESTIONAR)
  @Post('promociones')
  crearPromocion(@Body(new ZodPipe(promocionSchema)) b: z.infer<typeof promocionSchema>) {
    return this.svc.guardarPromocion(null, b as any);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PROMOCION_GESTIONAR)
  @Put('promociones/:id')
  actualizarPromocion(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(promocionSchema)) b: z.infer<typeof promocionSchema>) {
    return this.svc.guardarPromocion(id, b as any);
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.PROMOCION_GESTIONAR)
  @Delete('promociones/:id')
  eliminarPromocion(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.eliminarPromocion(id);
  }
}
