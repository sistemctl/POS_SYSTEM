import * as iconv from 'iconv-lite';
import { formatearDinero, type TicketData } from '@pos/shared';

/** Constructor de comandos ESC/POS (compatible con Epson, Xprinter, Bixolon, etc.) */
export class EscPos {
  private partes: Buffer[] = [];
  constructor(private readonly columnas: number) {
    this.raw(0x1b, 0x40); // inicializar
    this.raw(0x1b, 0x74, 19); // tabla de caracteres PC858 (español + €)
  }

  raw(...bytes: number[]) {
    this.partes.push(Buffer.from(bytes));
    return this;
  }
  texto(t: string) {
    this.partes.push(iconv.encode(t, 'cp858'));
    return this;
  }
  linea(t = '') {
    return this.texto(t + '\n');
  }
  alinear(a: 'izq' | 'centro' | 'der') {
    return this.raw(0x1b, 0x61, a === 'izq' ? 0 : a === 'centro' ? 1 : 2);
  }
  negrita(on: boolean) {
    return this.raw(0x1b, 0x45, on ? 1 : 0);
  }
  /** Tamaño doble alto/ancho */
  grande(on: boolean) {
    return this.raw(0x1d, 0x21, on ? 0x11 : 0x00);
  }
  separador(c = '-') {
    return this.linea(c.repeat(this.columnas));
  }
  /** Texto a la izquierda y a la derecha en la misma línea */
  dosColumnas(izq: string, der: string, cols = this.columnas) {
    const espacio = cols - der.length;
    const i = izq.length > espacio - 1 ? izq.slice(0, espacio - 1) : izq;
    return this.linea(i + ' '.repeat(Math.max(1, espacio - i.length)) + der);
  }
  avanzar(n = 3) {
    return this.raw(0x1b, 0x64, n);
  }
  cortar() {
    return this.raw(0x1d, 0x56, 0x42, 0x00); // corte parcial con avance
  }
  /** Pulso al cajón de dinero (pin 2) */
  abrirCajon() {
    return this.raw(0x1b, 0x70, 0x00, 0x19, 0xfa);
  }
  /** Imagen 1-bit (GS v 0). bits: filas de anchoBytes bytes, 1 = negro */
  imagen(anchoBytes: number, alto: number, bits: Buffer) {
    this.raw(0x1d, 0x76, 0x30, 0x00, anchoBytes & 0xff, (anchoBytes >> 8) & 0xff, alto & 0xff, (alto >> 8) & 0xff);
    this.partes.push(bits);
    return this.linea();
  }
  /** Código QR modelo 2 (GS ( k). Compatible con Epson TM, Xprinter, Bixolon y la mayoría de clones. */
  qr(datos: string, tamano = 6) {
    const d = Buffer.from(datos, 'utf8');
    const len = d.length + 3;
    this.raw(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // modelo 2
    this.raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, tamano); // tamaño del módulo
    this.raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31); // corrección de errores M
    this.raw(0x1d, 0x28, 0x6b, len & 0xff, (len >> 8) & 0xff, 0x31, 0x50, 0x30);
    this.partes.push(d);
    this.raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // imprimir
    return this.linea();
  }
  buffer() {
    return Buffer.concat(this.partes);
  }
}

export const COLUMNAS: Record<58 | 80, number> = { 58: 32, 80: 48 };

/** Quita caracteres que la tabla PC858 no tiene (emojis, etc.) */
function limpiar(t: string) {
  return t.replace(/[^\x20-\x7E -ÿ€\n]/g, '');
}

function envolver(t: string, cols: number): string[] {
  const out: string[] = [];
  for (const parrafo of t.split('\n')) {
    let linea = '';
    for (const palabra of parrafo.split(' ')) {
      if ((linea + ' ' + palabra).trim().length > cols) {
        out.push(linea.trim());
        linea = palabra;
      } else linea += ' ' + palabra;
    }
    out.push(linea.trim());
  }
  return out;
}

/** Genera el ticket de venta en ESC/POS (una copia por cada t.copias; el cajón se abre solo en la primera). */
export function ticketEscPos(t: TicketData, opts: { ancho: 58 | 80; moneda: string; abrirCajon?: boolean }): Buffer {
  const copias = Math.max(1, Math.min(3, t.copias ?? 1));
  return Buffer.concat(Array.from({ length: copias }, (_, i) => unaCopia(t, { ...opts, abrirCajon: opts.abrirCajon && i === 0 })));
}

function unaCopia(t: TicketData, opts: { ancho: 58 | 80; moneda: string; abrirCajon?: boolean }): Buffer {
  const cols = COLUMNAS[opts.ancho];
  const p = new EscPos(cols);
  const formato = t.formato ?? { monedaSimbolo: opts.moneda, decimales: 2, separadorMiles: ',', separadorDecimal: '.' };
  const fmt = (v: string, _m?: string) => formatearDinero(v, formato);
  if (opts.abrirCajon) p.abrirCajon();
  p.alinear('centro');
  if (t.logo) {
    // Si el logo es más ancho que el papel de 58 mm (384 puntos = 48 bytes), se omite
    if (t.logo.anchoBytes <= (opts.ancho === 58 ? 48 : 72)) p.imagen(t.logo.anchoBytes, t.logo.alto, Buffer.from(t.logo.bits, 'base64'));
  }
  p.negrita(true).grande(true);
  envolver(limpiar(t.empresa), Math.floor(cols / 2)).forEach((l) => p.linea(l));
  p.grande(false).negrita(false);
  p.linea(limpiar(t.sucursal));
  if (t.direccion) envolver(limpiar(t.direccion), cols).forEach((l) => p.linea(l));
  if (t.telefono) p.linea(`Tel: ${t.telefono}`);
  if (t.ruc) p.linea(`${t.etiquetaFiscal ?? 'RUC'}: ${t.ruc}`);
  for (const l of t.encabezado ?? []) envolver(limpiar(l), cols).forEach((x) => p.linea(x));
  p.alinear('izq').separador();
  if (t.anulada) p.alinear('centro').negrita(true).linea('*** ANULADO ***').negrita(false).alinear('izq');
  if (t.reimpresion) p.alinear('centro').linea('-- REIMPRESION --').alinear('izq');
  p.linea(`Ticket: ${t.numero}`);
  p.linea(`Fecha: ${new Date(t.fecha).toLocaleString('es')}`);
  p.linea(`Caja: ${t.caja}  Cajero: ${t.cajero}`);
  p.separador();
  for (const i of t.items) {
    p.linea(limpiar(i.nombre).slice(0, cols));
    const cant = i.unidad === 'UND' ? `${i.cantidad} x ${fmt(i.precioUnitario, opts.moneda)}` : `${i.cantidad} ${i.unidad.toLowerCase()} x ${fmt(i.precioUnitario, opts.moneda)}`;
    p.dosColumnas(`  ${cant}`, fmt(i.total, opts.moneda));
    if (Number(i.descuento) > 0) p.dosColumnas('  Descuento', `-${fmt(i.descuento, opts.moneda)}`);
  }
  p.separador();
  p.dosColumnas('Subtotal', fmt(t.subtotal, opts.moneda));
  if (t.impuestos?.length) {
    for (const x of t.impuestos) if (Number(x.impuesto) > 0) p.dosColumnas(limpiar(x.nombre), fmt(x.impuesto));
  } else p.dosColumnas(t.nombreImpuesto ?? 'Impuesto', fmt(t.impuesto, opts.moneda));
  if (Number(t.descuento) > 0 && t.mostrarAhorro !== false) p.dosColumnas('Usted ahorro', fmt(t.descuento, opts.moneda));
  p.negrita(true).grande(true).dosColumnas('TOTAL', fmt(t.total, opts.moneda), Math.floor(cols / 2)).grande(false).negrita(false);
  for (const pg of t.pagos) p.dosColumnas(pg.metodo, fmt(pg.monto, opts.moneda));
  if (Number(t.vuelto) > 0) p.negrita(true).dosColumnas('Vuelto', fmt(t.vuelto, opts.moneda)).negrita(false);
  p.separador();
  p.alinear('centro');
  if (t.pie) envolver(limpiar(t.pie), cols).forEach((l) => p.linea(l));
  if (t.qr) p.qr(t.qr, opts.ancho === 58 ? 5 : 6);
  p.avanzar(4).cortar();
  return p.buffer();
}
