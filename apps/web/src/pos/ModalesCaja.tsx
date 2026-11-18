import { useEffect, useState } from 'react';
import Decimal from 'decimal.js';
import { denominacionesMoneda, PERMISOS, type TicketData } from '@pos/shared';
import { get, post } from '../lib/api';
import { dinero, leerConfig } from '../lib/config';
import { abrirCajon, imprimirTicket } from '../lib/hardware';
import { useParametros } from '../store/parametros';
import { useSesion } from '../store/sesion';
import { Boton, Modal, NumPad, toast } from '../components/ui';
import { conAutorizacion, solicitarAutorizacion } from '../components/Autorizacion';
import { TecladoVirtual } from '../components/TecladoVirtual';
import { nombreEstadoVenta, nombreMetodo } from './metodos';
import { ATAJOS } from './shortcuts';

// ───────── Más opciones: lo que no se usa en cada venta ─────────
export interface OpcionCaja {
  texto: string;
  ayuda: string;
  onClick: () => void;
  /** Si viene, la opción no se puede usar y se muestra este motivo */
  bloqueada?: string | null;
  peligro?: boolean;
  atajo?: string;
}

export function MasOpcionesModal({ opciones, onCerrar }: { opciones: OpcionCaja[]; onCerrar: () => void }) {
  return (
    <Modal titulo="Más opciones" onCerrar={onCerrar} ancho="max-w-4xl">
      <div className="grid grid-cols-2 gap-3">
        {opciones.map((o) => (
          <button
            key={o.texto}
            disabled={!!o.bloqueada}
            onClick={o.onClick}
            className={`btn-touch flex min-h-[88px] flex-col items-start justify-center border-2 px-4 py-2 text-left ${
              o.peligro ? 'border-red-200 bg-red-50 text-red-800' : 'border-slate-200 bg-white text-slate-800'
            }`}
          >
            <span className="flex w-full items-center justify-between text-xl">
              {o.texto}
              {o.atajo && <span className="text-xs font-normal text-slate-400">{o.atajo}</span>}
            </span>
            <span className={`text-sm font-normal ${o.bloqueada ? 'text-amber-700' : 'text-slate-500'}`}>{o.bloqueada ?? o.ayuda}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

// ───────── Ayuda para el cajero ─────────
const PASOS_AYUDA: { titulo: string; pasos: string[] }[] = [
  {
    titulo: 'Vender',
    pasos: [
      'Pase el producto por el lector, o tóquelo en la pantalla.',
      'Si no lo encuentra, toque «Buscar» y escriba parte del nombre.',
      'Para llevar varios iguales: «Cantidad», escriba el número y luego pase el producto.',
      'Para quitar algo: tóquelo en la lista y luego «Quitar».',
    ],
  },
  {
    titulo: 'Cobrar',
    pasos: [
      'Toque el botón verde «COBRAR».',
      'Efectivo: toque el billete que le dio el cliente. La venta queda lista y sale el cambio en grande.',
      'Tarjeta o Nequi: toque la forma de pago y luego «Cobrar con…».',
      'Si paga con dos formas (ej. efectivo + Nequi), agregue cada parte y toque «Finalizar venta».',
    ],
  },
  {
    titulo: 'Cliente que olvidó algo',
    pasos: ['Toque «En espera»: la venta se guarda y puede atender al siguiente.', 'Cuando vuelva, toque «Recuperar» y elija su venta.'],
  },
  {
    titulo: 'Fin del día',
    pasos: ['Termine la venta en curso.', 'Toque «Cerrar turno», cuente billetes y monedas, y toque «Cerrar turno».'],
  },
];

export function AyudaModal({ onCerrar }: { onCerrar: () => void }) {
  const atajos: [string, string][] = [
    [ATAJOS.buscar, 'Buscar producto'],
    [ATAJOS.cantidad, 'Cantidad'],
    [ATAJOS.ayuda, 'Esta ayuda'],
    [ATAJOS.pesar, 'Pesar'],
    [ATAJOS.masOpciones, 'Más opciones'],
    [ATAJOS.suspender, 'Poner en espera'],
    [ATAJOS.recuperar, 'Recuperar venta'],
    [ATAJOS.descuento, 'Descuento'],
    [ATAJOS.quitar, 'Quitar producto'],
    [ATAJOS.cobrar, 'Cobrar'],
    [ATAJOS.ventas, 'Ventas del turno'],
    [ATAJOS.cerrarTurno, 'Cerrar turno'],
  ];
  return (
    <Modal titulo="¿Cómo usar la caja?" onCerrar={onCerrar} ancho="max-w-5xl">
      <div className="grid grid-cols-2 gap-4">
        {PASOS_AYUDA.map((s) => (
          <div key={s.titulo} className="rounded-xl bg-slate-50 p-4">
            <div className="mb-2 text-xl font-bold text-marca-700">{s.titulo}</div>
            <ol className="list-decimal space-y-1 pl-5 text-lg">
              {s.pasos.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ol>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-xl border-2 border-slate-200 p-4">
        <div className="mb-2 font-bold">Teclas rápidas (teclado)</div>
        <div className="grid grid-cols-4 gap-x-4 gap-y-1">
          {atajos.map(([k, t]) => (
            <div key={k}>
              <span className="mr-2 inline-block w-10 rounded bg-slate-200 text-center font-mono font-bold">{k}</span>
              {t}
            </div>
          ))}
        </div>
      </div>
      <Boton variante="primario" className="mt-4 w-full text-xl" onClick={onCerrar}>
        Entendido
      </Boton>
    </Modal>
  );
}

// ───────── Ventas del turno: reimprimir y anular ─────────
export function VentasTurnoModal({ onCerrar }: { onCerrar: () => void }) {
  const turno = useSesion((s) => s.turno);
  const [ventas, setVentas] = useState<any[]>([]);
  const [anulando, setAnulando] = useState<any | null>(null);
  const [motivo, setMotivo] = useState('');

  const cargar = () => turno && get<any[]>(`/ventas?turnoId=${turno.id}`).then(setVentas).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
  }, []);

  const reimprimir = async (id: string) => {
    try {
      const t = await get<TicketData>(`/ventas/${id}/ticket`);
      await imprimirTicket(t, leerConfig().moneda);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const anular = async () => {
    if (motivo.trim().length < 3) return toast.error('Indique el motivo');
    try {
      const t = await conAutorizacion((ids) => post<TicketData>(`/ventas/${anulando.id}/anular`, { motivo, autorizacionIds: ids }));
      if (!t) return;
      toast.ok(`Venta ${anulando.numeroCompleto} anulada`);
      await imprimirTicket(t, leerConfig().moneda).catch(() => undefined);
      setAnulando(null);
      setMotivo('');
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (anulando) {
    return (
      <Modal titulo={`Anular ${anulando.numeroCompleto}`} onCerrar={() => setAnulando(null)} ancho="max-w-4xl">
        <div className="mb-3 text-lg">
          Total: <b>{dinero(anulando.total)}</b>. Indique el motivo:
        </div>
        <input className="mb-3 h-14 w-full rounded-xl border-2 px-3 text-xl" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
        <TecladoVirtual valor={motivo} onChange={setMotivo} onEnter={anular} />
        <Boton variante="peligro" className="mt-3 w-full text-xl" onClick={anular}>
          Confirmar anulación
        </Boton>
      </Modal>
    );
  }

  return (
    <Modal titulo="Ventas del turno" onCerrar={onCerrar} ancho="max-w-4xl">
      <table className="w-full text-lg">
        <thead>
          <tr className="border-b text-left text-sm text-slate-500">
            <th className="p-2">Recibo</th>
            <th>Hora</th>
            <th className="text-right">Total</th>
            <th>Estado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {ventas.map((v) => (
            <tr key={v.id} className="border-b">
              <td className="p-2 font-mono">{v.numeroCompleto}</td>
              <td>{new Date(v.fecha).toLocaleTimeString('es')}</td>
              <td className="text-right font-bold">{dinero(v.total)}</td>
              <td className={`font-semibold ${v.estado === 'ANULADA' ? 'text-red-600' : 'text-marca-700'}`}>{nombreEstadoVenta(v.estado)}</td>
              <td className="flex justify-end gap-2 p-1">
                <Boton className="h-12 min-h-0" onClick={() => reimprimir(v.id)}>
                  Reimprimir
                </Boton>
                {v.estado !== 'ANULADA' && (
                  <Boton variante="peligro" className="h-12 min-h-0" onClick={() => setAnulando(v)}>
                    Anular
                  </Boton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!ventas.length && <div className="p-6 text-center text-slate-500">Sin ventas en este turno</div>}
    </Modal>
  );
}

// ───────── Retiros / ingresos de efectivo ─────────
export function MovimientoCajaModal({ onCerrar }: { onCerrar: () => void }) {
  const turno = useSesion((s) => s.turno)!;
  const usuario = useSesion((s) => s.usuario)!;
  const [tipo, setTipo] = useState<'RETIRO' | 'INGRESO'>('RETIRO');
  const [monto, setMonto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [paso, setPaso] = useState<'monto' | 'motivo'>('monto');

  const enviar = async () => {
    if (motivo.trim().length < 3) return toast.error('Indique el motivo');
    try {
      let ids: string[] = [];
      const permiso = tipo === 'RETIRO' ? PERMISOS.CAJA_RETIRO : PERMISOS.CAJA_INGRESO;
      const limite = tipo === 'RETIRO' ? usuario.retiroMaximo : Infinity;
      if (!usuario.permisos.includes(permiso) || Number(monto) > limite) {
        const r = await solicitarAutorizacion(permiso, { motivo: `${tipo === 'RETIRO' ? 'Retiro' : 'Ingreso'} de ${dinero(monto)}: ${motivo}` });
        if (!r) return;
        ids = [r.autorizacionId];
      }
      await post(`/turnos/${turno.id}/movimientos`, { tipo, monto, motivo, autorizacionIds: ids });
      await abrirCajon();
      toast.ok(`${tipo === 'RETIRO' ? 'Retiro' : 'Ingreso'} registrado`);
      onCerrar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Modal titulo="Movimiento de efectivo" onCerrar={onCerrar} ancho="max-w-4xl">
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Boton variante={tipo === 'RETIRO' ? 'alerta' : 'secundario'} className="h-16 text-xl" onClick={() => setTipo('RETIRO')}>
          Retiro (sale dinero)
        </Boton>
        <Boton variante={tipo === 'INGRESO' ? 'info' : 'secundario'} className="h-16 text-xl" onClick={() => setTipo('INGRESO')}>
          Ingreso (entra dinero)
        </Boton>
      </div>
      {paso === 'monto' ? (
        <div className="mx-auto max-w-sm">
          <div className="mb-3 rounded-xl border-2 p-3 text-right text-4xl font-bold">{dinero(monto || 0)}</div>
          <NumPad valor={monto} onChange={setMonto} onEnter={() => Number(monto) > 0 && setPaso('motivo')} />
        </div>
      ) : (
        <>
          <div className="mb-2 text-lg">
            Monto: <b>{dinero(monto)}</b> · Motivo:
          </div>
          <input className="mb-3 h-14 w-full rounded-xl border-2 px-3 text-xl" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          <TecladoVirtual valor={motivo} onChange={setMotivo} onEnter={enviar} />
          <div className="mt-3 flex gap-2">
            <Boton className="flex-1" onClick={() => setPaso('monto')}>
              Atrás
            </Boton>
            <Boton variante="primario" className="flex-1 text-xl" onClick={enviar}>
              Registrar
            </Boton>
          </div>
        </>
      )}
    </Modal>
  );
}

// ───────── Ventas en espera ─────────
export function SuspendidasModal({ onRecuperar, onCerrar }: { onRecuperar: (data: any) => void; onCerrar: () => void }) {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    get<any[]>('/ventas/suspendidas').then(setItems).catch((e) => toast.error(e.message));
  }, []);
  const recuperar = async (id: string) => {
    try {
      const s = await post<any>(`/ventas/suspendidas/${id}/recuperar`);
      onRecuperar(s.data);
    } catch (e: any) {
      toast.error(e.message);
    }
  };
  return (
    <Modal titulo="Ventas en espera" onCerrar={onCerrar}>
      <div className="grid grid-cols-2 gap-3">
        {items.map((s) => (
          <Boton key={s.id} className="h-24 text-lg" onClick={() => recuperar(s.id)}>
            {s.etiqueta ?? 'Venta en espera'}
            <span className="text-sm font-normal text-slate-500">
              {new Date(s.creadoEn).toLocaleTimeString('es')} · {s.data?.lineas?.length ?? 0} productos
            </span>
          </Boton>
        ))}
      </div>
      {!items.length && <div className="p-6 text-center text-slate-500">No hay ventas en espera</div>}
    </Modal>
  );
}

// ───────── Cierre de turno con arqueo ─────────
export function CerrarTurnoModal({ onCerrar, onCerrado }: { onCerrar: () => void; onCerrado: () => void }) {
  const turno = useSesion((s) => s.turno)!;
  const regional = useParametros((s) => s.p.regional);
  const dec = regional.decimales;
  const { billetes, monedas } = denominacionesMoneda(regional.monedaCodigo);
  const grupos: { titulo: string; valores: string[] }[] = [
    { titulo: 'Billetes', valores: billetes.map(String) },
    { titulo: 'Monedas', valores: monedas.map(String) },
  ];
  const [conteo, setConteo] = useState<Record<string, number>>({});
  const [editando, setEditando] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [resultado, setResultado] = useState<any | null>(null);
  const [resumen, setResumen] = useState<any | null>(null);

  useEffect(() => {
    get(`/turnos/${turno.id}/resumen`).then(setResumen).catch(() => undefined);
  }, []);

  const total = Object.entries(conteo).reduce((s, [d, n]) => s.plus(new Decimal(d).mul(n)), new Decimal(0));

  const cerrar = async () => {
    try {
      const r = await post(`/turnos/${turno.id}/cerrar`, { conteo, montoDeclarado: total.toFixed(2) });
      setResultado(r);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (resultado) {
    const dif = Number(resultado.diferencia);
    return (
      <Modal titulo="Turno cerrado" ancho="max-w-xl">
        <div className="space-y-2 text-xl">
          <Fila a="Ventas" b={`${resultado.cantidadVentas} recibos · ${dinero(resultado.totalVentas)}`} />
          {Object.entries(resultado.porMetodo as Record<string, string>).map(([m, v]) => (
            <Fila key={m} a={nombreMetodo(m)} b={dinero(v)} />
          ))}
          <Fila a="Efectivo esperado" b={dinero(resultado.efectivoEsperado)} />
          <Fila a="Efectivo contado" b={dinero(resultado.montoDeclarado)} />
          <div className={`rounded-xl p-3 text-center text-2xl font-bold ${dif === 0 ? 'bg-marca-100 text-marca-700' : 'bg-red-100 text-red-700'}`}>
            {dif === 0 ? 'Caja cuadrada' : `${dif > 0 ? 'Sobrante' : 'Faltante'}: ${dinero(Math.abs(dif))}`}
          </div>
        </div>
        <Boton variante="primario" className="mt-4 w-full text-xl" onClick={onCerrado}>
          Terminar
        </Boton>
      </Modal>
    );
  }

  return (
    <Modal titulo="Cerrar turno — Arqueo de caja" onCerrar={onCerrar} ancho="max-w-5xl">
      <div className="grid grid-cols-[1fr_340px] gap-5">
        <div>
          <p className="mb-3 text-lg text-slate-600">
            Cuente el efectivo del cajón. Toque cada billete o moneda y escriba <b>cuántos hay</b>.
          </p>
          {grupos.map((g) => (
            <div key={g.titulo} className="mb-3">
              <div className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">{g.titulo}</div>
              <div className="grid grid-cols-3 gap-2">
                {g.valores.map((d) => (
                  <button
                    key={d}
                    onClick={() => {
                      setEditando(d);
                      setValor(String(conteo[d] ?? ''));
                    }}
                    className={`btn-touch flex h-20 flex-col items-center justify-center border-2 ${
                      editando === d ? 'border-marca-500 bg-marca-50' : conteo[d] ? 'border-marca-100 bg-marca-50/50' : 'border-slate-200 bg-white'
                    }`}
                  >
                    <span className="text-xl">{dinero(d)}</span>
                    <span className="text-sm font-normal text-slate-500">
                      {conteo[d] ?? 0} = {dinero(new Decimal(d).mul(conteo[d] ?? 0).toFixed(dec))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {resumen && (
            <div className="mt-4 rounded-xl bg-slate-100 p-3 text-slate-700">
              Ventas del turno: <b>{resumen.cantidadVentas}</b> · Total <b>{dinero(resumen.totalVentas)}</b>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <div className="rounded-xl bg-slate-900 p-3 text-center text-white">
            <div className="text-sm opacity-70">Total contado</div>
            <div className="text-4xl font-bold">{dinero(total.toFixed(dec))}</div>
          </div>
          {!editando && <div className="rounded-xl bg-slate-50 p-3 text-center text-slate-600">Toque un billete o moneda de la izquierda</div>}
          {editando && (
            <>
              <div className="text-center text-lg">¿Cuántos de {dinero(editando)} hay?</div>
              <NumPad
                valor={valor}
                onChange={setValor}
                decimales={false}
                onEnter={() => {
                  setConteo({ ...conteo, [editando]: Number(valor || 0) });
                  setEditando(null);
                }}
              />
            </>
          )}
          <Boton variante="peligro" className="h-20 w-full text-2xl" onClick={cerrar}>
            Cerrar turno
          </Boton>
        </div>
      </div>
    </Modal>
  );
}

function Fila({ a, b }: { a: string; b: string }) {
  return (
    <div className="flex justify-between border-b py-1">
      <span className="text-slate-600">{a}</span>
      <b>{b}</b>
    </div>
  );
}
