import { describe, expect, it } from 'vitest';
import { convertirPeso, unidadVentaPeso } from './peso';

describe('convertirPeso', () => {
  it('convierte gramos, libras y kilos', () => {
    expect(convertirPeso(500, 'G', 'LB')).toBe(1.102);
    expect(convertirPeso(2, 'LB', 'KG')).toBe(0.907);
    expect(convertirPeso(1, 'KG', 'LB')).toBe(2.205);
    expect(convertirPeso(750, 'G', 'KG')).toBe(0.75);
    expect(convertirPeso(1.5, 'KG', 'KG')).toBe(1.5);
    expect(convertirPeso(1, 'LB', 'G')).toBe(454);
  });
  it('unidad de venta', () => {
    expect(unidadVentaPeso('lb')).toBe('LB');
    expect(unidadVentaPeso('KG')).toBe('KG');
    expect(unidadVentaPeso(undefined)).toBe('KG');
  });
});
