import { formatearDinero, type TicketData } from '@pos/shared';
import { parametros } from '../store/parametros';
import { urlMedia } from './api';

/**
 * Puente con el hardware. En Electron lo expone el preload como window.pos;
 * en el navegador se usan alternativas (impresión del navegador) o se deshabilita.
 */
export interface ConfigHardware {
  impresora: {
    tipo: 'windows' | 'red' | 'serie' | 'ninguna';
    nombre?: string;
    host?: string;
    puerto?: number;
    /** Puerto COM (tipo 'serie') */
    com?: string;
    baudios?: number;
    ancho: 58 | 80;
    abrirCajon: boolean;
  };
  balanza: {
    driver: 'ninguna' | 'generico' | 'toledo' | 'cas' | 'datalogic' | 'simulada';
    puerto?: string;
    baudios?: number;
    bitsDatos?: 7 | 8;
    paridad?: 'none' | 'odd' | 'even';
  };
  /** Lector de códigos por puerto serie / USB-COM (los de tipo teclado no lo necesitan) */
  escaner?: {
    driver: 'ninguno' | 'datalogic' | 'serie';
    /** 'auto' = detectar el escáner Datalogic aunque cambie el número de COM */
    puerto?: string;
    baudios?: number;
  };
  visorCliente: boolean;
  kiosco: boolean;
  /** Servidor de tienda (también provee las actualizaciones de la caja) */
  servidor?: string;
}

/** Periféricos de una caja que se pueden administrar desde la web (Sucursales y cajas) */
export type HardwareCaja = Pick<ConfigHardware, 'impresora' | 'balanza' | 'visorCliente'> & { escaner: NonNullable<ConfigHardware['escaner']> };

export const HARDWARE_DEFECTO: HardwareCaja = {
  impresora: { tipo: 'windows', ancho: 80, abrirCajon: true },
  balanza: { driver: 'ninguna', baudios: 9600 },
  escaner: { driver: 'ninguno', puerto: 'auto', baudios: 9600 },
  visorCliente: false,
};

export function extraerHardware(c: Partial<ConfigHardware>): HardwareCaja {
  return {
    impresora: { ...HARDWARE_DEFECTO.impresora, ...c.impresora },
    balanza: { ...HARDWARE_DEFECTO.balanza, ...c.balanza },
    escaner: { ...HARDWARE_DEFECTO.escaner, ...c.escaner },
    visorCliente: c.visorCliente ?? false,
  };
}

/** JSON con claves ordenadas: para comparar configuraciones sin importar el orden */
function jsonEstable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(jsonEstable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => (v as any)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${jsonEstable((v as any)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

export const mismoHardware = (a: HardwareCaja, b: HardwareCaja) => jsonEstable(a) === jsonEstable(b);

export interface PosBridge {
  esElectron: true;
  version: string;
  printer: {
    printTicket(t: TicketData, opciones: { moneda: string }): Promise<void>;
    printText(texto: string): Promise<void>;
    list(): Promise<{ name: string; isDefault: boolean }[]>;
  };
  drawer: { open(): Promise<void> };
  scale: {
    read(): Promise<{ peso: number; estable: boolean }>;
    onWeight(cb: (d: { peso: number; estable: boolean }) => void): () => void;
    listPorts(): Promise<{ path: string; manufacturer?: string }[]>;
  };
  /** Opcional: versiones anteriores de la caja no lo exponen */
  scanner?: {
    onCode(cb: (codigo: string) => void): () => void;
    onError(cb: (mensaje: string) => void): () => void;
  };
  display: { update(estado: unknown): void };
  config: { get(): Promise<ConfigHardware>; set(c: ConfigHardware): Promise<void> };
  app: { exitKiosk(): Promise<void>; setKiosk(on: boolean): Promise<void>; quit(): Promise<void> };
}

declare global {
  interface Window {
    pos?: PosBridge;
  }
}

export const bridge = (): PosBridge | null => window.pos ?? null;
export const esElectron = () => !!window.pos?.esElectron;

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Contenido del ticket en HTML (impresión por navegador y vista previa en Configuración del sistema) */
export function ticketCuerpoHtml(t: TicketData, ancho: 58 | 80 = 80): string {
  const f = t.formato ?? parametros().regional;
  const m = (v: string) => formatearDinero(v, f);
  const fila = (a: string, b: string) => `<tr><td>${a}</td><td style="text-align:right;white-space:nowrap">${b}</td></tr>`;
  const items = t.items
    .map(
      (i) =>
        `<tr><td colspan="2">${esc(i.nombre)}</td></tr>` +
        fila(`&nbsp;&nbsp;${i.cantidad}${i.unidad !== 'UND' ? ' ' + i.unidad.toLowerCase() : ''} x ${m(i.precioUnitario)}`, m(i.total)) +
        (Number(i.descuento) > 0 ? fila('&nbsp;&nbsp;Descuento', `-${m(i.descuento)}`) : ''),
    )
    .join('');
  const impuestos = t.impuestos?.length
    ? t.impuestos.filter((x) => Number(x.impuesto) > 0).map((x) => fila(esc(x.nombre), m(x.impuesto))).join('')
    : fila(t.nombreImpuesto ?? 'Impuesto', m(t.impuesto));
  const logo = t.logo ? `<img src="${urlMedia(t.logo.url.split('/').pop()!)}" style="max-width:${ancho === 58 ? 48 : 60}mm;max-height:25mm"><br>` : '';
  return `<div style="font-family:monospace;font-size:12px;width:${ancho === 58 ? 48 : 72}mm;color:#000;background:#fff;padding:2mm">
    <div class="c" style="text-align:center">${logo}<b style="font-size:15px">${esc(t.empresa)}</b><br>${esc(t.sucursal)}
    ${t.direccion ? '<br>' + esc(t.direccion) : ''}${t.telefono ? '<br>Tel: ' + esc(t.telefono) : ''}
    ${t.ruc ? `<br>${esc(t.etiquetaFiscal ?? 'RUC')}: ${esc(t.ruc)}` : ''}
    ${(t.encabezado ?? []).map((l) => '<br>' + esc(l)).join('')}</div>
    <hr style="border:0;border-top:1px dashed #000">${t.anulada ? '<div style="text-align:center;font-weight:bold">*** ANULADO ***</div>' : ''}${t.reimpresion ? '<div style="text-align:center">REIMPRESIÓN</div>' : ''}
    Ticket: ${esc(t.numero)}<br>Fecha: ${new Date(t.fecha).toLocaleString('es')}<br>Caja: ${esc(t.caja)} · ${esc(t.cajero)}<hr style="border:0;border-top:1px dashed #000">
    <table style="width:100%;border-collapse:collapse">${items}</table><hr style="border:0;border-top:1px dashed #000"><table style="width:100%;border-collapse:collapse">
    ${fila('Subtotal', m(t.subtotal))}${impuestos}
    ${Number(t.descuento) > 0 && t.mostrarAhorro !== false ? fila('Usted ahorró', m(t.descuento)) : ''}
    <tr style="font-size:16px;font-weight:bold"><td>TOTAL</td><td style="text-align:right">${m(t.total)}</td></tr>
    ${t.pagos.map((p) => fila(esc(p.metodo), m(p.monto))).join('')}
    ${Number(t.vuelto) > 0 ? fila('<b>Vuelto</b>', `<b>${m(t.vuelto)}</b>`) : ''}</table><hr style="border:0;border-top:1px dashed #000">
    <div style="text-align:center">${esc(t.pie ?? '').replace(/\n/g, '<br>')}</div>
    ${t.qr ? `<div style="text-align:center;margin-top:2mm;border:1px solid #000;padding:2mm;font-size:10px">[ QR ]<br>${esc(t.qr)}</div>` : ''}</div>`;
}

/** HTML del ticket para impresión por navegador (fallback) */
export function ticketHtml(t: TicketData, _moneda?: string): string {
  const copias = Math.max(1, t.copias ?? 1);
  const cuerpo = ticketCuerpoHtml(t);
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}.copia{page-break-after:always}</style></head><body>
    ${Array.from({ length: copias }, () => `<div class="copia">${cuerpo}</div>`).join('')}</body></html>`;
}

export async function imprimirTicket(t: TicketData, moneda: string) {
  const b = bridge();
  if (b) return b.printer.printTicket(t, { moneda });
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow!.document;
  doc.open();
  doc.write(ticketHtml(t, moneda));
  doc.close();
  await new Promise((r) => setTimeout(r, 200));
  iframe.contentWindow!.print();
  setTimeout(() => iframe.remove(), 2000);
}

export async function abrirCajon() {
  await bridge()?.drawer.open();
}

export function actualizarVisor(estado: unknown) {
  bridge()?.display.update(estado);
}
