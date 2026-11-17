import ExcelJS from 'exceljs';
import { PRESETS_PAIS } from '@pos/shared';
import { decodificarTexto, leerArchivo, normalizarFilas, parsearCsv } from './importacion.parser';

const ctxCO = {
  separadorDecimal: ',' as const,
  decimales: 0 as const,
  impuestos: PRESETS_PAIS.CO.impuestos,
  sucursales: ['S01', 'S02'],
};

describe('parsearCsv', () => {
  it('detecta ; y respeta comillas', () => {
    const t = parsearCsv('codigo;nombre;precio\r\n770;"Arroz; 500 g";"3.500"\r\n771;"Dice ""hola""";1200\r\n');
    expect(t).toEqual([
      ['codigo', 'nombre', 'precio'],
      ['770', 'Arroz; 500 g', '3.500'],
      ['771', 'Dice "hola"', '1200'],
    ]);
  });
  it('detecta , como separador', () => {
    expect(parsearCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('lee CSV de Excel en Windows-1252 (acentos)', () => {
    const buf = Buffer.from([0x50, 0x61, 0xf1, 0x61, 0x6c]); // "Pañal" en cp1252
    expect(decodificarTexto(buf)).toBe('Pañal');
  });
});

describe('normalizarFilas', () => {
  const enc = ['Código de barras', 'Descripción', 'Categoria', 'Precio venta', 'IVA', 'Pesable', 'precio_S02'];

  it('acepta sinónimos, números locales e impuestos por tasa', () => {
    const r = normalizarFilas(enc, [['7702001000017|7702001000024', 'Gaseosa', 'Bebidas', '3.500', '19%', 'no', '3.800']], ctxCO);
    expect(r.problemas.filter((p) => p.tipo === 'error')).toEqual([]);
    expect(r.filas[0]).toMatchObject({
      codigos: ['7702001000017', '7702001000024'],
      nombre: 'Gaseosa',
      categoria: 'Bebidas',
      precio: '3500.00',
      impuestoCodigo: 'IVA19',
      tasaImpuesto: '19.00',
      pesable: false,
      preciosSucursal: { S02: '3800.00' },
    });
  });

  it('marca errores por fila sin detener el resto', () => {
    const r = normalizarFilas(
      enc,
      [
        ['111', 'Bueno', '', '1000', 'IVA5', '', ''],
        ['222', 'Precio malo', '', 'abc', '', '', ''],
        ['333', 'Impuesto raro', '', '1000', '7', '', ''],
        ['', 'Sin código', '', '1000', '', '', ''],
        ['111', 'Duplicado', '', '1000', '', '', ''],
      ],
      ctxCO,
    );
    const errores = r.problemas.filter((p) => p.tipo === 'error');
    expect(errores.map((e) => e.fila)).toEqual(expect.arrayContaining([3, 4, 5, 6]));
    expect(errores.find((e) => e.fila === 6)?.mensaje).toMatch(/repetido/);
    expect(r.filas.find((f) => f.fila === 2)?.precio).toBe('1000.00');
  });

  it('avisa de dígito verificador EAN inválido y notación científica', () => {
    const r = normalizarFilas(['codigo_barras', 'nombre', 'precio'], [['7702001000018', 'X', '1'], ['7.70201E+12', 'Y', '1']], ctxCO);
    expect(r.problemas.find((p) => p.fila === 2)?.tipo).toBe('aviso');
    expect(r.problemas.find((p) => p.fila === 3)?.tipo).toBe('error');
  });

  it('exige una columna de identificación', () => {
    const r = normalizarFilas(['nombre', 'precio'], [['X', '1']], ctxCO);
    expect(r.problemas[0].mensaje).toMatch(/codigo_barras/);
  });

  it('redondea precios con decimales cuando la moneda no usa decimales', () => {
    const r = normalizarFilas(['sku', 'precio'], [['A', '1250,6']], ctxCO);
    expect(r.filas[0].precio).toBe('1251.00');
    expect(r.problemas[0].tipo).toBe('aviso');
  });
});

describe('leerArchivo xlsx', () => {
  it('lee la primera hoja con números, textos y fórmulas', async () => {
    const wb = new ExcelJS.Workbook();
    const h = wb.addWorksheet('Hoja1');
    h.addRow(['codigo_barras', 'nombre', 'precio']);
    h.addRow([7702001000017, 'Leche', 4200]);
    h.addRow(['0012345678905', 'Importado', { formula: '1000*2', result: 2000 }]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await leerArchivo('productos.xlsx', buf);
    expect(r.encabezados).toEqual(['codigo_barras', 'nombre', 'precio']);
    const n = normalizarFilas(r.encabezados, r.filas, ctxCO);
    expect(n.filas.map((f) => [f.codigos[0], f.precio])).toEqual([
      ['7702001000017', '4200.00'],
      ['0012345678905', '2000.00'],
    ]);
  });

  it('rechaza .xls antiguo', async () => {
    await expect(leerArchivo('viejo.xls', Buffer.from('x'))).rejects.toThrow(/xlsx/);
  });
});
