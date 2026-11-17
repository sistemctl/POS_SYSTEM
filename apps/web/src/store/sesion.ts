import { create } from 'zustand';
import type { Permiso, UsuarioSesion } from '@pos/shared';

export interface Turno {
  id: string;
  cajaId: string;
  usuarioId: string;
  estado: string;
  abiertoEn: string;
  montoInicial: string;
}

interface SesionState {
  token: string | null;
  usuario: UsuarioSesion | null;
  turno: Turno | null;
  mensaje: string | null;
  iniciar: (token: string, usuario: UsuarioSesion) => void;
  setTurno: (t: Turno | null) => void;
  cerrarSesion: (mensaje?: string) => void;
  puede: (p: Permiso) => boolean;
}

const KEY = 'pos.sesion';

function cargar(): Pick<SesionState, 'token' | 'usuario'> {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignorar */
  }
  return { token: null, usuario: null };
}

export const useSesion = create<SesionState>((set, getState) => ({
  ...cargar(),
  turno: null,
  mensaje: null,
  iniciar: (token, usuario) => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ token, usuario }));
    } catch {
      /* ignorar */
    }
    set({ token, usuario, mensaje: null });
  },
  setTurno: (turno) => set({ turno }),
  cerrarSesion: (mensaje) => {
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* ignorar */
    }
    set({ token: null, usuario: null, turno: null, mensaje: mensaje ?? null });
  },
  puede: (p) => !!getState().usuario?.permisos.includes(p),
}));

export function usePermiso(p: Permiso) {
  return useSesion((s) => !!s.usuario?.permisos.includes(p));
}
