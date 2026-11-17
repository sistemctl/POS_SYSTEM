import { BadRequestException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CatalogoCaja,
  CONFIG_BALANZA_DEFECTO,
  ConfigEtiquetaBalanza,
  newId,
  parseEtiquetaBalanza,
  ProductoCaja,
  PromocionInput,
} from '@pos/shared';
import { MediaService } from '../media/media.module';
import { ParametrosService } from '../parametros/parametros.module';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { AppConfig } from '../config/app-config';

const productoInclude = {
  categoria: true,
  codigos: { where: { deletedAt: null } },
  precios: { where: { deletedAt: null } },
} satisfies Prisma.ProductoInclude;

type ProductoConRel = Prisma.ProductoGetPayload<{ include: typeof productoInclude }>;

export interface ProductoInput {
  sku: string;
  nombre: string;
  categoriaId?: string | null;
  unidad: string;
  pesable: boolean;
  plu?: string | null;
  precio: string;
  costo?: string;
  tasaImpuesto: string;
  impuestoCodigo?: string | null;
  stockMinimo?: string;
  imagen?: string | null;
  color?: string | null;
  favorito?: boolean;
  activo?: boolean;
  codigos: string[];
  preciosSucursal?: { sucursalId: string; precio: string }[];
}

@Injectable()
export class CatalogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly parametros: ParametrosService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Alta rápida de un producto desde cualquier servidor (p. ej. al recibir mercancía en la tienda).
   * En el central se guarda directo. En la tienda se envía al central (dueño del catálogo) y se guarda
   * una copia local al instante, sin esperar la sincronización; luego el pull la mantiene al día.
   */
  async crearRapido(d: ProductoInput) {
    if (this.config.isCentral) return this.guardarProducto(null, d);
    if (!this.config.centralUrl || !this.config.syncToken || !this.config.sucursalId) {
      throw new BadRequestException('Esta tienda no está conectada al servidor central.');
    }
    let res: Response;
    try {
      res = await fetch(`${this.config.centralUrl}/api/catalogo/productos/desde-tienda`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sucursal-id': this.config.sucursalId, 'x-sync-token': this.config.syncToken },
        body: JSON.stringify(d),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Sin conexión con el servidor central: no se pueden crear productos nuevos ahora. Los productos que ya existen sí se pueden recibir.',
      );
    }
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpException(body?.message ?? `Error del servidor central (${res.status})`, res.status);
    const { producto, codigos } = body as { producto: Prisma.ProductoUncheckedCreateInput; codigos: Prisma.ProductoCodigoUncheckedCreateInput[] };
    await this.prisma.$transaction(async (tx) => {
      await tx.producto.upsert({ where: { id: producto.id }, create: producto, update: producto });
      for (const c of codigos) await tx.productoCodigo.upsert({ where: { id: c.id }, create: c, update: c });
    });
    return this.obtenerProducto(producto.id);
  }

  /** Lado central de crearRapido: crea y devuelve las filas tal cual para que la tienda las copie. */
  async crearParaTienda(d: ProductoInput) {
    const { categoria: _c, precios: _p, codigos, ...producto } = await this.guardarProducto(null, d);
    return { producto, codigos };
  }

  /** Precio efectivo de un producto en una sucursal (precio por sucursal o precio base). */
  static precioEn(p: { precio: Prisma.Decimal; precios: { sucursalId: string; precio: Prisma.Decimal; deletedAt: Date | null }[] }, sucursalId: string | null) {
    const ps = sucursalId ? p.precios.find((x) => x.sucursalId === sucursalId && !x.deletedAt) : undefined;
    return (ps?.precio ?? p.precio).toFixed(2);
  }

  /** Solo los campos que usa la caja (consulta liviana para 10.000+ productos) */
  private static selectCaja(sucursalId: string | null) {
    return {
      id: true,
      sku: true,
      nombre: true,
      categoriaId: true,
      plu: true,
      precio: true,
      tasaImpuesto: true,
      pesable: true,
      unidad: true,
      imagen: true,
      favorito: true,
      color: true,
      activo: true,
      deletedAt: true,
      codigos: { where: { deletedAt: null }, select: { codigo: true } },
      precios: { where: { deletedAt: null, sucursalId: sucursalId ?? '00000000-0000-0000-0000-000000000000' }, select: { sucursalId: true, precio: true, deletedAt: true } },
    } satisfies Prisma.ProductoSelect;
  }

  private aCaja(p: ProductoConRel, sucursalId: string | null): ProductoCaja {
    return {
      id: p.id,
      sku: p.sku,
      nombre: p.nombre,
      categoriaId: p.categoriaId,
      categoriaNombre: p.categoria?.nombre ?? null,
      codigos: p.codigos.map((c) => c.codigo),
      plu: p.plu,
      precio: CatalogoService.precioEn(p, sucursalId),
      tasaImpuesto: p.tasaImpuesto.toFixed(2),
      pesable: p.pesable,
      unidad: p.unidad,
      imagen: p.imagen,
      favorito: p.favorito,
      color: p.color,
    };
  }

  /**
   * Catálogo para la caja (se guarda en memoria para búsqueda instantánea).
   * Con `desde` devuelve solo los productos cuyo producto, códigos o precios cambiaron después de esa fecha,
   * y en `eliminados` los que ya no se pueden vender.
   */
  async catalogoCaja(sucursalId: string | null, desde: Date | null = null): Promise<CatalogoCaja> {
    const cambio = desde ? { gt: desde } : undefined;
    const where: Prisma.ProductoWhereInput = desde
      ? { OR: [{ updatedAt: cambio }, { codigos: { some: { updatedAt: cambio } } }, { precios: { some: { updatedAt: cambio } } }] }
      : { activo: true, deletedAt: null };
    const [productos, categorias, promos, maxProd, maxCod, maxPrecio] = await Promise.all([
      this.prisma.producto.findMany({ where, select: CatalogoService.selectCaja(sucursalId) }),
      this.prisma.categoria.findMany({ where: { deletedAt: null }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] }),
      this.promocionesVigentes(sucursalId),
      this.prisma.producto.aggregate({ _max: { updatedAt: true } }),
      this.prisma.productoCodigo.aggregate({ _max: { updatedAt: true } }),
      this.prisma.precioSucursal.aggregate({ _max: { updatedAt: true } }),
    ]);
    const version = [maxProd._max.updatedAt, maxCod._max.updatedAt, maxPrecio._max.updatedAt, desde]
      .filter((d): d is Date => !!d)
      .reduce((a, b) => (a > b ? a : b), new Date(0));
    const vendibles = productos.filter((p) => p.activo && !p.deletedAt);
    const nombreCat = new Map(categorias.map((c) => [c.id, c.nombre]));
    return {
      productos: vendibles.map((p) => ({
        id: p.id,
        sku: p.sku,
        nombre: p.nombre,
        categoriaId: p.categoriaId,
        categoriaNombre: p.categoriaId ? (nombreCat.get(p.categoriaId) ?? null) : null,
        codigos: p.codigos.map((c) => c.codigo),
        plu: p.plu,
        precio: CatalogoService.precioEn(p, sucursalId),
        tasaImpuesto: p.tasaImpuesto.toFixed(2),
        pesable: p.pesable,
        unidad: p.unidad,
        imagen: p.imagen,
        favorito: p.favorito,
        color: p.color,
      })),
      categorias: categorias.map((c) => ({ id: c.id, nombre: c.nombre, color: c.color, orden: c.orden })),
      promociones: promos,
      version: version.toISOString(),
      incremental: !!desde,
      eliminados: desde ? productos.filter((p) => !p.activo || p.deletedAt).map((p) => p.id) : [],
    };
  }

  async promocionesVigentes(sucursalId: string | null, db: Tx | PrismaService = this.prisma): Promise<PromocionInput[]> {
    const ahora = new Date();
    const promos = await db.promocion.findMany({
      where: {
        activa: true,
        deletedAt: null,
        OR: [{ sucursalId: null }, ...(sucursalId ? [{ sucursalId }] : [])],
        AND: [
          { OR: [{ desde: null }, { desde: { lte: ahora } }] },
          { OR: [{ hasta: null }, { hasta: { gte: ahora } }] },
        ],
      },
    });
    return promos.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      tipo: p.tipo as PromocionInput['tipo'],
      productoIds: p.productoIds,
      porcentaje: p.porcentaje?.toString(),
      llevar: p.llevar ?? undefined,
      pagar: p.pagar ?? undefined,
      cantidadMinima: p.cantidadMinima?.toString(),
      precioPromo: p.precioPromo?.toString(),
      desde: p.desde,
      hasta: p.hasta,
      activa: p.activa,
    }));
  }

  /** Resuelve un código escaneado: código de barras normal, SKU o etiqueta de balanza. */
  async resolverCodigo(codigo: string, sucursalId: string | null) {
    const config = await this.configBalanza(sucursalId);
    const etiqueta = parseEtiquetaBalanza(codigo, config);
    if (etiqueta) {
      const p = await this.prisma.producto.findFirst({
        where: { plu: etiqueta.codigoProducto, deletedAt: null, activo: true },
        include: productoInclude,
      });
      if (p) return { producto: this.aCaja(p, sucursalId), etiqueta };
    }
    const cod = await this.prisma.productoCodigo.findFirst({
      where: { codigo, deletedAt: null, producto: { activo: true, deletedAt: null } },
      include: { producto: { include: productoInclude } },
    });
    const p =
      cod?.producto ??
      (await this.prisma.producto.findFirst({ where: { sku: codigo, deletedAt: null, activo: true }, include: productoInclude }));
    if (!p) throw new NotFoundException(`Producto no encontrado: ${codigo}`);
    return { producto: this.aCaja(p, sucursalId), etiqueta: null };
  }

  async configBalanza(sucursalId: string | null): Promise<ConfigEtiquetaBalanza> {
    if (!sucursalId) return CONFIG_BALANZA_DEFECTO;
    const s = await this.prisma.sucursal.findUnique({ where: { id: sucursalId }, select: { configBalanza: true } });
    return { ...CONFIG_BALANZA_DEFECTO, ...((s?.configBalanza as object | null) ?? {}) };
  }

  // ───────── Administración (solo central) ─────────

  listarProductos(f: { buscar?: string; categoriaId?: string; pagina?: number; porPagina?: number; incluirInactivos?: boolean }) {
    const porPagina = Math.min(f.porPagina ?? 50, 500);
    const where: Prisma.ProductoWhereInput = {
      deletedAt: null,
      ...(f.incluirInactivos ? {} : { activo: true }),
      ...(f.categoriaId ? { categoriaId: f.categoriaId } : {}),
      ...(f.buscar
        ? {
            OR: [
              { nombre: { contains: f.buscar, mode: 'insensitive' } },
              { sku: { contains: f.buscar } },
              { codigos: { some: { codigo: f.buscar, deletedAt: null } } },
            ],
          }
        : {}),
    };
    return this.prisma.$transaction([
      this.prisma.producto.findMany({
        where,
        include: productoInclude,
        orderBy: { nombre: 'asc' },
        skip: ((f.pagina ?? 1) - 1) * porPagina,
        take: porPagina,
      }),
      this.prisma.producto.count({ where }),
    ]).then(([items, total]) => ({ items, total }));
  }

  async obtenerProducto(id: string) {
    const p = await this.prisma.producto.findUnique({ where: { id }, include: productoInclude });
    if (!p || p.deletedAt) throw new NotFoundException('Producto no encontrado');
    return p;
  }

  private async validarCodigos(codigos: string[], productoId: string | null) {
    const dup = await this.prisma.productoCodigo.findFirst({
      where: { codigo: { in: codigos }, deletedAt: null, ...(productoId ? { productoId: { not: productoId } } : {}) },
      include: { producto: true },
    });
    if (dup) throw new BadRequestException(`El código ${dup.codigo} ya está asignado a "${dup.producto.nombre}"`);
  }

  /**
   * Siguiente código interno consecutivo (P00001, P00002…). Incluye productos eliminados porque el SKU
   * es único en toda la tabla. El bloqueo evita que dos altas simultáneas reciban el mismo número.
   */
  private async siguienteSku(tx: Tx): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('producto_sku_auto'))`;
    const [r] = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT MAX(CAST(SUBSTRING(sku FROM 2) AS INTEGER)) AS max
      FROM "Producto" WHERE sku ~ '^P[0-9]{1,9}$'`;
    return `P${String((r?.max ?? 0) + 1).padStart(5, '0')}`;
  }

  async guardarProducto(id: string | null, d: ProductoInput) {
    const codigos = [...new Set(d.codigos.map((c) => c.trim()).filter(Boolean))];
    await this.validarCodigos(codigos, id);
    const productoId = id ?? newId();
    // Imagen: id de /media; las data URL (formato anterior) se convierten a archivo
    let imagen = d.imagen ?? null;
    if (imagen?.startsWith('data:')) imagen = await this.media.guardarDataUrl(imagen, 'producto');
    else if (imagen && !/^[a-f0-9]{64}$/.test(imagen)) throw new BadRequestException('Imagen inválida');
    // Impuesto: si viene el código, la tasa sale de la configuración
    let tasaImpuesto = d.tasaImpuesto;
    if (d.impuestoCodigo) {
      const imp = (await this.parametros.obtener()).regional.impuestos.find((i) => i.codigo === d.impuestoCodigo);
      if (!imp) throw new BadRequestException(`Impuesto ${d.impuestoCodigo} no configurado`);
      tasaImpuesto = imp.tasa.toFixed(2);
    }
    // Código interno (SKU): opcional. Si se deja vacío, el sistema asigna el siguiente P00001, P00002…
    let sku = d.sku?.trim() ?? '';
    if (sku) {
      const otro = await this.prisma.producto.findFirst({ where: { sku: { equals: sku, mode: 'insensitive' }, ...(id ? { id: { not: id } } : {}) } });
      if (otro) throw new BadRequestException(`El código interno ${sku} ya lo usa "${otro.nombre}"${otro.deletedAt ? ' (eliminado)' : ''}`);
    } else if (id) {
      sku = (await this.prisma.producto.findUniqueOrThrow({ where: { id }, select: { sku: true } })).sku;
    }
    const data = {
      sku,
      nombre: d.nombre,
      categoriaId: d.categoriaId ?? null,
      unidad: d.unidad,
      pesable: d.pesable,
      plu: d.plu || null,
      precio: d.precio,
      costo: d.costo ?? '0',
      tasaImpuesto,
      impuestoCodigo: d.impuestoCodigo ?? null,
      stockMinimo: d.stockMinimo ?? '0',
      imagen,
      color: d.color ?? null,
      favorito: d.favorito ?? false,
      activo: d.activo ?? true,
    };
    await this.prisma.$transaction(async (tx) => {
      if (id) {
        await tx.producto.update({ where: { id }, data });
      } else {
        if (!data.sku) data.sku = await this.siguienteSku(tx);
        await tx.producto.create({ data: { id: productoId, ...data } });
      }
      // Códigos: borrado lógico de los que ya no están (para que la baja se replique a las tiendas)
      const actuales = await tx.productoCodigo.findMany({ where: { productoId, deletedAt: null } });
      for (const c of actuales) {
        if (!codigos.includes(c.codigo)) {
          await tx.productoCodigo.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
        }
      }
      for (const codigo of codigos) {
        if (!actuales.some((c) => c.codigo === codigo)) {
          await tx.productoCodigo.create({ data: { id: newId(), productoId, codigo } });
        }
      }
      if (d.preciosSucursal) {
        const existentes = await tx.precioSucursal.findMany({ where: { productoId } });
        for (const ps of d.preciosSucursal) {
          const e = existentes.find((x) => x.sucursalId === ps.sucursalId);
          if (e) {
            await tx.precioSucursal.update({ where: { id: e.id }, data: { precio: ps.precio, deletedAt: null } });
          } else {
            await tx.precioSucursal.create({
              data: { id: newId(), productoId, sucursalId: ps.sucursalId, precio: ps.precio },
            });
          }
        }
        for (const e of existentes) {
          if (!e.deletedAt && !d.preciosSucursal.some((x) => x.sucursalId === e.sucursalId)) {
            await tx.precioSucursal.update({ where: { id: e.id }, data: { deletedAt: new Date() } });
          }
        }
      }
    });
    return this.obtenerProducto(productoId);
  }

  async eliminarProducto(id: string) {
    await this.prisma.producto.update({ where: { id }, data: { deletedAt: new Date(), activo: false } });
    return { ok: true };
  }

  // Categorías
  listarCategorias() {
    return this.prisma.categoria.findMany({ where: { deletedAt: null }, orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] });
  }
  guardarCategoria(id: string | null, d: { nombre: string; color?: string | null; orden?: number }) {
    const data = { nombre: d.nombre, color: d.color ?? null, orden: d.orden ?? 0 };
    return id
      ? this.prisma.categoria.update({ where: { id }, data })
      : this.prisma.categoria.create({ data: { id: newId(), ...data } });
  }
  eliminarCategoria(id: string) {
    return this.prisma.categoria.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // Promociones
  listarPromociones() {
    return this.prisma.promocion.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }
  guardarPromocion(id: string | null, d: Prisma.PromocionUncheckedCreateInput) {
    const { id: _ignore, ...data } = d;
    return id
      ? this.prisma.promocion.update({ where: { id }, data })
      : this.prisma.promocion.create({ data: { ...data, id: newId() } });
  }
  eliminarPromocion(id: string) {
    return this.prisma.promocion.update({ where: { id }, data: { deletedAt: new Date(), activa: false } });
  }
}
