import { create } from 'zustand';
import {
  CONFIG_BALANZA_DEFECTO,
  convertirPeso,
  unidadVentaPeso,
  parseEtiquetaBalanza,
  type CatalogoCaja,
  type CategoriaCaja,
  type ConfigEtiquetaBalanza,
  type ProductoCaja,
  type PromocionInput,
} from '@pos/shared';
import { get } from '../lib/api';
import { leerConfig } from '../lib/config';

export interface ResultadoCodigo {
  producto: ProductoCaja;
  /** Cantidad embebida en etiqueta de balanza (kg) */
  cantidad?: number;
}

interface CatalogoState {
  productos: ProductoCaja[];
  categorias: CategoriaCaja[];
  promociones: PromocionInput[];
  version: string;
  porCodigo: Map<string, ProductoCaja>;
  porPlu: Map<string, ProductoCaja>;
  porId: Map<string, ProductoCaja>;
  /** Texto normalizado (sin acentos, minúsculas) de cada producto, mismo orden que `productos` */
  indice: string[];
  configBalanza: ConfigEtiquetaBalanza;
  cargado: boolean;
  /** Carga el catálogo. Si ya hay uno, pide solo los cambios (salvo `completo`). */
  cargar: (completo?: boolean) => Promise<void>;
  resolver: (codigo: string) => ResultadoCodigo | null;
  buscar: (texto: string, limite?: number) => ProductoCaja[];
}

export const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

// ───────── Copia local en IndexedDB (arranque rápido con 10.000+ productos y sin conexión) ─────────

const DB = 'pos-caja';
const STORE = 'catalogo';

function abrirDb(): Promise<IDBDatabase> {
  return new Promise((ok, err) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => err(r.error);
  });
}

async function idb<T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T | undefined> {
  try {
    const db = await abrirDb();
    return await new Promise<T | undefined>((ok, err) => {
      const req = fn(db.transaction(STORE, modo).objectStore(STORE));
      req.onsuccess = () => ok(req.result as T);
      req.onerror = () => err(req.error);
    });
  } catch {
    return undefined;
  }
}

const claveCache = () => `${leerConfig().servidor}|${leerConfig().sucursalId ?? ''}`;

interface Cache {
  cat: CatalogoCaja;
  configBalanza: ConfigEtiquetaBalanza;
}

// ───────── Store ─────────

function indexar(cat: CatalogoCaja, configBalanza: ConfigEtiquetaBalanza) {
  const productos = [...cat.productos].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const porCodigo = new Map<string, ProductoCaja>();
  const porPlu = new Map<string, ProductoCaja>();
  const porId = new Map<string, ProductoCaja>();
  const indice: string[] = [];
  for (const p of productos) {
    porId.set(p.id, p);
    porCodigo.set(p.sku.toUpperCase(), p);
    for (const c of p.codigos) porCodigo.set(c, p);
    if (p.plu) porPlu.set(p.plu.padStart(configBalanza.longitudCodigo, '0'), p);
    indice.push(`${normalizar(p.nombre)} ${normalizar(p.categoriaNombre ?? '')}`);
  }
  return { ...cat, productos, porCodigo, porPlu, porId, indice, configBalanza };
}

let cargando: Promise<void> | null = null;

/** El catálogo completo vive en memoria de la caja: búsqueda y escaneo instantáneos. */
export const useCatalogo = create<CatalogoState>((set, getState) => ({
  productos: [],
  categorias: [],
  promociones: [],
  version: '',
  porCodigo: new Map(),
  porPlu: new Map(),
  porId: new Map(),
  indice: [],
  configBalanza: CONFIG_BALANZA_DEFECTO,
  cargado: false,

  cargar: (completo = false) => {
    if (cargando) return cargando;
    cargando = (async () => {
      let s = getState();
      // 1. Primera carga: mostrar enseguida la copia local, luego actualizar solo lo cambiado
      if (!s.cargado) {
        const cache = await idb<Cache>('readonly', (st) => st.get(claveCache()));
        if (cache?.cat?.productos?.length) {
          set({ ...indexar(cache.cat, cache.configBalanza), cargado: true });
          s = getState();
        }
      }
      const desde = !completo && s.cargado && s.version ? s.version : null;
      const [cat, configBalanza] = await Promise.all([
        get<CatalogoCaja>(`/catalogo/caja${desde ? `?desde=${encodeURIComponent(desde)}` : ''}`),
        get<ConfigEtiquetaBalanza>('/catalogo/config-balanza').catch(() => s.configBalanza ?? CONFIG_BALANZA_DEFECTO),
      ]);
      let completoCat: CatalogoCaja = cat;
      if (cat.incremental) {
        // Combinar cambios con lo que ya está en memoria
        const mapa = new Map(s.productos.map((p) => [p.id, p]));
        for (const id of cat.eliminados ?? []) mapa.delete(id);
        for (const p of cat.productos) mapa.set(p.id, p);
        completoCat = { ...cat, productos: [...mapa.values()], incremental: false, eliminados: [] };
        if (!cat.productos.length && !cat.eliminados?.length && s.version === cat.version) {
          set({ categorias: cat.categorias, promociones: cat.promociones, configBalanza });
          return;
        }
      }
      set({ ...indexar(completoCat, configBalanza), cargado: true });
      await idb('readwrite', (st) => st.put({ cat: completoCat, configBalanza } satisfies Cache, claveCache()));
    })().finally(() => {
      cargando = null;
    });
    return cargando;
  },

  resolver: (codigo) => {
    const s = getState();
    const etiqueta = parseEtiquetaBalanza(codigo, s.configBalanza);
    if (etiqueta) {
      const p = s.porPlu.get(etiqueta.codigoProducto);
      if (p) {
        const cantidad =
          etiqueta.tipoValor === 'PESO' ? convertirPeso(etiqueta.valor, 'KG', unidadVentaPeso(p.unidad)) : Math.round((etiqueta.valor / Number(p.precio)) * 1000) / 1000;
        return { producto: p, cantidad };
      }
    }
    const p =
      s.porCodigo.get(codigo) ??
      s.porCodigo.get(codigo.toUpperCase()) ??
      // UPC-A (12 dígitos) y EAN-13 son el mismo código con/sin el 0 inicial
      (/^\d{12}$/.test(codigo) ? s.porCodigo.get('0' + codigo) : undefined) ??
      (/^0\d{12}$/.test(codigo) ? s.porCodigo.get(codigo.slice(1)) : undefined);
    return p ? { producto: p } : null;
  },

  /** Busca por palabras (en cualquier orden, sin acentos), SKU o código exacto. */
  buscar: (texto, limite = 50) => {
    const crudo = texto.trim();
    if (!crudo) return [];
    const s = getState();
    const exacto = s.porCodigo.get(crudo) ?? s.porCodigo.get(crudo.toUpperCase());
    const palabras = normalizar(crudo).split(/\s+/).filter(Boolean);
    const res: ProductoCaja[] = exacto ? [exacto] : [];
    for (let i = 0; i < s.productos.length && res.length < limite; i++) {
      const n = s.indice[i];
      if (palabras.every((w) => n.includes(w)) && s.productos[i] !== exacto) res.push(s.productos[i]);
    }
    return res;
  },
}));
