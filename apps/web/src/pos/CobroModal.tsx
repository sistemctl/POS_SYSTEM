import { useMemo, useState } from 'react';
import Decimal from 'decimal.js';
import { calcularPago, type MetodoPago, type PagoInput } from '@pos/shared';
import { dinero } from '../lib/config';
import { useParametros } from '../store/parametros';
import { Boton, Modal, NumPad } from '../components/ui';

const TODOS_METODOS: { id: MetodoPago; nombre: string; color: string }[] = [
  { id: 'EFECTIVO', nombre: 'Efectivo', color: 'bg-marca-600' },
  { id: 'TARJETA', nombre: 'Tarjeta', color: 'bg-sky-600' },
  { id: 'BILLETERA', nombre: 'Billetera digital', color: 'bg-violet-600' },
  { id: 'TRANSFERENCIA', nombre: 'Transferencia', color: 'bg-slate-700' },
  { id: 'OTRO', nombre: 'Otro', color: 'bg-stone-600' },
];

export function CobroModal({
  total,
  onCobrar,
  onCerrar,
  procesando,
}: {
  total: string;
  onCobrar: (pagos: PagoInput[]) => void;
  onCerrar: () => void;
  procesando: boolean;
}) {
  const p = useParametros((s) => s.p);
  const dec = p.regional.decimales;
  const METODOS = TODOS_METODOS.filter((m) => p.caja.formasPago.includes(m.id));
  const RAPIDOS = p.caja.billetesRapidos;
  const [pagos, setPagos] = useState<PagoInput[]>([]);
  const [metodo, setMetodo] = useState<MetodoPago>(METODOS[0]?.id ?? 'EFECTIVO');
  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');

  const res = useMemo(() => calcularPago(total, pagos.length ? pagos : [{ metodo: 'EFECTIVO', monto: '0.01' }], dec), [total, pagos, dec]);
  const pagado = pagos.reduce((s, p) => s.plus(p.monto), new Decimal(0));
  const faltante = Decimal.max(new Decimal(total).minus(pagado), 0);
  const vuelto = pagos.length ? res.vuelto : '0';
  const listo = pagos.length > 0 && res.valido;

  const agregar = (m: string | number, met: MetodoPago = metodo) => {
    const v = new Decimal(m || 0);
    if (v.lte(0)) return;
    // Pagos no efectivo: como máximo lo que falta
    const final = met !== 'EFECTIVO' ? Decimal.min(v, faltante) : v;
    if (final.lte(0)) return;
    setPagos([...pagos, { metodo: met, monto: final.toFixed(dec), referencia: referencia || null }]);
    setMonto('');
    setReferencia('');
  };

  const exacto = () => agregar(faltante.toFixed(dec));

  return (
    <Modal titulo="Cobrar" onCerrar={procesando ? undefined : onCerrar} ancho="max-w-5xl">
      <div className="grid grid-cols-[1fr_340px] gap-5">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-slate-900 p-3 text-white">
              <div className="text-sm opacity-70">Total</div>
              <div className="text-3xl font-bold">{dinero(total)}</div>
            </div>
            <div className="rounded-xl bg-amber-100 p-3">
              <div className="text-sm text-slate-600">Falta</div>
              <div className="text-3xl font-bold">{dinero(faltante.toFixed(2))}</div>
            </div>
            <div className="rounded-xl bg-marca-100 p-3">
              <div className="text-sm text-slate-600">Vuelto</div>
              <div className="text-3xl font-bold text-marca-700">{dinero(vuelto)}</div>
            </div>
          </div>

          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, METODOS.length)}, minmax(0, 1fr))` }}>
            {METODOS.map((m) => (
              <button
                key={m.id}
                onClick={() => setMetodo(m.id)}
                className={`btn-touch h-16 text-lg text-white ${m.color} ${metodo === m.id ? 'ring-4 ring-offset-2 ring-amber-400' : 'opacity-70'}`}
              >
                {m.nombre}
              </button>
            ))}
          </div>

          {metodo === 'EFECTIVO' ? (
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${RAPIDOS.length + 1}, minmax(0, 1fr))` }}>
              <Boton variante="primario" className="h-16 text-lg" onClick={exacto} disabled={faltante.lte(0)}>
                Exacto
              </Boton>
              {RAPIDOS.map((b) => (
                <Boton key={b} className="h-16 text-xl" onClick={() => agregar(b)}>
                  {dinero(b)}
                </Boton>
              ))}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                className="h-14 flex-1 rounded-xl border-2 border-slate-300 px-3 text-lg"
                placeholder="Referencia / N° operación (opcional)"
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
              />
              <Boton variante="primario" className="h-14" onClick={exacto} disabled={faltante.lte(0)}>
                Cobrar {dinero(faltante.toFixed(2))}
              </Boton>
            </div>
          )}

          <div className="rounded-xl border-2 border-slate-200">
            {pagos.map((p, i) => (
              <div key={i} className="flex items-center justify-between border-b px-4 py-2 text-lg last:border-0">
                <span>{METODOS.find((m) => m.id === p.metodo)?.nombre}</span>
                <span className="flex items-center gap-3">
                  <b>{dinero(p.monto)}</b>
                  <button className="btn-touch h-10 min-h-0 bg-red-100 px-3 text-red-700" onClick={() => setPagos(pagos.filter((_, j) => j !== i))}>
                    Quitar
                  </button>
                </span>
              </div>
            ))}
            {!pagos.length && <div className="p-4 text-center text-slate-400">Agregue uno o más pagos</div>}
          </div>
          {pagos.length > 0 && !res.valido && res.error !== 'Pago incompleto' && (
            <div className="rounded-lg bg-red-100 p-3 text-red-700">{res.error}</div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border-2 border-slate-300 p-3 text-right text-3xl font-bold">{dinero(monto || 0)}</div>
          <NumPad valor={monto} onChange={setMonto} onEnter={() => (monto ? agregar(monto) : listo && !procesando && onCobrar(pagos))} />
          {listo && !procesando && (
            <div className="animate-pulse rounded-xl bg-marca-100 p-2 text-center text-lg font-semibold text-marca-800">
              Pago completo: toque «Finalizar venta»
            </div>
          )}
          <Boton variante="primario" className={`h-20 w-full text-2xl ${listo ? 'ring-4 ring-acento' : ''}`} disabled={!listo || procesando} onClick={() => onCobrar(pagos)}>
            {procesando ? 'Registrando…' : 'Finalizar venta'}
          </Boton>
        </div>
      </div>
    </Modal>
  );
}
