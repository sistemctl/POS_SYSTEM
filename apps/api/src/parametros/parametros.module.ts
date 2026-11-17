import { Body, Controller, Get, Global, Injectable, Module, Put } from '@nestjs/common';
import { z } from 'zod';
import { normalizarParametros, PARAMETROS_ID, PERMISOS, type Decimales, type Parametros } from '@pos/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CentralOnly, CurrentUser, JwtUser, Public, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { PrismaService } from '../prisma/prisma.service';

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido (#RRGGBB)');

export const parametrosSchema = z.object({
  regional: z.object({
    pais: z.string().min(1).max(60),
    monedaSimbolo: z.string().min(1).max(5),
    monedaCodigo: z.string().min(3).max(3),
    decimales: z.union([z.literal(0), z.literal(2)]),
    separadorMiles: z.enum(['.', ',', ' ', '']),
    separadorDecimal: z.enum([',', '.']),
    etiquetaFiscal: z.string().min(1).max(10),
    nombreImpuesto: z.string().min(1).max(10),
    zonaHoraria: z.string().min(1).max(60),
    impuestos: z
      .array(z.object({ codigo: z.string().min(1).max(20).regex(/^[A-Z0-9_]+$/, 'Código en mayúsculas sin espacios'), nombre: z.string().min(1).max(40), tasa: z.number().min(0).max(100) }))
      .min(1, 'Debe haber al menos un impuesto'),
    impuestoPorDefecto: z.string(),
  }),
  marca: z.object({
    nombreComercial: z.string().min(1).max(80),
    logoId: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    colorPrimario: color,
    colorAcento: color,
  }),
  ticket: z.object({
    encabezado: z.array(z.string().max(60)).max(6),
    mostrarLogo: z.boolean(),
    mostrarDatosFiscales: z.boolean(),
    pie: z.string().max(500),
    ancho: z.union([z.literal(58), z.literal(80)]),
    mostrarAhorro: z.boolean(),
    qr: z.string().max(300),
    copias: z.number().int().min(1).max(3),
  }),
  caja: z.object({
    billetesRapidos: z.array(z.number().positive()).max(8),
    formasPago: z.array(z.enum(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'BILLETERA', 'OTRO'])).min(1),
    inactividadMin: z.number().int().min(1).max(240),
    pedirCliente: z.enum(['NO', 'OPCIONAL', 'OBLIGATORIO']),
    venderSinStock: z.boolean(),
    tamanoBotones: z.enum(['NORMAL', 'GRANDE']),
    columnasGrilla: z.number().int().min(2).max(8),
    mostrarImagenes: z.boolean(),
  }),
}).refine((p) => p.regional.impuestos.some((i) => i.codigo === p.regional.impuestoPorDefecto), {
  message: 'El impuesto por defecto debe estar en la lista',
}).refine((p) => new Set(p.regional.impuestos.map((i) => i.codigo)).size === p.regional.impuestos.length, {
  message: 'Hay códigos de impuesto repetidos',
}).refine((p) => p.regional.separadorMiles !== p.regional.separadorDecimal, {
  message: 'El separador de miles y el decimal deben ser distintos',
});

@Injectable()
export class ParametrosService {
  private cache: { valor: Parametros; configurado: boolean; hasta: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Parámetros vigentes (con caché de 15 s; en la tienda cambian por sincronización). */
  async obtener(): Promise<Parametros> {
    return (await this.estado()).valor;
  }

  async estado(): Promise<{ valor: Parametros; configurado: boolean }> {
    if (this.cache && this.cache.hasta > Date.now()) return this.cache;
    const fila = await this.prisma.parametros.findUnique({ where: { id: PARAMETROS_ID } });
    this.cache = { valor: normalizarParametros(fila?.datos), configurado: !!fila, hasta: Date.now() + 15_000 };
    return this.cache;
  }

  async decimales(): Promise<Decimales> {
    return (await this.obtener()).regional.decimales;
  }

  invalidar() {
    this.cache = null;
  }

  /**
   * Guarda los parámetros y alinea los productos con la tabla de impuestos:
   * - producto con un impuesto que sigue existiendo → toma su tasa actual
   * - producto con un impuesto eliminado (o sin código) → pasa al impuesto por defecto
   * Los productos modificados se sincronizan a las tiendas por su updatedAt.
   */
  async guardar(datos: Parametros): Promise<{ parametros: Parametros; productosAjustados: number }> {
    const { impuestos, impuestoPorDefecto } = datos.regional;
    const defecto = impuestos.find((i) => i.codigo === impuestoPorDefecto)!;
    const productosAjustados = await this.prisma.$transaction(async (tx) => {
      await tx.parametros.upsert({
        where: { id: PARAMETROS_ID },
        create: { id: PARAMETROS_ID, datos: datos as any },
        update: { datos: datos as any },
      });
      let n = 0;
      for (const imp of impuestos) {
        const r = await tx.producto.updateMany({
          where: { impuestoCodigo: imp.codigo, NOT: { tasaImpuesto: imp.tasa } },
          data: { tasaImpuesto: imp.tasa },
        });
        n += r.count;
      }
      const huerfanos = await tx.producto.updateMany({
        where: { OR: [{ impuestoCodigo: null }, { impuestoCodigo: { notIn: impuestos.map((i) => i.codigo) } }] },
        data: { impuestoCodigo: defecto.codigo, tasaImpuesto: defecto.tasa },
      });
      return n + huerfanos.count;
    });
    this.invalidar();
    return { parametros: await this.obtener(), productosAjustados };
  }
}

@Controller('parametros')
class ParametrosController {
  constructor(
    private readonly svc: ParametrosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Público: la caja los necesita antes del login (moneda, colores, logo). No contiene datos sensibles. */
  @Public()
  @Get()
  async obtener() {
    const e = await this.svc.estado();
    return { ...e.valor, configurado: e.configurado };
  }

  @CentralOnly()
  @RequirePermission(PERMISOS.CONFIG_GESTIONAR)
  @Put()
  async guardar(@CurrentUser() u: JwtUser, @Body(new ZodPipe(parametrosSchema)) body: Parametros) {
    const antes = await this.svc.obtener();
    const { parametros: nuevo, productosAjustados } = await this.svc.guardar(body);
    await this.auditoria.registrar({
      usuarioId: u.sub,
      accion: 'config.modificar',
      entidad: 'parametros',
      entidadId: PARAMETROS_ID,
      detalle: { antes, despues: nuevo, productosAjustados },
    });
    return { ...nuevo, configurado: true, productosAjustados };
  }
}

@Global()
@Module({
  controllers: [ParametrosController],
  providers: [ParametrosService],
  exports: [ParametrosService],
})
export class ParametrosModule {}
