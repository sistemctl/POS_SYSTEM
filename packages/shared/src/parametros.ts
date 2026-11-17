/**
 * Parámetros del sistema editables desde la web (Administración → Configuración del sistema).
 * Se guardan en el central (tabla Parametros) y se replican a las tiendas por sincronización.
 */
import type { MetodoPago } from './pricing';

export interface ImpuestoConfig {
  /** Código corto, ej. IVA19, EXENTO */
  codigo: string;
  /** Texto que se muestra, ej. "IVA 19%" */
  nombre: string;
  /** Tasa en %, ej. 19 */
  tasa: number;
}

export interface ParametrosRegional {
  pais: string;
  monedaSimbolo: string;
  monedaCodigo: string;
  /** Decimales del dinero: 0 (COP, CLP) o 2 */
  decimales: 0 | 2;
  separadorMiles: '.' | ',' | ' ' | '';
  separadorDecimal: ',' | '.';
  /** NIT, RUC, RFC, RUT... */
  etiquetaFiscal: string;
  /** Nombre corto del impuesto en el ticket: IVA, IGV */
  nombreImpuesto: string;
  zonaHoraria: string;
  impuestos: ImpuestoConfig[];
  impuestoPorDefecto: string;
}

export interface ParametrosMarca {
  nombreComercial: string;
  /** id del archivo en /media (null = sin logo) */
  logoId: string | null;
  colorPrimario: string;
  colorAcento: string;
}

export interface ParametrosTicket {
  encabezado: string[];
  mostrarLogo: boolean;
  mostrarDatosFiscales: boolean;
  pie: string;
  ancho: 58 | 80;
  mostrarAhorro: boolean;
  /** Texto o URL a imprimir como QR al final (vacío = sin QR) */
  qr: string;
  copias: number;
}

export interface ParametrosCaja {
  billetesRapidos: number[];
  formasPago: MetodoPago[];
  inactividadMin: number;
  pedirCliente: 'NO' | 'OPCIONAL' | 'OBLIGATORIO';
  venderSinStock: boolean;
  tamanoBotones: 'NORMAL' | 'GRANDE';
  columnasGrilla: number;
  mostrarImagenes: boolean;
}

export interface Parametros {
  regional: ParametrosRegional;
  marca: ParametrosMarca;
  ticket: ParametrosTicket;
  caja: ParametrosCaja;
}

export const PARAMETROS_ID = '01930000-0000-7000-8000-00000000c0f1';

type PresetRegional = Omit<ParametrosRegional, 'zonaHoraria'> & { zonaHoraria: string; billetes: number[] };

export const PRESETS_PAIS: Record<string, PresetRegional> = {
  CO: {
    pais: 'Colombia',
    monedaSimbolo: '$',
    monedaCodigo: 'COP',
    decimales: 0,
    separadorMiles: '.',
    separadorDecimal: ',',
    etiquetaFiscal: 'NIT',
    nombreImpuesto: 'IVA',
    zonaHoraria: 'America/Bogota',
    impuestos: [
      { codigo: 'IVA19', nombre: 'IVA 19%', tasa: 19 },
      { codigo: 'IVA5', nombre: 'IVA 5%', tasa: 5 },
      { codigo: 'EXENTO', nombre: 'Exento', tasa: 0 },
      { codigo: 'EXCLUIDO', nombre: 'Excluido', tasa: 0 },
    ],
    impuestoPorDefecto: 'IVA19',
    billetes: [2000, 5000, 10000, 20000, 50000, 100000],
  },
  PE: {
    pais: 'Perú',
    monedaSimbolo: 'S/',
    monedaCodigo: 'PEN',
    decimales: 2,
    separadorMiles: ',',
    separadorDecimal: '.',
    etiquetaFiscal: 'RUC',
    nombreImpuesto: 'IGV',
    zonaHoraria: 'America/Lima',
    impuestos: [
      { codigo: 'IGV18', nombre: 'IGV 18%', tasa: 18 },
      { codigo: 'EXONERADO', nombre: 'Exonerado', tasa: 0 },
    ],
    impuestoPorDefecto: 'IGV18',
    billetes: [10, 20, 50, 100, 200],
  },
  MX: {
    pais: 'México',
    monedaSimbolo: '$',
    monedaCodigo: 'MXN',
    decimales: 2,
    separadorMiles: ',',
    separadorDecimal: '.',
    etiquetaFiscal: 'RFC',
    nombreImpuesto: 'IVA',
    zonaHoraria: 'America/Mexico_City',
    impuestos: [
      { codigo: 'IVA16', nombre: 'IVA 16%', tasa: 16 },
      { codigo: 'IVA0', nombre: 'Tasa 0%', tasa: 0 },
    ],
    impuestoPorDefecto: 'IVA16',
    billetes: [20, 50, 100, 200, 500],
  },
  EC: {
    pais: 'Ecuador',
    monedaSimbolo: '$',
    monedaCodigo: 'USD',
    decimales: 2,
    separadorMiles: '.',
    separadorDecimal: ',',
    etiquetaFiscal: 'RUC',
    nombreImpuesto: 'IVA',
    zonaHoraria: 'America/Guayaquil',
    impuestos: [
      { codigo: 'IVA15', nombre: 'IVA 15%', tasa: 15 },
      { codigo: 'IVA0', nombre: 'IVA 0%', tasa: 0 },
    ],
    impuestoPorDefecto: 'IVA15',
    billetes: [1, 5, 10, 20, 50],
  },
  CL: {
    pais: 'Chile',
    monedaSimbolo: '$',
    monedaCodigo: 'CLP',
    decimales: 0,
    separadorMiles: '.',
    separadorDecimal: ',',
    etiquetaFiscal: 'RUT',
    nombreImpuesto: 'IVA',
    zonaHoraria: 'America/Santiago',
    impuestos: [
      { codigo: 'IVA19', nombre: 'IVA 19%', tasa: 19 },
      { codigo: 'EXENTO', nombre: 'Exento', tasa: 0 },
    ],
    impuestoPorDefecto: 'IVA19',
    billetes: [1000, 2000, 5000, 10000, 20000],
  },
};

/** Aplica un preset de país sobre unos parámetros (solo cambia la parte regional y los billetes). */
export function aplicarPreset(p: Parametros, codigoPais: string): Parametros {
  const preset = PRESETS_PAIS[codigoPais];
  if (!preset) return p;
  const { billetes, ...regional } = preset;
  return { ...p, regional: { ...regional, impuestos: regional.impuestos.map((i) => ({ ...i })) }, caja: { ...p.caja, billetesRapidos: [...billetes] } };
}

export const PARAMETROS_DEFECTO: Parametros = aplicarPreset(
  {
    regional: null as unknown as ParametrosRegional,
    marca: { nombreComercial: 'Mi Supermercado', logoId: null, colorPrimario: '#059669', colorAcento: '#f59e0b' },
    ticket: {
      encabezado: [],
      mostrarLogo: true,
      mostrarDatosFiscales: true,
      pie: '¡Gracias por su compra!',
      ancho: 80,
      mostrarAhorro: true,
      qr: '',
      copias: 1,
    },
    caja: {
      billetesRapidos: [],
      formasPago: ['EFECTIVO', 'TARJETA', 'BILLETERA', 'TRANSFERENCIA'],
      inactividadMin: 10,
      pedirCliente: 'NO',
      venderSinStock: true,
      tamanoBotones: 'NORMAL',
      columnasGrilla: 4,
      mostrarImagenes: true,
    },
  },
  'CO',
);

/** Completa parámetros guardados (posiblemente de una versión anterior) con los valores por defecto. */
export function normalizarParametros(datos: unknown): Parametros {
  const d = (datos ?? {}) as Partial<Parametros>;
  return {
    regional: { ...PARAMETROS_DEFECTO.regional, ...(d.regional ?? {}) },
    marca: { ...PARAMETROS_DEFECTO.marca, ...(d.marca ?? {}) },
    ticket: { ...PARAMETROS_DEFECTO.ticket, ...(d.ticket ?? {}) },
    caja: { ...PARAMETROS_DEFECTO.caja, ...(d.caja ?? {}) },
  };
}

/** Formatea un monto según los parámetros regionales: 12500 → "$ 12.500" (COP) o "S/ 12.50". */
export function formatearDinero(v: number | string, r: Pick<ParametrosRegional, 'monedaSimbolo' | 'decimales' | 'separadorMiles' | 'separadorDecimal'>, conSimbolo = true): string {
  const n = typeof v === 'string' ? Number(v) : v;
  const negativo = n < 0;
  const fijo = Math.abs(n).toFixed(r.decimales);
  const [entero, dec] = fijo.split('.');
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, r.separadorMiles);
  const texto = (negativo ? '-' : '') + conMiles + (dec ? r.separadorDecimal + dec : '');
  return conSimbolo ? `${r.monedaSimbolo} ${texto}` : texto;
}

/**
 * Interpreta un número escrito con separadores locales ("1.234,56", "1,234.56", "12500").
 * Devuelve null si no es un número válido.
 */
export function parsearNumeroLocal(texto: unknown, separadorDecimal: ',' | '.'): number | null {
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null;
  if (texto === null || texto === undefined) return null;
  let s = String(texto).trim().replace(/\s/g, '').replace(/^[^\d-]+/, '');
  if (!s) return null;
  const tieneComa = s.includes(',');
  const tienePunto = s.includes('.');
  if (tieneComa && tienePunto) {
    // El último separador que aparece es el decimal
    const dec = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    s = s.split(dec === ',' ? '.' : ',').join('').replace(dec, '.');
  } else if (tieneComa || tienePunto) {
    const sep = tieneComa ? ',' : '.';
    const partes = s.split(sep);
    // "12.500" con separador decimal "," → miles; "12.5" con separador "." → decimal
    const esMiles = sep !== separadorDecimal && partes.length >= 2 && partes.slice(1).every((x) => x.length === 3);
    s = esMiles ? partes.join('') : partes.length === 2 ? partes.join('.') : partes.join('');
  }
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
