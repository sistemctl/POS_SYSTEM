/** Unidades de peso que el cajero puede escribir; los productos pesables se venden por KG o LB. */
export type UnidadPeso = 'KG' | 'LB' | 'G';
export const KG_POR_LIBRA = 0.45359237;

const enKg: Record<UnidadPeso, number> = { KG: 1, LB: KG_POR_LIBRA, G: 0.001 };

/** Unidad de venta de un producto pesable (todo lo que no sea LB se trata como KG). */
export function unidadVentaPeso(unidad: string | null | undefined): 'KG' | 'LB' {
  return String(unidad ?? '').toUpperCase() === 'LB' ? 'LB' : 'KG';
}

/** Convierte un peso entre unidades, redondeado a 3 decimales (gramos se redondean a entero). */
export function convertirPeso(valor: number, de: UnidadPeso, a: UnidadPeso): number {
  if (!Number.isFinite(valor)) return 0;
  const r = (valor * enKg[de]) / enKg[a];
  return a === 'G' ? Math.round(r) : Math.round(r * 1000) / 1000;
}
