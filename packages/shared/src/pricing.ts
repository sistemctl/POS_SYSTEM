import Decimal from 'decimal.js';

/**
 * Cálculo de precios centralizado. Lo usan la caja (para mostrar) y la API (para validar),
 * así ambos obtienen exactamente el mismo total. Los precios se manejan CON impuesto incluido.
 */

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export type Numeric = number | string;

export type TipoPromocion = 'PORCENTAJE' | 'NXM' | 'PRECIO_CANTIDAD';

export interface PromocionInput {
  id: string;
  nombre: string;
  tipo: TipoPromocion;
  productoIds: string[];
  /** PORCENTAJE: % de descuento */
  porcentaje?: Numeric;
  /** NXM: lleva N (llevar) paga M (pagar). Ej: 2x1 → llevar=2, pagar=1 */
  llevar?: number;
  pagar?: number;
  /** PRECIO_CANTIDAD: desde cantidadMinima unidades, el precio unitario pasa a precioPromo */
  cantidadMinima?: Numeric;
  precioPromo?: Numeric;
  activa?: boolean;
  desde?: string | Date | null;
  hasta?: string | Date | null;
}

export interface ItemInput {
  productoId: string;
  cantidad: Numeric;
  /** Precio unitario con impuesto incluido */
  precioUnitario: Numeric;
  /** Tasa de impuesto en %, ej. 18 */
  tasaImpuesto: Numeric;
  /** Descuento manual en % sobre la línea (requiere permiso) */
  descuentoPorcentaje?: Numeric;
}

export interface LineaCalculada {
  productoId: string;
  cantidad: string;
  precioUnitario: string;
  bruto: string;
  descuentoPromocion: string;
  descuentoManual: string;
  total: string;
  baseImponible: string;
  impuesto: string;
  tasaImpuesto: string;
  promocionId: string | null;
}

export interface TotalesVenta {
  lineas: LineaCalculada[];
  subtotal: string; // base imponible total
  impuesto: string;
  descuento: string;
  total: string;
  impuestoPorTasa: Record<string, { base: string; impuesto: string }>;
}

const ZERO = new Decimal(0);
/** Decimales del dinero: 2 (por defecto) o 0 (ej. pesos colombianos). */
export type Decimales = 0 | 2;

const money = (d: Decimal, dec: Decimales = 2) => d.toDecimalPlaces(dec, Decimal.ROUND_HALF_UP);
const fmt = (d: Decimal, dec: Decimales = 2) => money(d, dec).toFixed(dec);

export function redondearDinero(v: Numeric, decimales: Decimales = 2): string {
  return fmt(new Decimal(v), decimales);
}

export function redondearCantidad(v: Numeric): string {
  return new Decimal(v).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

function promocionVigente(p: PromocionInput, ahora: Date): boolean {
  if (p.activa === false) return false;
  if (p.desde && new Date(p.desde) > ahora) return false;
  if (p.hasta && new Date(p.hasta) < ahora) return false;
  return true;
}

/** Calcula el descuento de una promoción para una línea. Devuelve 0 si no aplica. */
function descuentoPromocion(p: PromocionInput, cantidad: Decimal, precio: Decimal, dec: Decimales): Decimal {
  switch (p.tipo) {
    case 'PORCENTAJE': {
      const pct = new Decimal(p.porcentaje ?? 0);
      return money(cantidad.mul(precio).mul(pct).div(100), dec);
    }
    case 'NXM': {
      const llevar = p.llevar ?? 0;
      const pagar = p.pagar ?? 0;
      if (llevar <= 0 || pagar < 0 || pagar >= llevar) return ZERO;
      const grupos = cantidad.div(llevar).floor();
      const gratis = grupos.mul(llevar - pagar);
      return money(gratis.mul(precio), dec);
    }
    case 'PRECIO_CANTIDAD': {
      const min = new Decimal(p.cantidadMinima ?? 0);
      if (p.precioPromo === undefined || cantidad.lt(min) || min.lte(0)) return ZERO;
      const diff = precio.minus(new Decimal(p.precioPromo));
      if (diff.lte(0)) return ZERO;
      return money(diff.mul(cantidad), dec);
    }
    default:
      return ZERO;
  }
}

export interface OpcionesCalculo {
  promociones?: PromocionInput[];
  ahora?: Date;
  /** Decimales del dinero (parámetros regionales). Por defecto 2. */
  decimales?: Decimales;
}

/**
 * Calcula los totales de una venta. Cantidades iguales del mismo producto deben venir
 * agrupadas en una línea para que promociones tipo NxM se apliquen correctamente
 * (la caja agrupa automáticamente al escanear).
 */
export function calcularVenta(items: ItemInput[], opciones: OpcionesCalculo = {}): TotalesVenta {
  const ahora = opciones.ahora ?? new Date();
  const promos = (opciones.promociones ?? []).filter((p) => promocionVigente(p, ahora));
  const dec: Decimales = opciones.decimales ?? 2;
  const m = (d: Decimal) => money(d, dec);
  const f = (d: Decimal) => fmt(d, dec);

  let subtotal = ZERO;
  let impuesto = ZERO;
  let descuento = ZERO;
  let total = ZERO;
  const impuestoPorTasa: Record<string, { base: Decimal; impuesto: Decimal }> = {};

  const lineas: LineaCalculada[] = items.map((item) => {
    const cantidad = new Decimal(item.cantidad).toDecimalPlaces(3);
    const precio = new Decimal(item.precioUnitario);
    const tasa = new Decimal(item.tasaImpuesto);
    if (cantidad.lte(0)) throw new Error(`Cantidad inválida para ${item.productoId}`);
    if (precio.lt(0)) throw new Error(`Precio inválido para ${item.productoId}`);

    const bruto = m(cantidad.mul(precio));

    // Mejor promoción para el cliente
    let mejorPromo: PromocionInput | null = null;
    let descPromo = ZERO;
    for (const p of promos) {
      if (!p.productoIds.includes(item.productoId)) continue;
      const d = descuentoPromocion(p, cantidad, precio, dec);
      if (d.gt(descPromo)) {
        descPromo = d;
        mejorPromo = p;
      }
    }
    if (descPromo.gt(bruto)) descPromo = bruto;

    const pctManual = new Decimal(item.descuentoPorcentaje ?? 0);
    if (pctManual.lt(0) || pctManual.gt(100)) throw new Error('Descuento manual fuera de rango');
    const descManual = m(bruto.minus(descPromo).mul(pctManual).div(100));

    const totalLinea = m(bruto.minus(descPromo).minus(descManual));
    const base = m(totalLinea.div(tasa.div(100).plus(1)));
    const imp = totalLinea.minus(base);

    subtotal = subtotal.plus(base);
    impuesto = impuesto.plus(imp);
    descuento = descuento.plus(descPromo).plus(descManual);
    total = total.plus(totalLinea);

    const key = tasa.toFixed(2);
    impuestoPorTasa[key] ??= { base: ZERO, impuesto: ZERO };
    impuestoPorTasa[key].base = impuestoPorTasa[key].base.plus(base);
    impuestoPorTasa[key].impuesto = impuestoPorTasa[key].impuesto.plus(imp);

    return {
      productoId: item.productoId,
      cantidad: cantidad.toFixed(3),
      precioUnitario: f(precio),
      bruto: f(bruto),
      descuentoPromocion: f(descPromo),
      descuentoManual: f(descManual),
      total: f(totalLinea),
      baseImponible: f(base),
      impuesto: f(imp),
      tasaImpuesto: key,
      promocionId: mejorPromo?.id ?? null,
    };
  });

  return {
    lineas,
    subtotal: f(subtotal),
    impuesto: f(impuesto),
    descuento: f(descuento),
    total: f(total),
    impuestoPorTasa: Object.fromEntries(
      Object.entries(impuestoPorTasa).map(([k, v]) => [k, { base: f(v.base), impuesto: f(v.impuesto) }]),
    ),
  };
}

export type MetodoPago = 'EFECTIVO' | 'TARJETA' | 'TRANSFERENCIA' | 'BILLETERA' | 'OTRO';

export interface PagoInput {
  metodo: MetodoPago;
  monto: Numeric;
  referencia?: string | null;
}

export interface ResultadoPago {
  pagado: string;
  faltante: string;
  vuelto: string;
  valido: boolean;
  error?: string;
}

/** Valida pagos y calcula el vuelto. El vuelto solo puede salir del efectivo. */
export function calcularPago(total: Numeric, pagos: PagoInput[], decimales: Decimales = 2): ResultadoPago {
  const t = new Decimal(total);
  const fmt = (d: Decimal) => money(d, decimales).toFixed(decimales);
  const cero = fmt(ZERO);
  let pagado = ZERO;
  let efectivo = ZERO;
  for (const p of pagos) {
    const m = new Decimal(p.monto);
    if (m.lte(0)) return { pagado: cero, faltante: fmt(t), vuelto: cero, valido: false, error: 'Monto de pago inválido' };
    pagado = pagado.plus(m);
    if (p.metodo === 'EFECTIVO') efectivo = efectivo.plus(m);
  }
  const faltante = Decimal.max(t.minus(pagado), 0);
  const exceso = Decimal.max(pagado.minus(t), 0);
  if (exceso.gt(efectivo)) {
    return {
      pagado: fmt(pagado),
      faltante: fmt(faltante),
      vuelto: cero,
      valido: false,
      error: 'Los pagos que no son en efectivo no pueden superar el total',
    };
  }
  return {
    pagado: fmt(pagado),
    faltante: fmt(faltante),
    vuelto: fmt(exceso),
    valido: faltante.eq(0),
    error: faltante.gt(0) ? 'Pago incompleto' : undefined,
  };
}

/** Compara dos montos con la exactitud de la moneda (centavos o unidades). */
export function mismoMonto(a: Numeric, b: Numeric, decimales: Decimales = 2): boolean {
  return money(new Decimal(a), decimales).eq(money(new Decimal(b), decimales));
}
