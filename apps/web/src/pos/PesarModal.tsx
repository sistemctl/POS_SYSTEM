import { useEffect, useState } from 'react';
import { convertirPeso, unidadVentaPeso, type ProductoCaja, type UnidadPeso } from '@pos/shared';
import { bridge } from '../lib/hardware';
import { dinero } from '../lib/config';
import { Boton, Modal, NumPad } from '../components/ui';

const NOMBRES: Record<UnidadPeso, string> = { LB: 'Libras', KG: 'Kilos', G: 'Gramos' };
const CORTO: Record<UnidadPeso, string> = { LB: 'lb', KG: 'kg', G: 'g' };
const CLAVE_UNIDAD = 'pesar:unidadManual';

function leerUnidadGuardada(): UnidadPeso | null {
  try {
    const u = localStorage.getItem(CLAVE_UNIDAD);
    return u === 'LB' || u === 'KG' || u === 'G' ? u : null;
  } catch {
    return null;
  }
}
function guardarUnidad(u: UnidadPeso) {
  try {
    localStorage.setItem(CLAVE_UNIDAD, u);
  } catch {
    /* sin almacenamiento: no pasa nada */
  }
}

/**
 * Producto pesable: muestra el peso en vivo de la balanza o permite ingresarlo manualmente
 * en libras, kilos o gramos. Devuelve la cantidad en la unidad de venta del producto (KG o LB).
 * Diseñado para caber sin desplazamiento en una pantalla de 1366×768.
 */
export function PesarModal({
  producto,
  onAceptar,
  onCerrar,
}: {
  producto: ProductoCaja;
  onAceptar: (cantidad: number) => void;
  onCerrar: () => void;
}) {
  const b = bridge();
  const unidadVenta = unidadVentaPeso(producto.unidad);
  const [peso, setPeso] = useState<{ peso: number; estable: boolean } | null>(null);
  const [manual, setManual] = useState(!b);
  const [unidadManual, setUnidadManual] = useState<UnidadPeso>(() => leerUnidadGuardada() ?? unidadVenta);
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!b || manual) return;
    let off: (() => void) | undefined;
    try {
      off = b.scale.onWeight((d) => {
        setPeso(d);
        setError(null);
      });
    } catch (e: any) {
      setError(e.message);
    }
    b.scale.read().then(setPeso).catch((e) => setError(e.message));
    return () => off?.();
  }, [manual]);

  const elegirUnidad = (u: UnidadPeso) => {
    setUnidadManual(u);
    guardarUnidad(u);
    setValor('');
  };

  // La balanza siempre entrega kg.
  const cantidad = manual
    ? convertirPeso(Number(valor || 0), unidadManual, unidadVenta)
    : convertirPeso(peso?.peso ?? 0, 'KG', unidadVenta);
  const total = cantidad * Number(producto.precio);
  const aceptar = () => cantidad > 0 && onAceptar(cantidad);

  const resumen = (
    <div className="grid grid-cols-2 gap-3 text-center">
      <div className="rounded-xl bg-slate-900 p-3 text-white">
        <div className="text-sm opacity-70">Peso a cobrar</div>
        <div className="font-mono text-4xl">{cantidad.toFixed(3)}</div>
        <div className="text-sm">
          {CORTO[unidadVenta]} {!manual && peso && (peso.estable ? '· estable' : '· estabilizando…')}
        </div>
      </div>
      <div className="rounded-xl bg-marca-50 p-3">
        <div className="text-sm text-slate-500">
          {dinero(producto.precio)} / {CORTO[unidadVenta]}
        </div>
        <div className="text-3xl font-bold">{dinero(total)}</div>
      </div>
    </div>
  );

  if (!manual) {
    return (
      <Modal titulo={`Pesar: ${producto.nombre}`} onCerrar={onCerrar} ancho="max-w-xl">
        <div className="mb-4">{resumen}</div>
        {error && <div className="mb-3 rounded-lg bg-red-100 p-3 text-red-700">Balanza: {error}</div>}
        <div className="flex gap-3">
          <Boton className="h-16 flex-1 text-lg" onClick={() => setManual(true)}>
            Ingresar peso manual
          </Boton>
          <Boton variante="primario" className="h-16 flex-1 text-xl" disabled={!peso || peso.peso <= 0 || !peso.estable} onClick={aceptar}>
            Confirmar peso
          </Boton>
        </div>
      </Modal>
    );
  }

  return (
    <Modal titulo={`Pesar: ${producto.nombre}`} onCerrar={onCerrar} ancho="max-w-4xl">
      <div className="grid grid-cols-2 gap-5">
        {/* Izquierda: unidad, lo escrito y el resultado */}
        <div className="flex flex-col gap-3">
          <div className="text-sm font-semibold text-slate-500">1. ¿En qué unidad escribe el peso?</div>
          <div className="grid grid-cols-3 gap-2">
            {(['LB', 'KG', 'G'] as UnidadPeso[]).map((u) => (
              <Boton key={u} variante={u === unidadManual ? 'primario' : 'secundario'} className="h-14 text-lg" onClick={() => elegirUnidad(u)}>
                {NOMBRES[u]}
              </Boton>
            ))}
          </div>
          <div className="text-sm font-semibold text-slate-500">2. Escriba el peso</div>
          <div className="rounded-xl border-2 border-slate-300 p-2 text-right text-4xl font-bold">
            <span className="font-mono">{valor || '0'}</span> <span className="text-2xl text-slate-500">{CORTO[unidadManual]}</span>
          </div>
          <div className="h-6 text-center text-lg text-slate-600">
            {unidadManual !== unidadVenta && Number(valor) > 0 && (
              <>
                {valor} {CORTO[unidadManual]} = <b>{cantidad.toFixed(3)} {CORTO[unidadVenta]}</b>
              </>
            )}
          </div>
          {resumen}
        </div>
        {/* Derecha: teclado */}
        <NumPad
          key={unidadManual}
          valor={valor}
          onChange={setValor}
          decimales={unidadManual !== 'G'}
          onEnter={aceptar}
          textoEnter={cantidad > 0 ? `Agregar ${cantidad.toFixed(3)} ${CORTO[unidadVenta]}` : 'Agregar'}
        />
      </div>
    </Modal>
  );
}
