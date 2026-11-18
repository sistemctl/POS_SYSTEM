import { describe, expect, it } from 'vitest';
import { calcularPago, calcularVenta, mismoMonto } from './pricing';
import { aplicarPreset, denominacionesMoneda, formatearDinero, normalizarParametros, PARAMETROS_DEFECTO, parsearNumeroLocal, PRESETS_PAIS } from './parametros';

describe('denominaciones para el arqueo', () => {
  it('usa billetes y monedas colombianos (sin centavos)', () => {
    const d = denominacionesMoneda('COP');
    expect(d.billetes).toContain(100000);
    expect(d.monedas).toContain(50);
    expect([...d.billetes, ...d.monedas].every((v) => Number.isInteger(v))).toBe(true);
  });
  it('moneda desconocida cae en pesos colombianos', () => {
    expect(denominacionesMoneda('XXX')).toEqual(denominacionesMoneda('COP'));
  });
});

const CO = PRESETS_PAIS.CO;
const PE = PRESETS_PAIS.PE;

describe('cálculo con 0 decimales (pesos colombianos)', () => {
  it('redondea a pesos enteros y base + IVA = total', () => {
    const r = calcularVenta(
      [
        { productoId: 'a', cantidad: 3, precioUnitario: '2350', tasaImpuesto: 19 },
        { productoId: 'b', cantidad: '0.755', precioUnitario: '12900', tasaImpuesto: 5 },
        { productoId: 'c', cantidad: 1, precioUnitario: '4200', tasaImpuesto: 0 },
      ],
      { decimales: 0 },
    );
    expect(r.lineas[1].total).toBe('9740'); // 0.755 * 12900 = 9739.5 → 9740
    expect(r.total).toBe('20990');
    expect(Number(r.subtotal) + Number(r.impuesto)).toBe(Number(r.total));
    expect(r.total).not.toContain('.');
  });

  it('2x1 en pesos', () => {
    const r = calcularVenta([{ productoId: 'a', cantidad: 2, precioUnitario: '3500', tasaImpuesto: 19 }], {
      decimales: 0,
      promociones: [{ id: 'p', nombre: '2x1', tipo: 'NXM', productoIds: ['a'], llevar: 2, pagar: 1 }],
    });
    expect(r.total).toBe('3500');
    expect(r.descuento).toBe('3500');
  });

  it('vuelto y comparación sin decimales', () => {
    const p = calcularPago('20990', [{ metodo: 'EFECTIVO', monto: '50000' }], 0);
    expect(p).toMatchObject({ valido: true, vuelto: '29010', faltante: '0' });
    expect(mismoMonto('20990', '20990.4', 0)).toBe(true);
    expect(mismoMonto('20990', '20991', 0)).toBe(false);
  });
});

describe('formato de dinero', () => {
  it('Colombia: $ 1.234.567', () => expect(formatearDinero(1234567, CO)).toBe('$ 1.234.567'));
  it('Perú: S/ 1,234.50', () => expect(formatearDinero('1234.5', PE)).toBe('S/ 1,234.50'));
  it('negativos', () => expect(formatearDinero(-2500, CO)).toBe('$ -2.500'));
});

describe('números escritos a mano o en Excel', () => {
  it.each([
    ['12.500', ',', 12500],
    ['12,500', '.', 12500],
    ['1.234,56', ',', 1234.56],
    ['1,234.56', '.', 1234.56],
    ['12,5', ',', 12.5],
    ['12.5', '.', 12.5],
    ['$ 3.500', ',', 3500],
    [4200, ',', 4200],
  ] as const)('%s (decimal "%s") → %s', (t, sep, esperado) => {
    expect(parsearNumeroLocal(t, sep)).toBe(esperado);
  });
  it('rechaza texto', () => {
    expect(parsearNumeroLocal('abc', ',')).toBeNull();
    expect(parsearNumeroLocal('', ',')).toBeNull();
  });
});

describe('parámetros', () => {
  it('por defecto es Colombia', () => {
    expect(PARAMETROS_DEFECTO.regional.monedaCodigo).toBe('COP');
    expect(PARAMETROS_DEFECTO.caja.billetesRapidos).toContain(50000);
  });
  it('preset cambia la parte regional y mantiene la marca', () => {
    const p = aplicarPreset({ ...PARAMETROS_DEFECTO, marca: { ...PARAMETROS_DEFECTO.marca, nombreComercial: 'X' } }, 'PE');
    expect(p.regional.etiquetaFiscal).toBe('RUC');
    expect(p.marca.nombreComercial).toBe('X');
  });
  it('normaliza datos incompletos', () => {
    const p = normalizarParametros({ marca: { nombreComercial: 'Súper Ana' } });
    expect(p.marca.nombreComercial).toBe('Súper Ana');
    expect(p.marca.colorPrimario).toBe(PARAMETROS_DEFECTO.marca.colorPrimario);
    expect(p.ticket.ancho).toBe(80);
  });
});
