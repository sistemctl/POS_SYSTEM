import { useEffect, useMemo, useRef, useState } from 'react';
import Decimal from 'decimal.js';
import { calcularPago, type MetodoPago, type PagoInput } from '@pos/shared';
import { dinero } from '../lib/config';
import { useParametros } from '../store/parametros';
import { Boton, Modal, NumPad } from '../components/ui';
import { METODOS_PAGO } from './metodos';

/**
 * Cobro. Caso normal (un solo pago): tocar el billete, «Pago exacto» o «Cobrar con tarjeta/Nequi»
 * registra la venta de inmediato. Pagos mixtos o montos escritos a mano se confirman con «Finalizar venta».
 */
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
  const METODOS = METODOS_PAGO.filter((m) => p.caja.formasPago.includes(m.id));
  const totalD = new Decimal(total);
  const RAPIDOS = p.caja.billetesRapidos;
  // Evita registrar dos veces si el cajero toca dos billetes muy rápido (antes de que llegue `procesando`)
  const enviado = useRef(false);
  const [pagos, setPagos] = useState<PagoInput[]>([]);
  const [metodo, setMetodo] = useState<MetodoPago>(METODOS[0]?.id ?? 'EFECTIVO');
  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');

  const res = useMemo(() => calcularPago(total, pagos.length ? pagos : [{ metodo: 'EFECTIVO', monto: '0.01' }], dec), [total, pagos, dec]);
  const pagado = pagos.reduce((s, x) => s.plus(x.monto), new Decimal(0));
  const faltante = Decimal.max(totalD.minus(pagado), 0);
  const vuelto = pagos.length ? res.vuelto : '0';
  const listo = pagos.length > 0 && res.valido;
  const nombreMetodo = METODOS.find((m) => m.id === metodo)?.nombre ?? '';

  /**
   * Agrega un pago. Si es el primero y cubre todo el total, la venta se registra en el mismo toque
   * (cobro rápido). `rapido = false` para montos escritos a mano: así un error de digitación se ve antes de finalizar.
   */
  const agregar = (m: string | number, met: MetodoPago = metodo, rapido = true) => {
    if (procesando || enviado.current) return;
    const v = new Decimal(m || 0);
    if (v.lte(0)) return;
    // Pagos no efectivo: como máximo lo que falta
    const final = met !== 'EFECTIVO' ? Decimal.min(v, faltante) : v;
    if (final.lte(0)) return;
    const nuevos = [...pagos, { metodo: met, monto: final.toFixed(dec), referencia: referencia || null }];
    setPagos(nuevos);
    setMonto('');
    setReferencia('');
    if (rapido && pagos.length === 0 && calcularPago(total, nuevos, dec).valido) {
      enviado.current = true;
      onCobrar(nuevos);
    }
  };

  // Si el registro falló (sin conexión, etc.) se permite reintentar con «Finalizar venta»
  useEffect(() => {
    if (!procesando) enviado.current = false;
  }, [procesando]);

  const exacto = () => agregar(faltante.toFixed(dec));

  return (
    <Modal titulo="Cobrar" onCerrar={procesando ? undefined : onCerrar} ancho="max-w-5xl">
      <div className="grid grid-cols-[1fr_340px] gap-5">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-slate-900 p-3 text-white">
              <div className="text-sm opacity-70">Total a pagar</div>
              <div className="text-3xl font-bold">{dinero(total)}</div>
            </div>
            <div className="rounded-xl bg-amber-100 p-3">
              <div className="text-sm text-slate-600">Falta</div>
              <div className="text-3xl font-bold">{dinero(faltante.toFixed(dec))}</div>
            </div>
            <div className="rounded-xl bg-marca-100 p-3">
              <div className="text-sm text-slate-600">Cambio (devuelta)</div>
              <div className="text-3xl font-bold text-marca-700">{dinero(vuelto)}</div>
            </div>
          </div>

          <div>
            <div className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">1. ¿Cómo paga el cliente?</div>
            <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.max(1, METODOS.length)}, minmax(0, 1fr))` }}>
              {METODOS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMetodo(m.id)}
                  className={`btn-touch h-16 text-lg text-white ${m.color} ${metodo === m.id ? 'ring-4 ring-amber-400 ring-offset-2' : 'opacity-60'}`}
                >
                  {m.nombre}
                </button>
              ))}
            </div>
          </div>

          <div>
            {metodo === 'EFECTIVO' ? (
              <>
                <div className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">2. Toque el billete que le entregó</div>
                <div className="grid grid-cols-4 gap-2">
                  <Boton variante="primario" className="h-16 text-lg" onClick={exacto} disabled={faltante.lte(0) || procesando}>
                    Pago exacto
                  </Boton>
                  {RAPIDOS.map((b) => (
                    <Boton key={b} className="h-16 text-xl" disabled={procesando} onClick={() => agregar(b)}>
                      {dinero(b)}
                    </Boton>
                  ))}
                </div>
                <div className="mt-1 text-sm text-slate-500">¿Otro valor? Escríbalo en el teclado de la derecha y toque «Aceptar».</div>
              </>
            ) : (
              <>
                <div className="mb-1 text-sm font-bold uppercase tracking-wide text-slate-500">2. Confirme el pago con {nombreMetodo}</div>
                <input
                  className="mb-2 h-14 w-full rounded-xl border-2 border-slate-300 px-3 text-lg"
                  placeholder="N° de aprobación / referencia (opcional)"
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                />
                <Boton variante="primario" className="h-16 w-full text-xl" onClick={exacto} disabled={faltante.lte(0) || procesando}>
                  Cobrar {dinero(faltante.toFixed(dec))} con {nombreMetodo}
                </Boton>
              </>
            )}
          </div>

          {pagos.length > 0 && (
            <div className="rounded-xl border-2 border-slate-200">
              {pagos.map((x, i) => (
                <div key={i} className="flex items-center justify-between border-b px-4 py-2 text-lg last:border-0">
                  <span>{METODOS_PAGO.find((m) => m.id === x.metodo)?.nombre}</span>
                  <span className="flex items-center gap-3">
                    <b>{dinero(x.monto)}</b>
                    <button
                      disabled={procesando}
                      className="btn-touch h-10 min-h-0 bg-red-100 px-3 text-red-700"
                      onClick={() => setPagos(pagos.filter((_, j) => j !== i))}
                    >
                      Quitar
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {pagos.length > 0 && faltante.gt(0) && (
            <div className="rounded-lg bg-amber-50 p-3 text-amber-900">
              Pago combinado: falta <b>{dinero(faltante.toFixed(dec))}</b>. Elija otra forma de pago para completar.
            </div>
          )}
          {pagos.length > 0 && !res.valido && res.error !== 'Pago incompleto' && (
            <div className="rounded-lg bg-red-100 p-3 text-red-700">{res.error}</div>
          )}
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border-2 border-slate-300 p-3 text-right text-3xl font-bold">{dinero(monto || 0)}</div>
          <NumPad
            valor={monto}
            onChange={setMonto}
            decimales={dec > 0}
            onEnter={() => (monto ? agregar(monto, metodo, false) : listo && !procesando && onCobrar(pagos))}
          />
          {procesando ? (
            <div className="rounded-xl bg-slate-100 p-4 text-center text-xl font-semibold">Registrando venta…</div>
          ) : (
            listo && (
              <div className="animate-pulse rounded-xl bg-marca-100 p-2 text-center text-lg font-semibold text-marca-800">
                Pago completo: toque «Finalizar venta»
              </div>
            )
          )}
          <Boton
            variante="primario"
            className={`h-20 w-full text-2xl ${listo ? 'ring-4 ring-acento' : ''}`}
            disabled={!listo || procesando}
            onClick={() => onCobrar(pagos)}
          >
            {procesando ? 'Registrando…' : 'Finalizar venta'}
          </Boton>
        </div>
      </div>
    </Modal>
  );
}
