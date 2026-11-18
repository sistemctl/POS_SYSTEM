/**
 * Lectura y normalización de archivos de productos (Excel .xlsx o .csv).
 * Funciones puras para poder probarlas sin base de datos.
 */
import ExcelJS from 'exceljs';
import { isValidEan13, parsearNumeroLocal, type ImpuestoConfig } from '@pos/shared';

export type Celda = string | number | boolean | null;

export const COLUMNAS = [
  'codigo_barras',
  'sku',
  'nombre',
  'categoria',
  'precio',
  'costo',
  'impuesto',
  'unidad',
  'pesable',
  'plu',
  'stock_minimo',
  'favorito',
  'activo',
] as const;

/** Nombres alternativos que se aceptan en el encabezado */
const SINONIMOS: Record<string, (typeof COLUMNAS)[number]> = {
  codigo: 'codigo_barras',
  codigos: 'codigo_barras',
  codigo_de_barras: 'codigo_barras',
  codigos_de_barras: 'codigo_barras',
  ean: 'codigo_barras',
  barcode: 'codigo_barras',
  referencia: 'sku',
  codigo_interno: 'sku',
  descripcion: 'nombre',
  producto: 'nombre',
  nombre_producto: 'nombre',
  precio_venta: 'precio',
  precio_de_venta: 'precio',
  pvp: 'precio',
  precio_costo: 'costo',
  costo_unitario: 'costo',
  iva: 'impuesto',
  igv: 'impuesto',
  tasa_impuesto: 'impuesto',
  stock_min: 'stock_minimo',
  minimo: 'stock_minimo',
  departamento: 'categoria',
  familia: 'categoria',
  linea: 'categoria',
  se_pesa: 'pesable',
  por_peso: 'pesable',
};

export const UNIDADES = ['UND', 'KG', 'LB', 'LT', 'PAQ', 'CJA'];

export interface FilaProducto {
  fila: number;
  sku: string | null;
  codigos: string[];
  nombre: string | null;
  categoria: string | null;
  precio: string | null;
  costo: string | null;
  impuestoCodigo: string | null;
  tasaImpuesto: string | null;
  unidad: string | null;
  pesable: boolean | null;
  plu: string | null;
  stockMinimo: string | null;
  favorito: boolean | null;
  activo: boolean | null;
  /** codigo de sucursal → precio */
  preciosSucursal: Record<string, string>;
}

export interface Problema {
  fila: number;
  columna?: string;
  tipo: 'error' | 'aviso';
  mensaje: string;
}

export function normalizarEncabezado(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function texto(v: Celda): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isInteger(v) ? v.toFixed(0) : String(v);
  const s = String(v).trim();
  return s === '' ? null : s;
}

function booleano(v: Celda): boolean | null | 'invalido' {
  const s = texto(v);
  if (s === null) return null;
  const t = normalizarEncabezado(s);
  if (['si', 's', 'x', '1', 'true', 'verdadero', 'yes', 'y'].includes(t)) return true;
  if (['no', 'n', '0', 'false', 'falso'].includes(t)) return false;
  return 'invalido';
}

// ───────── Lectura de archivos ─────────

function valorExcel(v: ExcelJS.CellValue): Celda {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return valorExcel((v as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('richText' in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('');
    if ('text' in v) return String((v as ExcelJS.CellHyperlinkValue).text);
    if ('error' in v) return null;
  }
  return String(v);
}

/** Decodifica CSV en UTF-8 o, si no es válido, en Windows-1252 (lo que guarda Excel en español). */
export function decodificarTexto(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

/** Parser CSV (RFC 4180) con detección de separador ; , o tabulador. */
export function parsearCsv(contenido: string): string[][] {
  const primera = contenido.split(/\r?\n/, 1)[0] ?? '';
  const cuenta = (c: string) => primera.split(c).length;
  const sep = [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < contenido.length; i++) {
    const c = contenido[i];
    if (comillas) {
      if (c === '"') {
        if (contenido[i + 1] === '"') {
          campo += '"';
          i++;
        } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && contenido[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

/** Lee la primera hoja (o el CSV) y devuelve encabezados + filas de celdas. */
export async function leerArchivo(nombre: string, buf: Buffer): Promise<{ encabezados: string[]; filas: Celda[][] }> {
  if (/\.(csv|txt)$/i.test(nombre)) {
    const tabla = parsearCsv(decodificarTexto(buf));
    return { encabezados: (tabla[0] ?? []).map(String), filas: tabla.slice(1) };
  }
  if (!/\.xlsx$/i.test(nombre)) throw new Error('Formato no soportado: use Excel (.xlsx) o CSV (.csv). Si tiene .xls, guárdelo como .xlsx');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const hoja = wb.worksheets.find((w) => w.state === 'visible' && w.rowCount > 0) ?? wb.worksheets[0];
  if (!hoja) throw new Error('El archivo no tiene hojas');
  const filas: Celda[][] = [];
  let encabezados: string[] = [];
  hoja.eachRow({ includeEmpty: false }, (row, n) => {
    const valores: Celda[] = [];
    for (let c = 1; c <= row.cellCount; c++) valores.push(valorExcel(row.getCell(c).value));
    if (n === 1 || !encabezados.length) encabezados = valores.map((v) => String(v ?? ''));
    else filas.push(valores);
  });
  return { encabezados, filas };
}

// ───────── Normalización y validación de filas ─────────

export interface ContextoValidacion {
  separadorDecimal: ',' | '.';
  decimales: 0 | 2;
  impuestos: ImpuestoConfig[];
  /** Códigos de sucursal existentes (para columnas precio_<codigo>) */
  sucursales: string[];
}

export function mapearEncabezados(encabezados: string[], sucursales: string[]) {
  const mapa = new Map<number, string>();
  const desconocidas: string[] = [];
  const sucNorm = new Map(sucursales.map((s) => [normalizarEncabezado(s), s]));
  encabezados.forEach((h, i) => {
    const n = normalizarEncabezado(h);
    if (!n) return;
    if ((COLUMNAS as readonly string[]).includes(n)) mapa.set(i, n);
    else if (SINONIMOS[n]) mapa.set(i, SINONIMOS[n]);
    else if (n.startsWith('precio_') && sucNorm.has(n.slice(7))) mapa.set(i, `precio_suc:${sucNorm.get(n.slice(7))}`);
    else desconocidas.push(h);
  });
  return { mapa, desconocidas };
}

export function normalizarFilas(
  encabezados: string[],
  filas: Celda[][],
  ctx: ContextoValidacion,
): { filas: FilaProducto[]; problemas: Problema[]; columnasIgnoradas: string[] } {
  const { mapa, desconocidas } = mapearEncabezados(encabezados, ctx.sucursales);
  const presentes = new Set(mapa.values());
  const problemas: Problema[] = [];
  if (!presentes.has('codigo_barras') && !presentes.has('sku')) {
    problemas.push({ fila: 1, tipo: 'error', mensaje: 'Falta la columna "codigo_barras" o "sku" para identificar los productos' });
    return { filas: [], problemas, columnasIgnoradas: desconocidas };
  }

  const salida: FilaProducto[] = [];
  filas.forEach((celdas, idx) => {
    const numFila = idx + 2; // fila 1 = encabezados
    const get = (col: string): Celda => {
      for (const [i, c] of mapa) if (c === col) return celdas[i] ?? null;
      return null;
    };
    const p = (col: string, tipo: Problema['tipo'], mensaje: string) => problemas.push({ fila: numFila, columna: col, tipo, mensaje });

    const num = (col: string, opciones: { decimales?: number } = {}): string | null => {
      const v = get(col);
      if (texto(v) === null) return null;
      const n = parsearNumeroLocal(typeof v === 'number' ? v : texto(v), ctx.separadorDecimal);
      if (n === null || n < 0) {
        p(col, 'error', `"${texto(v)}" no es un número válido`);
        return null;
      }
      const dec = opciones.decimales ?? 2;
      if (col === 'precio' && ctx.decimales === 0 && !Number.isInteger(n)) p(col, 'aviso', `Precio con decimales (${n}); se redondea a ${Math.round(n)}`);
      return (col === 'precio' && ctx.decimales === 0 ? Math.round(n) : n).toFixed(dec);
    };
    const bool = (col: string) => {
      const b = booleano(get(col));
      if (b === 'invalido') {
        p(col, 'error', `Use SI o NO (valor: "${texto(get(col))}")`);
        return null;
      }
      return b;
    };

    const codigosTxt = texto(get('codigo_barras'));
    const codigos = codigosTxt ? [...new Set(codigosTxt.split(/[|;,\s]+/).map((c) => c.trim()).filter(Boolean))] : [];
    for (const c of codigos) {
      if (c.length > 50) p('codigo_barras', 'error', `Código demasiado largo: ${c}`);
      else if (/[eE]\+/.test(c)) p('codigo_barras', 'error', `Código en notación científica (${c}): formatee la columna como Texto en Excel`);
      else if (/^\d{13}$/.test(c) && !isValidEan13(c)) p('codigo_barras', 'aviso', `El código ${c} no tiene un dígito verificador EAN-13 válido`);
      else if (/^2\d{12}$/.test(c)) p('codigo_barras', 'aviso', `${c} parece una etiqueta de balanza (prefijo 2); para productos pesados use la columna PLU`);
      else if (/^\d{12}$/.test(c)) p('codigo_barras', 'aviso', `${c} tiene 12 dígitos: si perdió un cero a la izquierda, formatee la columna como Texto`);
    }

    let sku = texto(get('sku'));
    if (sku && sku.length > 50) {
      p('sku', 'error', 'SKU demasiado largo (máx. 50)');
      sku = null;
    }

    const nombre = texto(get('nombre'));
    if (nombre && nombre.length > 200) p('nombre', 'error', 'Nombre demasiado largo (máx. 200)');

    // Impuesto: código (IVA19) o tasa (19, 19%, 0.19)
    let impuestoCodigo: string | null = null;
    let tasaImpuesto: string | null = null;
    const impTxt = texto(get('impuesto'));
    if (impTxt) {
      const porCodigo = ctx.impuestos.find((i) => i.codigo.toLowerCase() === impTxt.toLowerCase() || i.nombre.toLowerCase() === impTxt.toLowerCase());
      if (porCodigo) {
        impuestoCodigo = porCodigo.codigo;
        tasaImpuesto = porCodigo.tasa.toFixed(2);
      } else {
        let n = parsearNumeroLocal(impTxt.replace('%', ''), ctx.separadorDecimal);
        if (n !== null && n > 0 && n < 1) n = Math.round(n * 10000) / 100; // 0.19 → 19
        const porTasa = n === null ? undefined : ctx.impuestos.find((i) => i.tasa === n);
        if (porTasa) {
          impuestoCodigo = porTasa.codigo;
          tasaImpuesto = porTasa.tasa.toFixed(2);
        } else p('impuesto', 'error', `Impuesto "${impTxt}" no está configurado (use: ${ctx.impuestos.map((i) => i.codigo).join(', ')})`);
      }
    }

    let unidad = texto(get('unidad'))?.toUpperCase() ?? null;
    if (unidad && ['UN', 'UNIDAD', 'U', 'UND.', 'UNID'].includes(unidad)) unidad = 'UND';
    if (unidad && ['KILO', 'KILOS', 'KILOGRAMO', 'KGS'].includes(unidad)) unidad = 'KG';
    if (unidad && ['LIBRA', 'LIBRAS', 'LBS', 'LB.'].includes(unidad)) unidad = 'LB';
    if (unidad && !UNIDADES.includes(unidad)) {
      p('unidad', 'error', `Unidad "${unidad}" no válida (use ${UNIDADES.join(', ')})`);
      unidad = null;
    }

    const pesable = bool('pesable');
    let plu = texto(get('plu'));
    if (plu && !/^\d{1,6}$/.test(plu)) {
      p('plu', 'error', 'El PLU debe ser numérico de hasta 6 dígitos');
      plu = null;
    }

    const preciosSucursal: Record<string, string> = {};
    for (const [, col] of mapa) {
      if (!col.startsWith('precio_suc:')) continue;
      const v = num(col);
      if (v !== null) preciosSucursal[col.slice('precio_suc:'.length)] = v;
    }

    if (!sku && !codigos.length) {
      p('codigo_barras', 'error', 'Fila sin código de barras ni SKU');
      return;
    }

    salida.push({
      fila: numFila,
      sku,
      codigos,
      nombre,
      categoria: texto(get('categoria')),
      precio: num('precio'),
      costo: num('costo', { decimales: 4 }),
      impuestoCodigo,
      tasaImpuesto,
      // Pesables: KG o LB. Sin columna unidad se deja null para no pisar la unidad existente.
      unidad: pesable ? (unidad === null ? null : unidad === 'LB' ? 'LB' : 'KG') : unidad,
      pesable,
      plu,
      stockMinimo: num('stock_minimo', { decimales: 3 }),
      favorito: bool('favorito'),
      activo: bool('activo'),
      preciosSucursal,
    });
  });

  // Duplicados dentro del mismo archivo
  const vistosSku = new Map<string, number>();
  const vistosCod = new Map<string, number>();
  const vistosPlu = new Map<string, number>();
  for (const f of salida) {
    if (f.sku) {
      const k = f.sku.toLowerCase();
      if (vistosSku.has(k)) problemas.push({ fila: f.fila, columna: 'sku', tipo: 'error', mensaje: `SKU ${f.sku} repetido (también en la fila ${vistosSku.get(k)})` });
      else vistosSku.set(k, f.fila);
    }
    for (const c of f.codigos) {
      if (vistosCod.has(c) && vistosCod.get(c) !== f.fila) problemas.push({ fila: f.fila, columna: 'codigo_barras', tipo: 'error', mensaje: `Código ${c} repetido (también en la fila ${vistosCod.get(c)})` });
      else vistosCod.set(c, f.fila);
    }
    if (f.plu) {
      if (vistosPlu.has(f.plu)) problemas.push({ fila: f.fila, columna: 'plu', tipo: 'error', mensaje: `PLU ${f.plu} repetido (también en la fila ${vistosPlu.get(f.plu)})` });
      else vistosPlu.set(f.plu, f.fila);
    }
  }

  return { filas: salida, problemas, columnasIgnoradas: desconocidas };
}
