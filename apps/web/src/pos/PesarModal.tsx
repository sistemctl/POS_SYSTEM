import { useEffect, useState } from 'react';
import type { ProductoCaja } from '@pos/shared';
import { bridge } from '../lib/hardware';
import { dinero } from '../lib/config';
import { Boton, Modal, NumPad } from '../components/ui';

/** Producto pesable: muestra el peso en vivo de la balanza o permite ingresarlo manualmente. */
export function PesarModal({
  producto,
  onAceptar,
  onCerrar,
}: {
  producto: ProductoCaja;
  onAceptar: (kg: number) => void;
  onCerrar: () => void;
}) {
  const b = bridge();
  const [peso, setPeso] = useState<{ peso: number; estable: boolean } | null>(null);
  const [manual, setManual] = useState(!b);
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

  const kg = manual ? Number(valor || 0) : peso?.peso ?? 0;
  const total = kg * Number(producto.precio);

  return (
    <Modal titulo={`Pesar: ${producto.nombre}`} onCerrar={onCerrar} ancho="max-w-xl">
      <div className="mb-4 grid grid-cols-2 gap-4 text-center">
        <div className="rounded-xl bg-slate-900 p-4 text-white">
          <div className="text-sm opacity-70">Peso</div>
          <div className="font-mono text-5xl">{kg.toFixed(3)}</div>
          <div className="text-sm">
            kg {!manual && peso && (peso.estable ? '· estable' : '· estabilizando…')}
          </div>
        </div>
        <div className="rounded-xl bg-marca-50 p-4">
          <div className="text-sm text-slate-500">{dinero(producto.precio)} / kg</div>
          <div className="text-4xl font-bold">{dinero(total)}</div>
        </div>
      </div>
      {error && !manual && <div className="mb-3 rounded-lg bg-red-100 p-3 text-red-700">Balanza: {error}</div>}
      {manual ? (
        <NumPad valor={valor} onChange={setValor} onEnter={() => kg > 0 && onAceptar(kg)} />
      ) : (
        <div className="flex gap-3">
          <Boton className="flex-1" onClick={() => setManual(true)}>
            Ingresar peso manual
          </Boton>
          <Boton variante="primario" className="flex-1 text-xl" disabled={!peso || peso.peso <= 0 || !peso.estable} onClick={() => onAceptar(kg)}>
            Confirmar peso
          </Boton>
        </div>
      )}
    </Modal>
  );
}
