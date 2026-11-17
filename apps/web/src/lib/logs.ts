import { leerConfig } from './config';
import { useSesion } from '../store/sesion';

/**
 * Envía errores de la caja al servidor de tienda (Administración → Errores de caja).
 * Nunca lanza excepciones ni bloquea la venta; limita a 10 envíos por minuto.
 */
let enviados: number[] = [];
let ultimo = '';

export function reportarError(mensaje: string, detalle?: unknown, nivel: 'error' | 'warn' = 'error') {
  try {
    const ahora = Date.now();
    enviados = enviados.filter((t) => ahora - t < 60_000);
    if (enviados.length >= 10 || mensaje === ultimo) return;
    enviados.push(ahora);
    ultimo = mensaje;
    setTimeout(() => (ultimo = ''), 5000);

    const cfg = leerConfig();
    const usuario = useSesion.getState().usuario;
    const det = detalle instanceof Error ? `${detalle.message}\n${detalle.stack ?? ''}` : detalle === undefined ? null : JSON.stringify(detalle);
    fetch(`${cfg.servidor.replace(/\/$/, '')}/api/logs/cliente`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nivel,
        mensaje: mensaje.slice(0, 2000),
        detalle: det?.slice(0, 8000) ?? null,
        pantalla: location.hash || location.pathname,
        version: window.pos?.version ?? 'web',
        cajaId: cfg.cajaId,
        usuarioId: usuario?.id ?? null,
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* nunca interrumpir la caja */
  }
}

/** Captura errores no controlados de la aplicación */
export function instalarCapturaErrores() {
  window.addEventListener('error', (e) => reportarError(`Error: ${e.message}`, e.error ?? { archivo: e.filename, linea: e.lineno }));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    // Los errores de API ya se muestran al usuario; se reportan solo si no son de validación
    if (r?.status && r.status < 500 && r.status !== 0) return;
    reportarError(`Promesa rechazada: ${r?.message ?? String(r)}`, r);
  });
}
