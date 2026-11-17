import { formatearDinero } from '@pos/shared';
import { parametros } from '../store/parametros';

/** Configuración local de este equipo (caja o PC de administración). */
export interface ConfigEquipo {
  /** URL del servidor de tienda (cajas) o del central (administración), ej. http://192.168.1.10:3001 */
  servidor: string;
  /** Caja asignada a este equipo; null = equipo de administración */
  cajaId: string | null;
  cajaNombre: string | null;
  sucursalId: string | null;
  moneda: string;
  /** Minutos de inactividad antes de cerrar sesión en caja */
  inactividadMin: number;
}

const KEY = 'pos.config';

const defecto: ConfigEquipo = {
  servidor: import.meta.env.DEV ? 'http://localhost:3001' : window.location.protocol.startsWith('http') ? window.location.origin : 'http://localhost:3001',
  cajaId: null,
  cajaNombre: null,
  sucursalId: null,
  moneda: 'S/',
  inactividadMin: 10,
};

export function leerConfig(): ConfigEquipo {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defecto, ...JSON.parse(raw) };
  } catch {
    /* almacenamiento no disponible */
  }
  return { ...defecto };
}

export function guardarConfig(c: Partial<ConfigEquipo>) {
  const nueva = { ...leerConfig(), ...c };
  try {
    localStorage.setItem(KEY, JSON.stringify(nueva));
  } catch {
    /* ignorar */
  }
  return nueva;
}

export function configurado(): boolean {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

/** Formatea dinero con la moneda, decimales y separadores configurados (Administración → Sistema). */
export function dinero(v: string | number, _moneda?: string) {
  return formatearDinero(v, parametros().regional);
}

/** Decimales de la moneda configurada (0 o 2) */
export const decimalesMoneda = () => parametros().regional.decimales;

export function cantidad(v: string | number, unidad: string) {
  const n = Number(v);
  return unidad === 'UND' ? String(Math.round(n)) : `${n.toFixed(3)} ${unidad.toLowerCase()}`;
}
