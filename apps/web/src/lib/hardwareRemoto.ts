import { get } from './api';
import { leerConfig } from './config';
import { bridge, extraerHardware, mismoHardware, type HardwareCaja } from './hardware';

const INTERVALO_MS = 2 * 60 * 1000;
let timer: number | null = null;

/** Último hardware recibido del servidor para esta caja (null = la caja se configura localmente). */
let administrado: HardwareCaja | null = null;
const oyentes = new Set<(h: HardwareCaja | null) => void>();

export const hardwareAdministrado = () => administrado;

export function onHardwareAdministrado(cb: (h: HardwareCaja | null) => void) {
  oyentes.add(cb);
  return () => {
    oyentes.delete(cb);
  };
}

/**
 * Descarga la configuración de periféricos de esta caja (Administración → Sucursales y cajas)
 * y la aplica en Electron si cambió. Sin conexión no hace nada: la caja sigue con lo último aplicado.
 */
export async function sincronizarHardware(): Promise<void> {
  const b = bridge();
  const cfg = leerConfig();
  if (!b || !cfg.cajaId) return;
  const cajas = await get<{ id: string; hardware?: HardwareCaja | null }[]>('/cajas');
  const caja = cajas.find((c) => c.id === cfg.cajaId);
  const remoto = caja?.hardware ? extraerHardware(caja.hardware) : null;
  administrado = remoto;
  for (const cb of oyentes) cb(remoto);
  if (!remoto) return;
  const local = await b.config.get();
  if (mismoHardware(extraerHardware(local), remoto)) return;
  // Se conservan los ajustes propios del equipo (servidor, modo kiosco)
  await b.config.set({ ...local, ...remoto });
}

/** Arranca la sincronización periódica (solo en la caja de escritorio con caja asignada). */
export function iniciarHardwareRemoto() {
  if (timer !== null || !bridge() || !leerConfig().cajaId) return;
  const tick = () => sincronizarHardware().catch(() => undefined);
  tick();
  timer = window.setInterval(tick, INTERVALO_MS);
}
