import { useEffect, useState } from 'react';
import { dinero } from '../lib/config';

interface EstadoVisor {
  lineas: { nombre: string; cantidad: string; total: string }[];
  total: string;
  ahorro: string;
  moneda: string;
  vuelto: string | null;
}

declare global {
  interface Window {
    visor?: { onUpdate(cb: (e: EstadoVisor) => void): void };
  }
}

/** Pantalla para el segundo monitor (visor de cliente). Electron la abre en una segunda ventana. */
export default function VisorCliente() {
  const [e, setE] = useState<EstadoVisor | null>(null);
  useEffect(() => {
    window.visor?.onUpdate(setE);
  }, []);
  const m = e?.moneda ?? '$';
  return (
    <div className="flex h-full flex-col bg-slate-900 p-8 text-white">
      <div className="mb-4 text-3xl font-bold text-marca-500">¡Bienvenido!</div>
      <div className="flex-1 overflow-hidden">
        {e?.lineas.slice(-12).map((l, i) => (
          <div key={i} className="flex justify-between border-b border-slate-700 py-2 text-2xl">
            <span>
              {l.cantidad} × {l.nombre}
            </span>
            <span>{dinero(l.total, m)}</span>
          </div>
        ))}
      </div>
      {e && Number(e.ahorro) > 0 && <div className="text-right text-2xl text-marca-500">Usted ahorra {dinero(e.ahorro, m)}</div>}
      {e?.vuelto && !e.lineas.length ? (
        <div className="text-right">
          <div className="text-3xl">Su cambio</div>
          <div className="text-8xl font-extrabold text-marca-500">{dinero(e.vuelto, m)}</div>
        </div>
      ) : (
        <div className="text-right">
          <div className="text-3xl">Total</div>
          <div className="text-8xl font-extrabold">{dinero(e?.total ?? 0, m)}</div>
        </div>
      )}
    </div>
  );
}
