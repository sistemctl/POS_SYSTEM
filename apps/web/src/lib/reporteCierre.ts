import Decimal from 'decimal.js';
import { nombreMetodo } from '../pos/metodos';
import { useParametros } from '../store/parametros';
import { dinero } from './config';
import { imprimirTexto } from './hardware';

/** Resumen de turno tal como lo devuelven GET /turnos/:id/resumen y POST /turnos/:id/cerrar. */
export interface ResumenTurno {
  turno: { id: string; abiertoEn: string; cerradoEn?: string | null; estado: string; diferencia?: string | null; montoCierreDeclarado?: string | null };
  cajero?: string | null;
  cerradoPor?: string | null;
  caja?: string | null;
  conteo?: Record<string, number> | null;
  observacion?: string | null;
  cantidadVentas: number;
  totalVentas: string;
  totalDescuentos: string;
  anuladas: number;
  totalAnulado: string;
  porMetodo: Record<string, string>;
  montoInicial: string;
  retiros: string;
  ingresos: string;
  efectivoEsperado: string;
  movimientos: { id: string; tipo: string; monto: string; motivo: string; creadoEn: string; usuario?: string | null; autorizadoPor?: string | null }[];
  /** Solo en la respuesta del cierre */
  diferencia?: string;
  montoDeclarado?: string;
}

const fecha = (v?: string | null) => (v ? new Date(v).toLocaleString('es') : '—');

/** Texto monoespaciado del reporte Z (cierre de turno) para la ticketera. */
export function reporteCierreTexto(r: ResumenTurno, opts: { columnas: number; empresa: string; reimpresion?: boolean }): string {
  const w = opts.columnas;
  const sep = '-'.repeat(w);
  const centro = (t: string) => {
    const s = t.slice(0, w);
    return ' '.repeat(Math.max(0, Math.floor((w - s.length) / 2))) + s;
  };
  const fila = (a: string, b: string) => {
    const izq = a.slice(0, Math.max(1, w - b.length - 1));
    return izq + ' '.repeat(Math.max(1, w - izq.length - b.length)) + b;
  };
  const envolver = (t: string) => {
    const out: string[] = [];
    for (let i = 0; i < t.length; i += w) out.push(t.slice(i, i + w));
    return out;
  };

  const declarado = r.montoDeclarado ?? r.turno.montoCierreDeclarado ?? null;
  const diferencia = r.diferencia ?? r.turno.diferencia ?? null;
  const dif = diferencia !== null ? Number(diferencia) : null;

  const l: string[] = [];
  l.push(centro(opts.empresa), centro('CIERRE DE CAJA (REPORTE Z)'));
  if (opts.reimpresion) l.push(centro('REIMPRESION'));
  l.push(sep);
  if (r.caja) l.push(fila('Caja:', r.caja));
  if (r.cajero) l.push(fila('Cajero:', r.cajero));
  l.push(fila('Apertura:', fecha(r.turno.abiertoEn)), fila('Cierre:', fecha(r.turno.cerradoEn)));
  if (r.cerradoPor && r.cerradoPor !== r.cajero) l.push(fila('Cerrado por:', r.cerradoPor));
  l.push(sep, 'VENTAS');
  l.push(fila(`Recibos (${r.cantidadVentas})`, dinero(r.totalVentas)));
  l.push(fila('Descuentos', dinero(r.totalDescuentos)));
  l.push(fila(`Anuladas (${r.anuladas})`, dinero(r.totalAnulado)));
  l.push(sep, 'FORMAS DE PAGO');
  const metodos = Object.entries(r.porMetodo);
  if (!metodos.length) l.push('Sin pagos');
  for (const [m, v] of metodos) l.push(fila(nombreMetodo(m), dinero(v)));
  l.push(sep, 'EFECTIVO');
  l.push(fila('Fondo inicial', dinero(r.montoInicial)));
  l.push(fila('+ Ingresos', dinero(r.ingresos)));
  l.push(fila('- Retiros', dinero(r.retiros)));
  for (const m of r.movimientos) {
    const hora = new Date(m.creadoEn).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    l.push(...envolver(`  ${hora} ${m.tipo === 'RETIRO' ? 'Retiro' : 'Ingreso'} ${dinero(m.monto)}: ${m.motivo}`));
  }
  l.push(fila('Esperado', dinero(r.efectivoEsperado)));
  if (declarado !== null) l.push(fila('Contado', dinero(declarado)));
  if (dif !== null) {
    const texto = dif === 0 ? 'CAJA CUADRADA' : `${dif > 0 ? 'SOBRANTE' : 'FALTANTE'} ${dinero(Math.abs(dif))}`;
    l.push(sep, centro(texto));
  }
  const conteo = Object.entries(r.conteo ?? {}).filter(([, n]) => n > 0);
  if (conteo.length) {
    l.push(sep, 'CONTEO');
    conteo
      .sort(([a], [b]) => Number(b) - Number(a))
      .forEach(([d, n]) => l.push(fila(`${n} x ${dinero(d)}`, dinero(new Decimal(d).mul(n).toFixed(2)))));
  } else if (declarado !== null) {
    l.push(sep, 'Conteo: total escrito directo');
  }
  if (r.observacion) l.push(sep, 'OBSERVACION', ...envolver(r.observacion));
  l.push(sep, '', '', fila('_'.repeat(Math.floor(w / 2) - 2), '_'.repeat(Math.floor(w / 2) - 2)), fila('Cajero', 'Supervisor'));
  l.push('', centro(`Impreso ${new Date().toLocaleString('es')}`));
  return l.join('\n');
}

/** Imprime el reporte Z con el ancho de papel y el nombre comercial configurados. */
export function imprimirReporteCierre(r: ResumenTurno, reimpresion = false) {
  const p = useParametros.getState().p;
  return imprimirTexto(reporteCierreTexto(r, { columnas: p.ticket.ancho === 58 ? 32 : 48, empresa: p.marca.nombreComercial, reimpresion }));
}
