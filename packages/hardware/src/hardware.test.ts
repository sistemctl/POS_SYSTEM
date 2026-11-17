import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'events';
import { DatalogicCompartidaScale, interpretarDatalogic, parsearPeso } from './scale';
import { limpiarCodigoDatalogic } from './scanner';
import { ticketEscPos } from './escpos';

describe('parsearPeso', () => {
  it('lee distintas tramas', () => {
    expect(parsearPeso('ST,GS,+  1.255kg')).toBe(1.255);
    expect(parsearPeso('  0,750 kg')).toBe(0.75);
    expect(parsearPeso('W 002.500')).toBe(2.5);
    expect(parsearPeso('sin numero')).toBeNull();
  });
});

describe('interpretarDatalogic', () => {
  it('lee peso métrico, inglés y estados', () => {
    expect(interpretarDatalogic('S1101255')).toEqual({ peso: 1.255, estable: true });
    expect(interpretarDatalogic('S110275')).toEqual({ peso: 1.247, estable: true });
    expect(interpretarDatalogic('S141')).toBe('movimiento');
    expect(interpretarDatalogic('S143')).toBe('cero');
    expect(interpretarDatalogic('S140')).toBeNull();
    expect(interpretarDatalogic('S08A0123456789012')).toBeNull();
  });
});

describe('DatalogicCompartidaScale (escáner y balanza por el mismo cable)', () => {
  const canalFalso = (responder: (c: EventEmitter) => void, conectado = true) => {
    const c = new EventEmitter() as EventEmitter & { escribir(b: Buffer): boolean; enviado: string[] };
    c.enviado = [];
    c.escribir = (b) => {
      if (!conectado) return false;
      c.enviado.push(b.toString());
      setTimeout(() => responder(c), 5);
      return true;
    };
    return c;
  };

  it('pide S11 por el canal del escáner y lee el peso', async () => {
    const c = canalFalso((c) => c.emit('balanza', 'S1101255'));
    const b = new DatalogicCompartidaScale(c);
    await expect(b.leer()).resolves.toEqual({ peso: 1.255, estable: true });
    expect(c.enviado).toEqual(['S11\r']);
  });

  it('BEL del Magellan = balanza deshabilitada', async () => {
    const b = new DatalogicCompartidaScale(canalFalso((c) => c.emit('control', 0x07)));
    await expect(b.leer()).rejects.toThrow(/rechazó/);
  });

  it('falla claro si el escáner no está conectado', async () => {
    const b = new DatalogicCompartidaScale(canalFalso(() => undefined, false));
    await expect(b.leer()).rejects.toThrow(/no está conectado/);
  });
});

describe('limpiarCodigoDatalogic', () => {
  it('quita el identificador de simbología (lecturas reales del Magellan 9400i)', () => {
    expect(limpiarCodigoDatalogic('A711719542162\r')).toBe('711719542162'); // UPC-A
    expect(limpiarCodigoDatalogic('#202310089')).toBe('202310089'); // Code 128
    expect(limpiarCodigoDatalogic('F7702004003508')).toBe('7702004003508'); // EAN-13
    expect(limpiarCodigoDatalogic('FF77012345')).toBe('77012345'); // EAN-8
    expect(limpiarCodigoDatalogic('7702004003508')).toBe('7702004003508'); // sin prefijo
    expect(limpiarCodigoDatalogic('ABC-123')).toBe('ABC-123'); // alfanumérico sin prefijo
  });
});

describe('ticketEscPos', () => {
  it('genera bytes con inicialización, corte y apertura de cajón', () => {
    const b = ticketEscPos(
      {
        empresa: 'Súper', sucursal: 'Principal', direccion: null, ruc: null, caja: 'Caja 1', cajero: 'Ana',
        numero: 'S01C01-000001', fecha: new Date().toISOString(),
        items: [{ nombre: 'Plátano', cantidad: '1.250', unidad: 'KG', precioUnitario: '3.50', total: '4.38', descuento: '0.00' }],
        subtotal: '3.71', impuesto: '0.67', descuento: '0.00', total: '4.38', pagos: [{ metodo: 'Efectivo', monto: '10.00' }], vuelto: '5.62', pie: 'Gracias',
      },
      { ancho: 80, moneda: 'S/', abrirCajon: true },
    );
    expect(b.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(b.includes(Buffer.from([0x1b, 0x70, 0x00]))).toBe(true);
    expect(b.includes(Buffer.from([0x1d, 0x56]))).toBe(true);
  });

  it('imprime logo, QR, NIT, pesos sin decimales y copias', () => {
    const b = ticketEscPos(
      {
        empresa: 'Súper', sucursal: 'Centro', direccion: null, ruc: '900123456-7', etiquetaFiscal: 'NIT', caja: 'Caja 1', cajero: 'Ana',
        numero: 'S01C01-000002', fecha: new Date().toISOString(),
        items: [{ nombre: 'Arroz 500 g 🍚', cantidad: '2', unidad: 'UND', precioUnitario: '2400', total: '4800', descuento: '0' }],
        subtotal: '4034', impuesto: '766', descuento: '0', total: '4800', pagos: [{ metodo: 'Efectivo', monto: '10000' }], vuelto: '5200', pie: null,
        logo: { anchoBytes: 2, alto: 2, bits: Buffer.from([0xff, 0x00, 0x00, 0xff]).toString('base64'), url: '' },
        qr: 'https://ejemplo.com',
        copias: 2,
        formato: { monedaSimbolo: '$', decimales: 0, separadorMiles: '.', separadorDecimal: ',' },
        impuestos: [{ nombre: 'IVA 19%', base: '4034', impuesto: '766' }],
      },
      { ancho: 58, moneda: '$', abrirCajon: true },
    );
    const texto = b.toString('latin1');
    expect(b.includes(Buffer.from([0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0]))).toBe(true); // logo
    expect(b.includes(Buffer.from([0x1d, 0x28, 0x6b]))).toBe(true); // QR
    expect(texto).toContain('NIT: 900123456-7');
    expect(texto).toContain('$ 10.000');
    expect(texto).toContain('IVA 19%');
    expect(texto).not.toContain('🍚');
    // 2 copias → 2 cortes, cajón solo una vez
    expect(texto.split('\x1dV').length - 1).toBe(2);
    expect(texto.split('\x1bp\x00').length - 1).toBe(1);
  });
});
