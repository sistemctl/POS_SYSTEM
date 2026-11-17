import { leerConfig } from './config';
import { useSesion } from '../store/sesion';
import type { Permiso } from '@pos/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: any,
  ) {
    super(message);
  }
  /** Permiso para el que se necesita autorización de supervisor */
  get requiereAutorizacion(): Permiso | null {
    return this.body?.requiereAutorizacion ?? null;
  }
  get sinConexion() {
    return this.status === 0;
  }
}

function mensaje(body: any, status: number): string {
  if (!body) return `Error ${status}`;
  if (typeof body.message === 'string') {
    if (Array.isArray(body.errores) && body.errores.length) {
      return `${body.message}: ${body.errores.map((e: any) => `${e.campo} ${e.mensaje}`).join(', ')}`;
    }
    return body.message;
  }
  if (typeof body.message === 'object' && body.message?.message) return body.message.message;
  return `Error ${status}`;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; timeout?: number } = {}): Promise<T> {
  const { servidor } = leerConfig();
  const token = useSesion.getState().token;
  let res: Response;
  try {
    res = await fetch(`${servidor.replace(/\/$/, '')}/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeout ?? 20_000),
    });
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor de la tienda', null);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    // Nest envuelve objetos de excepción: { message: {...}, ... } o los mezcla en el body
    const b = body && typeof body.message === 'object' && !Array.isArray(body.message) ? { ...body, ...body.message } : body;
    if (res.status === 401 && token && !path.startsWith('/auth/')) {
      useSesion.getState().cerrarSesion('Sesión vencida');
    }
    throw new ApiError(res.status, mensaje(b, res.status), b);
  }
  return body as T;
}

const base = () => `${leerConfig().servidor.replace(/\/$/, '')}/api`;
const authHeader = (): Record<string, string> => {
  const token = useSesion.getState().token;
  return token ? { authorization: `Bearer ${token}` } : {};
};

/** URL pública de una imagen de producto o logo (id de /media) */
export function urlMedia(id: string | null | undefined): string | null {
  if (!id) return null;
  if (id.startsWith('data:') || id.startsWith('http')) return id;
  return `${base()}/media/${id}`;
}

/** Sube un archivo (multipart) */
export async function subirArchivo<T = any>(path: string, archivo: File, campo = 'archivo'): Promise<T> {
  const fd = new FormData();
  fd.append(campo, archivo, archivo.name);
  let res: Response;
  try {
    res = await fetch(base() + path, { method: 'POST', headers: authHeader(), body: fd, signal: AbortSignal.timeout(180_000) });
  } catch {
    throw new ApiError(0, 'Sin conexión con el servidor', null);
  }
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = body && typeof body.message === 'object' && !Array.isArray(body.message) ? { ...body, ...body.message } : body;
    throw new ApiError(res.status, mensaje(b, res.status), b);
  }
  return body as T;
}

/** Descarga un archivo autenticado (Excel) y lo guarda con el nombre indicado */
export async function descargar(path: string, nombre: string) {
  const res = await fetch(base() + path, { headers: authHeader() });
  if (!res.ok) throw new ApiError(res.status, `No se pudo descargar (${res.status})`, null);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 1000);
}

/** Lee un archivo de imagen como data URL */
export function leerComoDataUrl(f: File): Promise<string> {
  return new Promise((ok, err) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => err(new Error('No se pudo leer el archivo'));
    r.readAsDataURL(f);
  });
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, body?: unknown) => api<T>(p, { method: 'POST', body: body ?? {} });
export const put = <T = any>(p: string, body: unknown) => api<T>(p, { method: 'PUT', body });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
