import { v7 as uuidv7 } from 'uuid';

/** Genera un UUID v7 (ordenable por tiempo). Se usa en el origen (caja/tienda) para evitar colisiones al sincronizar. */
export function newId(): string {
  return uuidv7();
}

/** Formatea el número de ticket con la serie de la caja: C01-000123 */
export function formatTicketNumber(serie: string, numero: number): string {
  return `${serie}-${String(numero).padStart(6, '0')}`;
}
