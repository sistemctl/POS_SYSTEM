import { describe, expect, it } from 'vitest';
import { buildEtiquetaBalanza, isValidEan13, parseEtiquetaBalanza } from './barcode';

describe('EAN-13', () => {
  it('valida dígito verificador', () => {
    expect(isValidEan13('7750182006088')).toBe(true);
    expect(isValidEan13('7750182006089')).toBe(false);
    expect(isValidEan13('123')).toBe(false);
  });
});

describe('etiqueta de balanza', () => {
  it('genera y parsea peso', () => {
    const code = buildEtiquetaBalanza('20', '00123', 1.255);
    expect(code).toHaveLength(13);
    expect(isValidEan13(code)).toBe(true);
    const r = parseEtiquetaBalanza(code);
    expect(r).toEqual({ prefijo: '20', codigoProducto: '00123', tipoValor: 'PESO', valor: 1.255 });
  });

  it('parsea precio', () => {
    const cfg = { prefijos: ['22'], longitudCodigo: 5, tipoValor: 'PRECIO' as const, decimales: 2, validarDigito: true };
    const code = buildEtiquetaBalanza('22', '45', 12.5, cfg);
    expect(parseEtiquetaBalanza(code, cfg)?.valor).toBe(12.5);
  });

  it('ignora códigos normales', () => {
    expect(parseEtiquetaBalanza('7750182006088')).toBeNull();
  });

  it('rechaza dígito verificador incorrecto', () => {
    const code = buildEtiquetaBalanza('20', '00123', 1.255);
    const bad = code.slice(0, 12) + ((Number(code[12]) + 1) % 10);
    expect(parseEtiquetaBalanza(bad)).toBeNull();
  });
});
