import { create } from 'zustand';
import { normalizarParametros, PARAMETROS_DEFECTO, type Parametros } from '@pos/shared';
import { get } from '../lib/api';

const KEY = 'pos.parametros';

interface ParametrosState {
  p: Parametros;
  /** false si el administrador todavía no configuró el sistema (se muestra el asistente) */
  configurado: boolean;
  cargado: boolean;
  cargar: () => Promise<void>;
  aplicar: (p: Parametros, configurado?: boolean) => void;
}

function leerCache(): { p: Parametros; configurado: boolean } | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return { p: normalizarParametros(d.p), configurado: !!d.configurado };
    }
  } catch {
    /* sin almacenamiento */
  }
  return null;
}

/** Aplica el color de marca a las variables CSS (los tonos se derivan con color-mix en index.css) */
export function aplicarTema(p: Parametros) {
  const root = document.documentElement.style;
  root.setProperty('--marca', p.marca.colorPrimario);
  root.setProperty('--acento', p.marca.colorAcento);
  root.setProperty('--boton-alto', p.caja.tamanoBotones === 'GRANDE' ? '72px' : '56px');
  document.title = `${p.marca.nombreComercial} · POS`;
}

const inicial = leerCache();
if (inicial) aplicarTema(inicial.p);

/**
 * Parámetros del sistema (moneda, marca, ticket, caja). Se guardan en caché local para que la caja
 * arranque con la configuración correcta aunque el servidor no responda.
 */
export const useParametros = create<ParametrosState>((set, getState) => ({
  p: inicial?.p ?? PARAMETROS_DEFECTO,
  configurado: inicial?.configurado ?? false,
  cargado: false,
  cargar: async () => {
    try {
      const r = await get<Parametros & { configurado: boolean }>('/parametros');
      getState().aplicar(normalizarParametros(r), r.configurado);
    } finally {
      set({ cargado: true });
    }
  },
  aplicar: (p, configurado = true) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ p, configurado }));
    } catch {
      /* ignorar */
    }
    aplicarTema(p);
    set({ p, configurado });
  },
}));

/** Acceso fuera de React */
export const parametros = () => useParametros.getState().p;
