import { describe, expect, it } from 'vitest';
import { calcularPago, calcularVenta, PromocionInput } from './pricing';

describe('calcularVenta', () => {
  it('extrae el impuesto de precios con impuesto incluido', () => {
    const r = calcularVenta([{ productoId: 'a', cantidad: 1, precioUnitario: '11.80', tasaImpuesto: 18 }]);
    expect(r.total).toBe('11.80');
    expect(r.subtotal).toBe('10.00');
    expect(r.impuesto).toBe('1.80');
  });

  it('suma de base + impuesto siempre igual al total', () => {
    const r = calcularVenta([
      { productoId: 'a', cantidad: 3, precioUnitario: '3.33', tasaImpuesto: 18 },
      { productoId: 'b', cantidad: '0.755', precioUnitario: '12.90', tasaImpuesto: 18 },
      { productoId: 'c', cantidad: 1, precioUnitario: '5.00', tasaImpuesto: 0 },
    ]);
    const suma = (Number(r.subtotal) + Number(r.impuesto)).toFixed(2);
    expect(suma).toBe(r.total);
    expect(r.lineas[1].total).toBe('9.74'); // 0.755 * 12.90 = 9.7395
  });

  it('aplica 2x1', () => {
    const promo: PromocionInput = { id: 'p', nombre: '2x1', tipo: 'NXM', productoIds: ['a'], llevar: 2, pagar: 1 };
    const r = calcularVenta([{ productoId: 'a', cantidad: 5, precioUnitario: '2.00', tasaImpuesto: 18 }], {
      promociones: [promo],
    });
    expect(r.total).toBe('6.00');
    expect(r.descuento).toBe('4.00');
    expect(r.lineas[0].promocionId).toBe('p');
  });

  it('aplica precio por cantidad y porcentaje, eligiendo la mejor', () => {
    const promos: PromocionInput[] = [
      { id: 'pc', nombre: '3 o más a 1.50', tipo: 'PRECIO_CANTIDAD', productoIds: ['a'], cantidadMinima: 3, precioPromo: '1.50' },
      { id: 'pct', nombre: '10%', tipo: 'PORCENTAJE', productoIds: ['a'], porcentaje: 10 },
    ];
    const r = calcularVenta([{ productoId: 'a', cantidad: 4, precioUnitario: '2.00', tasaImpuesto: 18 }], {
      promociones: promos,
    });
    expect(r.lineas[0].promocionId).toBe('pc');
    expect(r.total).toBe('6.00');
  });

  it('ignora promociones vencidas', () => {
    const promo: PromocionInput = {
      id: 'p', nombre: 'x', tipo: 'PORCENTAJE', productoIds: ['a'], porcentaje: 50, hasta: '2020-01-01',
    };
    const r = calcularVenta([{ productoId: 'a', cantidad: 1, precioUnitario: '10', tasaImpuesto: 18 }], {
      promociones: [promo],
    });
    expect(r.total).toBe('10.00');
  });

  it('aplica descuento manual después de la promoción', () => {
    const r = calcularVenta([
      { productoId: 'a', cantidad: 2, precioUnitario: '10', tasaImpuesto: 18, descuentoPorcentaje: 10 },
    ]);
    expect(r.total).toBe('18.00');
    expect(r.descuento).toBe('2.00');
  });
});

describe('calcularPago', () => {
  it('calcula vuelto en efectivo', () => {
    const r = calcularPago('17.30', [{ metodo: 'EFECTIVO', monto: 20 }]);
    expect(r.valido).toBe(true);
    expect(r.vuelto).toBe('2.70');
  });

  it('pago mixto exacto', () => {
    const r = calcularPago('50', [
      { metodo: 'TARJETA', monto: 30 },
      { metodo: 'EFECTIVO', monto: 20 },
    ]);
    expect(r.valido).toBe(true);
    expect(r.vuelto).toBe('0.00');
  });

  it('rechaza tarjeta por más del total', () => {
    const r = calcularPago('50', [{ metodo: 'TARJETA', monto: 60 }]);
    expect(r.valido).toBe(false);
  });

  it('detecta pago incompleto', () => {
    const r = calcularPago('50', [{ metodo: 'EFECTIVO', monto: 40 }]);
    expect(r.valido).toBe(false);
    expect(r.faltante).toBe('10.00');
  });
});
