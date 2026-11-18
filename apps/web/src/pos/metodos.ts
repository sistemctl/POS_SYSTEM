import type { MetodoPago } from '@pos/shared';

/** Formas de pago con el nombre que entiende el cajero y su color en la pantalla de cobro. */
export const METODOS_PAGO: { id: MetodoPago; nombre: string; color: string }[] = [
  { id: 'EFECTIVO', nombre: 'Efectivo', color: 'bg-marca-600' },
  { id: 'TARJETA', nombre: 'Tarjeta', color: 'bg-sky-600' },
  { id: 'BILLETERA', nombre: 'Nequi / Daviplata', color: 'bg-violet-600' },
  { id: 'TRANSFERENCIA', nombre: 'Transferencia', color: 'bg-slate-700' },
  { id: 'OTRO', nombre: 'Otro', color: 'bg-stone-600' },
];

/** "EFECTIVO" → "Efectivo". Si llega algo desconocido se muestra tal cual. */
export function nombreMetodo(id: string): string {
  return METODOS_PAGO.find((m) => m.id === id)?.nombre ?? id;
}

/** Estado de una venta en palabras simples. */
export function nombreEstadoVenta(estado: string): string {
  if (estado === 'ANULADA') return 'Anulada';
  if (estado === 'COMPLETADA' || estado === 'PAGADA') return 'Pagada';
  return estado.charAt(0) + estado.slice(1).toLowerCase();
}
