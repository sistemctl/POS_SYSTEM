import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { newId } from '@pos/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ParametrosService } from '../parametros/parametros.module';
import { PrismaService } from '../prisma/prisma.service';
import { COLUMNAS, FilaProducto, leerArchivo, normalizarFilas, Problema, UNIDADES } from './importacion.parser';

export type ModoImportacion = 'TODO' | 'CREAR' | 'PRECIOS';

type Accion = 'crear' | 'actualizar' | 'sin_cambios' | 'omitir';

interface FilaPlan {
  f: FilaProducto;
  accion: Accion;
  productoId: string | null;
  motivo?: string;
}

interface Lote {
  id: string;
  usuarioId: string;
  archivo: string;
  modo: ModoImportacion;
  plan: FilaPlan[];
  problemas: Problema[];
  creado: number;
  /** Progreso de la aplicación */
  estado: 'VALIDADO' | 'APLICANDO' | 'TERMINADO' | 'ERROR';
  procesadas: number;
  resultado?: { creados: number; actualizados: number; sinCambios: number; omitidos: number; errores: Problema[] };
  error?: string;
}

/** Estado actual de un producto, para comparar y decidir si hay cambios */
interface Existente {
  id: string;
  sku: string;
  nombre: string;
  categoriaId: string | null;
  precio: string;
  costo: string;
  tasaImpuesto: string;
  impuestoCodigo: string | null;
  unidad: string;
  pesable: boolean;
  plu: string | null;
  stockMinimo: string;
  favorito: boolean;
  activo: boolean;
  codigos: Set<string>;
  precios: Map<string, { id: string; precio: string; deletedAt: Date | null }>;
}

const TAM_BLOQUE = 200;
const TTL_LOTE_MS = 60 * 60_000;

@Injectable()
export class ImportacionService {
  private readonly log = new Logger('Importacion');
  private lotes = new Map<string, Lote>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly parametros: ParametrosService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private limpiarViejos() {
    const limite = Date.now() - TTL_LOTE_MS;
    for (const [id, l] of this.lotes) if (l.creado < limite && l.estado !== 'APLICANDO') this.lotes.delete(id);
  }

  /** Carga en memoria el catálogo actual (índices por SKU, código, PLU y categoría). */
  private async indices() {
    const [productos, categorias, sucursales] = await Promise.all([
      this.prisma.producto.findMany({
        where: { deletedAt: null },
        include: { codigos: { where: { deletedAt: null } }, precios: true },
      }),
      this.prisma.categoria.findMany({ where: { deletedAt: null } }),
      this.prisma.sucursal.findMany({ where: { deletedAt: null }, select: { id: true, codigo: true } }),
    ]);
    const porId = new Map<string, Existente>();
    const porSku = new Map<string, Existente>();
    const porCodigo = new Map<string, Existente>();
    const porPlu = new Map<string, Existente>();
    for (const p of productos) {
      const e: Existente = {
        id: p.id,
        sku: p.sku,
        nombre: p.nombre,
        categoriaId: p.categoriaId,
        precio: p.precio.toFixed(2),
        costo: p.costo.toFixed(4),
        tasaImpuesto: p.tasaImpuesto.toFixed(2),
        impuestoCodigo: p.impuestoCodigo,
        unidad: p.unidad,
        pesable: p.pesable,
        plu: p.plu,
        stockMinimo: p.stockMinimo.toFixed(3),
        favorito: p.favorito,
        activo: p.activo,
        codigos: new Set(p.codigos.map((c) => c.codigo)),
        precios: new Map(p.precios.map((x) => [x.sucursalId, { id: x.id, precio: x.precio.toFixed(2), deletedAt: x.deletedAt }])),
      };
      porId.set(e.id, e);
      porSku.set(e.sku.toLowerCase(), e);
      for (const c of e.codigos) porCodigo.set(c, e);
      if (e.plu) porPlu.set(e.plu, e);
    }
    const categoriasPorNombre = new Map(categorias.map((c) => [c.nombre.trim().toLowerCase(), c.id]));
    const sucursalPorCodigo = new Map(sucursales.map((s) => [s.codigo, s.id]));
    return { porId, porSku, porCodigo, porPlu, categoriasPorNombre, sucursalPorCodigo };
  }

  // ───────── 1. Validar (vista previa, no guarda nada) ─────────

  async validar(usuarioId: string, archivo: { originalname: string; buffer: Buffer }, modo: ModoImportacion) {
    this.limpiarViejos();
    const params = await this.parametros.obtener();
    let leido;
    try {
      leido = await leerArchivo(archivo.originalname, archivo.buffer);
    } catch (e: any) {
      throw new BadRequestException(e.message ?? 'No se pudo leer el archivo');
    }
    if (leido.filas.length > 100_000) throw new BadRequestException('Máximo 100.000 filas por archivo');
    const idx = await this.indices();
    const norm = normalizarFilas(leido.encabezados, leido.filas, {
      separadorDecimal: params.regional.separadorDecimal,
      decimales: params.regional.decimales,
      impuestos: params.regional.impuestos,
      sucursales: [...idx.sucursalPorCodigo.keys()],
    });
    const problemas = [...norm.problemas];
    const filasConError = new Set(problemas.filter((p) => p.tipo === 'error').map((p) => p.fila));
    const plan: FilaPlan[] = [];

    for (const f of norm.filas) {
      const p = (columna: string, mensaje: string, tipo: Problema['tipo'] = 'error') => {
        problemas.push({ fila: f.fila, columna, tipo, mensaje });
        if (tipo === 'error') filasConError.add(f.fila);
      };
      // Identificar el producto: primero por SKU, luego por cualquiera de sus códigos
      let existente = f.sku ? idx.porSku.get(f.sku.toLowerCase()) : undefined;
      if (!existente) for (const c of f.codigos) if ((existente = idx.porCodigo.get(c))) break;

      for (const c of f.codigos) {
        const dueño = idx.porCodigo.get(c);
        if (dueño && existente && dueño.id !== existente.id) p('codigo_barras', `El código ${c} ya pertenece a "${dueño.nombre}" (SKU ${dueño.sku})`);
      }
      if (f.plu) {
        const dueño = idx.porPlu.get(f.plu);
        if (dueño && dueño.id !== existente?.id) p('plu', `El PLU ${f.plu} ya pertenece a "${dueño.nombre}"`);
      }

      let accion: Accion;
      if (existente) {
        if (modo === 'CREAR') {
          plan.push({ f, accion: 'omitir', productoId: existente.id, motivo: 'Ya existe (modo "solo crear")' });
          continue;
        }
        if (f.sku && f.sku.toLowerCase() !== existente.sku.toLowerCase()) {
          // Encontrado por código de barras pero con otro SKU: el SKU del archivo pasa a ser el nuevo
          const otro = idx.porSku.get(f.sku.toLowerCase());
          if (otro && otro.id !== existente.id) p('sku', `El SKU ${f.sku} pertenece a otro producto ("${otro.nombre}")`);
        }
        if (modo === 'PRECIOS' && f.precio === null && f.costo === null && !Object.keys(f.preciosSucursal).length) {
          p('precio', 'Sin precio ni costo para actualizar');
        }
        accion = this.hayCambios(existente, f, modo, idx) ? 'actualizar' : 'sin_cambios';
      } else {
        if (modo === 'PRECIOS') {
          plan.push({ f, accion: 'omitir', productoId: null, motivo: 'No existe (modo "solo precios" no crea productos)' });
          continue;
        }
        if (!f.nombre) p('nombre', 'Falta el nombre (obligatorio para productos nuevos)');
        if (f.precio === null) p('precio', 'Falta el precio (obligatorio para productos nuevos)');
        accion = 'crear';
      }
      plan.push({ f, accion, productoId: existente?.id ?? null });
    }

    // Las filas con error no se aplican
    for (const x of plan) if (filasConError.has(x.f.fila) && x.accion !== 'omitir') {
      x.accion = 'omitir';
      x.motivo = 'Tiene errores';
    }

    const lote: Lote = {
      id: newId(),
      usuarioId,
      archivo: archivo.originalname,
      modo,
      plan,
      problemas: problemas.sort((a, b) => a.fila - b.fila),
      creado: Date.now(),
      estado: 'VALIDADO',
      procesadas: 0,
    };
    this.lotes.set(lote.id, lote);
    return this.resumen(lote);
  }

  private hayCambios(e: Existente, f: FilaProducto, modo: ModoImportacion, idx: Awaited<ReturnType<ImportacionService['indices']>>) {
    if (f.precio !== null && f.precio !== e.precio) return true;
    if (f.costo !== null && f.costo !== e.costo) return true;
    for (const [cod, precio] of Object.entries(f.preciosSucursal)) {
      const sid = idx.sucursalPorCodigo.get(cod);
      const actual = sid ? e.precios.get(sid) : undefined;
      if (!actual || actual.deletedAt || actual.precio !== precio) return true;
    }
    if (modo === 'PRECIOS') return false;
    if (f.nombre !== null && f.nombre !== e.nombre) return true;
    if (f.sku !== null && f.sku !== e.sku) return true;
    if (f.codigos.some((c) => !e.codigos.has(c))) return true;
    if (f.categoria !== null && idx.categoriasPorNombre.get(f.categoria.toLowerCase()) !== e.categoriaId) return true;
    if (f.tasaImpuesto !== null && (f.tasaImpuesto !== e.tasaImpuesto || f.impuestoCodigo !== e.impuestoCodigo)) return true;
    if (f.unidad !== null && f.unidad !== e.unidad) return true;
    if (f.pesable !== null && f.pesable !== e.pesable) return true;
    if (f.plu !== null && f.plu !== e.plu) return true;
    if (f.stockMinimo !== null && f.stockMinimo !== e.stockMinimo) return true;
    if (f.favorito !== null && f.favorito !== e.favorito) return true;
    if (f.activo !== null && f.activo !== e.activo) return true;
    return false;
  }

  resumen(l: Lote) {
    const cuenta = (a: Accion) => l.plan.filter((x) => x.accion === a).length;
    return {
      loteId: l.id,
      archivo: l.archivo,
      modo: l.modo,
      estado: l.estado,
      total: l.plan.length,
      crear: cuenta('crear'),
      actualizar: cuenta('actualizar'),
      sinCambios: cuenta('sin_cambios'),
      omitir: cuenta('omitir'),
      errores: l.problemas.filter((p) => p.tipo === 'error').length,
      avisos: l.problemas.filter((p) => p.tipo === 'aviso').length,
      problemas: l.problemas.slice(0, 2000),
      omitidos: l.plan.filter((x) => x.accion === 'omitir' && x.motivo !== 'Tiene errores').slice(0, 500).map((x) => ({ fila: x.f.fila, motivo: x.motivo })),
      muestra: l.plan
        .filter((x) => x.accion === 'crear' || x.accion === 'actualizar')
        .slice(0, 50)
        .map((x) => ({ fila: x.f.fila, accion: x.accion, sku: x.f.sku, codigos: x.f.codigos, nombre: x.f.nombre, precio: x.f.precio })),
      procesadas: l.procesadas,
      resultado: l.resultado,
      error: l.error,
    };
  }

  estado(loteId: string) {
    const l = this.lotes.get(loteId);
    if (!l) throw new NotFoundException('La importación venció o no existe; vuelva a subir el archivo');
    return this.resumen(l);
  }

  // ───────── 2. Aplicar (en segundo plano, por bloques) ─────────

  aplicar(loteId: string, usuarioId: string) {
    const l = this.lotes.get(loteId);
    if (!l) throw new NotFoundException('La importación venció o no existe; vuelva a subir el archivo');
    if (l.estado !== 'VALIDADO') throw new BadRequestException('Esta importación ya se aplicó');
    if (l.usuarioId !== usuarioId) throw new BadRequestException('La importación pertenece a otro usuario');
    l.estado = 'APLICANDO';
    this.ejecutar(l).catch((e) => {
      l.estado = 'ERROR';
      l.error = e.message;
      this.log.error(`Importación ${l.archivo}: ${e.message}`);
    });
    return this.resumen(l);
  }

  private async ejecutar(l: Lote) {
    const idx = await this.indices();
    const params = await this.parametros.obtener();
    const impDefecto = params.regional.impuestos.find((i) => i.codigo === params.regional.impuestoPorDefecto)!;
    const res = { creados: 0, actualizados: 0, sinCambios: 0, omitidos: 0, errores: [] as Problema[] };
    const aplicables = l.plan.filter((x) => x.accion === 'crear' || x.accion === 'actualizar');
    res.sinCambios = l.plan.filter((x) => x.accion === 'sin_cambios').length;
    res.omitidos = l.plan.filter((x) => x.accion === 'omitir').length;
    l.procesadas = l.plan.length - aplicables.length;

    for (let i = 0; i < aplicables.length; i += TAM_BLOQUE) {
      const bloque = aplicables.slice(i, i + TAM_BLOQUE);
      try {
        await this.prisma.$transaction(
          async (tx) => {
            // Productos nuevos: inserción por lotes (mucho más rápido con miles de filas)
            const nuevos = bloque.filter((x) => x.accion === 'crear');
            const productos: ReturnType<ImportacionService['datosNuevo']>[] = [];
            const codigos: Prisma.ProductoCodigoCreateManyInput[] = [];
            const precios: Prisma.PrecioSucursalCreateManyInput[] = [];
            for (const x of nuevos) {
              const categoriaId = await this.asegurarCategoria(tx, x.f, l.modo, idx);
              const d = this.datosNuevo(x.f, categoriaId ?? null, impDefecto);
              productos.push(d);
              for (const codigo of x.f.codigos) codigos.push({ id: newId(), productoId: d.id, codigo });
              for (const [cod, precio] of Object.entries(x.f.preciosSucursal)) {
                const sucursalId = idx.sucursalPorCodigo.get(cod);
                if (sucursalId) precios.push({ id: newId(), productoId: d.id, sucursalId, precio });
              }
            }
            if (productos.length) await tx.producto.createMany({ data: productos });
            if (codigos.length) await tx.productoCodigo.createMany({ data: codigos });
            if (precios.length) await tx.precioSucursal.createMany({ data: precios });
            for (const d of productos) this.registrarNuevo(idx, d, codigos.filter((c) => c.productoId === d.id).map((c) => c.codigo));
            // Actualizaciones: fila por fila (solo cambia lo que trae el archivo)
            for (const x of bloque) if (x.accion === 'actualizar') await this.aplicarFila(tx, x, l.modo, idx, impDefecto);
          },
          { timeout: 120_000 },
        );
        for (const x of bloque) x.accion === 'crear' ? res.creados++ : res.actualizados++;
      } catch (e) {
        // Si el bloque falla, se reintenta fila por fila para aislar el problema
        for (const x of bloque) {
          try {
            await this.prisma.$transaction((tx) => this.aplicarFila(tx, x, l.modo, idx, impDefecto), { timeout: 30_000 });
            x.accion === 'crear' ? res.creados++ : res.actualizados++;
          } catch (err: any) {
            res.errores.push({ fila: x.f.fila, tipo: 'error', mensaje: this.mensajeError(err) });
          }
        }
      }
      l.procesadas += bloque.length;
    }

    l.resultado = res;
    l.estado = 'TERMINADO';
    await this.auditoria.registrar({
      usuarioId: l.usuarioId,
      accion: 'producto.importar',
      entidad: 'producto',
      detalle: { archivo: l.archivo, modo: l.modo, ...res, errores: res.errores.length },
    });
    this.log.log(`Importación ${l.archivo}: ${res.creados} creados, ${res.actualizados} actualizados, ${res.errores.length} con error`);
  }

  private mensajeError(e: any): string {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return `Valor duplicado en ${(e.meta?.target as string[] | undefined)?.join(', ') ?? 'un campo único'}`;
    }
    return String(e?.message ?? e).slice(0, 300);
  }

  /** Categoría por nombre (se crea si no existe). undefined = la fila no trae categoría */
  private async asegurarCategoria(tx: Prisma.TransactionClient, f: FilaProducto, modo: ModoImportacion, idx: Awaited<ReturnType<ImportacionService['indices']>>) {
    if (!f.categoria || modo === 'PRECIOS') return undefined;
    const k = f.categoria.trim().toLowerCase();
    let categoriaId = idx.categoriasPorNombre.get(k);
    if (!categoriaId) {
      categoriaId = newId();
      await tx.categoria.create({ data: { id: categoriaId, nombre: f.categoria.trim(), orden: idx.categoriasPorNombre.size + 1 } });
      idx.categoriasPorNombre.set(k, categoriaId);
    }
    return categoriaId;
  }

  private datosNuevo(f: FilaProducto, categoriaId: string | null, impDefecto: { codigo: string; tasa: number }) {
    const pesable = f.pesable ?? false;
    return {
      id: newId(),
      sku: f.sku ?? f.codigos[0],
      nombre: f.nombre!,
      categoriaId,
      unidad: pesable ? (f.unidad === 'LB' ? 'LB' : 'KG') : (f.unidad ?? 'UND'),
      pesable,
      plu: f.plu,
      precio: f.precio!,
      costo: f.costo ?? '0',
      tasaImpuesto: f.tasaImpuesto ?? impDefecto.tasa.toFixed(2),
      impuestoCodigo: f.impuestoCodigo ?? impDefecto.codigo,
      stockMinimo: f.stockMinimo ?? '0',
      favorito: f.favorito ?? false,
      activo: f.activo ?? true,
    } satisfies Prisma.ProductoCreateManyInput;
  }

  /** Agrega un producto recién creado a los índices en memoria */
  private registrarNuevo(idx: Awaited<ReturnType<ImportacionService['indices']>>, d: ReturnType<ImportacionService['datosNuevo']>, codigos: string[]) {
    const e: Existente = {
      id: d.id, sku: d.sku, nombre: d.nombre, categoriaId: d.categoriaId, precio: d.precio, costo: Number(d.costo).toFixed(4),
      tasaImpuesto: d.tasaImpuesto, impuestoCodigo: d.impuestoCodigo, unidad: d.unidad, pesable: d.pesable, plu: d.plu,
      stockMinimo: Number(d.stockMinimo).toFixed(3), favorito: d.favorito, activo: d.activo, codigos: new Set(codigos), precios: new Map(),
    };
    idx.porId.set(e.id, e);
    idx.porSku.set(e.sku.toLowerCase(), e);
    for (const c of codigos) idx.porCodigo.set(c, e);
    if (e.plu) idx.porPlu.set(e.plu, e);
  }

  /** Aplica una fila individual (actualizaciones, o creación cuando se reintenta fila por fila tras un error) */
  private async aplicarFila(
    tx: Prisma.TransactionClient,
    x: FilaPlan,
    modo: ModoImportacion,
    idx: Awaited<ReturnType<ImportacionService['indices']>>,
    impDefecto: { codigo: string; tasa: number },
  ) {
    const f = x.f;
    const existente = x.productoId ? idx.porId.get(x.productoId) : undefined;
    const categoriaId = await this.asegurarCategoria(tx, f, modo, idx);

    let productoId: string;
    if (!existente) {
      const d = this.datosNuevo(f, categoriaId ?? null, impDefecto);
      // Si ya se creó en el intento por lotes (y falló otra fila), no duplicar
      if (idx.porSku.has(d.sku.toLowerCase())) return;
      productoId = d.id;
      await tx.producto.create({ data: d });
      this.registrarNuevo(idx, d, []);
    } else {
      productoId = existente.id;
      const data: Prisma.ProductoUpdateInput = {};
      if (f.precio !== null) data.precio = f.precio;
      if (f.costo !== null) data.costo = f.costo;
      if (modo !== 'PRECIOS') {
        if (f.nombre !== null) data.nombre = f.nombre;
        if (f.sku !== null) data.sku = f.sku;
        if (categoriaId !== undefined) data.categoria = categoriaId ? { connect: { id: categoriaId } } : { disconnect: true };
        if (f.tasaImpuesto !== null) {
          data.tasaImpuesto = f.tasaImpuesto;
          data.impuestoCodigo = f.impuestoCodigo;
        }
        if (f.pesable !== null) data.pesable = f.pesable;
        if (f.pesable) data.unidad = f.unidad ?? (existente.unidad === 'LB' ? 'LB' : 'KG');
        else if (f.unidad !== null) data.unidad = f.unidad;
        if (f.plu !== null) data.plu = f.plu;
        if (f.stockMinimo !== null) data.stockMinimo = f.stockMinimo;
        if (f.favorito !== null) data.favorito = f.favorito;
        if (f.activo !== null) data.activo = f.activo;
      }
      if (Object.keys(data).length) await tx.producto.update({ where: { id: productoId }, data });
    }

    // Códigos de barras: se agregan los nuevos (la importación no borra códigos existentes)
    if (modo !== 'PRECIOS') {
      const actuales = idx.porId.get(productoId)!.codigos;
      const nuevos = f.codigos.filter((c) => !actuales.has(c));
      if (nuevos.length) {
        await tx.productoCodigo.createMany({ data: nuevos.map((codigo) => ({ id: newId(), productoId, codigo })) });
        for (const c of nuevos) {
          actuales.add(c);
          idx.porCodigo.set(c, idx.porId.get(productoId)!);
        }
      }
    }

    // Precios por sucursal
    for (const [cod, precio] of Object.entries(f.preciosSucursal)) {
      const sucursalId = idx.sucursalPorCodigo.get(cod);
      if (!sucursalId) continue;
      const actual = idx.porId.get(productoId)!.precios.get(sucursalId);
      if (actual) {
        if (actual.precio !== precio || actual.deletedAt) await tx.precioSucursal.update({ where: { id: actual.id }, data: { precio, deletedAt: null } });
      } else {
        await tx.precioSucursal.create({ data: { id: newId(), productoId, sucursalId, precio } });
      }
    }
  }

  // ───────── Plantilla y exportación ─────────

  private async libro(conDatos: boolean): Promise<Buffer> {
    const params = await this.parametros.obtener();
    const sucursales = await this.prisma.sucursal.findMany({ where: { deletedAt: null }, orderBy: { codigo: 'asc' } });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'POS Supermercado';
    const hoja = wb.addWorksheet('Productos', { views: [{ state: 'frozen', ySplit: 1 }] });
    const columnas = [...COLUMNAS, ...sucursales.map((s) => `precio_${s.codigo}`)];
    hoja.columns = columnas.map((c) => ({
      header: c,
      key: c,
      width: c === 'nombre' ? 40 : c === 'codigo_barras' ? 22 : c === 'categoria' ? 18 : 12,
      // Código de barras y SKU como texto para no perder ceros a la izquierda
      style: c === 'codigo_barras' || c === 'sku' || c === 'plu' ? { numFmt: '@' } : {},
    }));
    hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };

    const impDef = params.regional.impuestoPorDefecto;
    if (conDatos) {
      const productos = await this.prisma.producto.findMany({
        where: { deletedAt: null },
        include: { categoria: true, codigos: { where: { deletedAt: null } }, precios: { where: { deletedAt: null } } },
        orderBy: { nombre: 'asc' },
      });
      const sucPorId = new Map(sucursales.map((s) => [s.id, s.codigo]));
      for (const p of productos) {
        const fila: Record<string, unknown> = {
          codigo_barras: p.codigos.map((c) => c.codigo).join('|'),
          sku: p.sku,
          nombre: p.nombre,
          categoria: p.categoria?.nombre ?? '',
          precio: Number(p.precio),
          costo: Number(p.costo),
          impuesto: p.impuestoCodigo ?? params.regional.impuestos.find((i) => i.tasa === Number(p.tasaImpuesto))?.codigo ?? Number(p.tasaImpuesto),
          unidad: p.unidad,
          pesable: p.pesable ? 'SI' : 'NO',
          plu: p.plu ?? '',
          stock_minimo: Number(p.stockMinimo),
          favorito: p.favorito ? 'SI' : 'NO',
          activo: p.activo ? 'SI' : 'NO',
        };
        for (const ps of p.precios) fila[`precio_${sucPorId.get(ps.sucursalId)}`] = Number(ps.precio);
        hoja.addRow(fila);
      }
    } else {
      const ej = params.regional.decimales === 0 ? [3500, 2400, 12900] : [3.5, 2.4, 12.9];
      hoja.addRow({ codigo_barras: '7702001000017', sku: '', nombre: 'Gaseosa cola 1.5 L', categoria: 'Bebidas', precio: ej[0], costo: ej[1], impuesto: impDef, unidad: 'UND', pesable: 'NO', favorito: 'NO', activo: 'SI' });
      hoja.addRow({ codigo_barras: '7702001000024|7702001000031', sku: 'ARR-500', nombre: 'Arroz 500 g', categoria: 'Abarrotes', precio: ej[1], costo: ej[1] * 0.8, impuesto: impDef, unidad: 'UND', pesable: 'NO', favorito: 'SI', activo: 'SI' });
      hoja.addRow({ codigo_barras: '', sku: 'TOMATE', nombre: 'Tomate', categoria: 'Frutas y verduras', precio: ej[2], costo: ej[2] * 0.6, impuesto: params.regional.impuestos.find((i) => i.tasa === 0)?.codigo ?? impDef, unidad: 'KG', pesable: 'SI', plu: '1001', favorito: 'SI', activo: 'SI' });
    }

    const ayuda = wb.addWorksheet('Instrucciones');
    ayuda.columns = [{ width: 18 }, { width: 100 }];
    const filas: [string, string][] = [
      ['Columna', 'Descripción'],
      ['codigo_barras', 'Uno o varios códigos separados por | (barra vertical). Formatee la columna como TEXTO para no perder ceros.'],
      ['sku', 'Código interno. Si se deja vacío se usa el primer código de barras.'],
      ['nombre', 'Obligatorio para productos nuevos.'],
      ['categoria', 'Nombre de la categoría. Si no existe, se crea.'],
      ['precio', `Precio de venta CON impuesto incluido. ${params.regional.decimales === 0 ? 'Sin decimales.' : 'Con 2 decimales.'} Obligatorio para productos nuevos.`],
      ['costo', 'Costo unitario (opcional).'],
      ['impuesto', `Código o tasa del impuesto: ${params.regional.impuestos.map((i) => `${i.codigo} (${i.tasa}%)`).join(', ')}. Vacío = ${impDef}.`],
      ['unidad', `${UNIDADES.join(', ')}. Los productos pesables usan KG (precio por kilo) o LB (precio por libra).`],
      ['pesable', 'SI si se vende por peso en la balanza.'],
      ['plu', 'Código PLU de la balanza etiquetadora (solo números, hasta 6 dígitos).'],
      ['stock_minimo', 'Cantidad mínima para alertas de reposición.'],
      ['favorito', 'SI para mostrarlo en la pantalla de Favoritos de la caja.'],
      ['activo', 'NO para que no se pueda vender.'],
      ['precio_<sucursal>', 'Opcional: precio distinto para una sucursal (use el código de la sucursal, ej. precio_S01).'],
      ['', ''],
      ['Cómo se identifica', 'Un producto existente se busca por SKU y, si no, por cualquiera de sus códigos de barras. Las celdas vacías no cambian el valor actual.'],
      ['Códigos', 'La importación agrega códigos nuevos pero no borra los existentes.'],
      ['CSV', 'También se acepta .csv separado por ; o , con las mismas columnas.'],
    ];
    filas.forEach((f, i) => {
      const r = ayuda.addRow(f);
      if (i === 0) r.font = { bold: true };
    });

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  plantilla() {
    return this.libro(false);
  }

  exportar() {
    return this.libro(true);
  }
}
