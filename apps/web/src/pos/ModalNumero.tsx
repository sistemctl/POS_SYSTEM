import { useState } from 'react';
import { Modal, NumPad } from '../components/ui';

/** Modal genérico para ingresar un número con el teclado táctil. */
export function ModalNumero({
  titulo,
  descripcion,
  inicial = '',
  sufijo,
  decimales = true,
  onAceptar,
  onCerrar,
}: {
  titulo: string;
  descripcion?: string;
  inicial?: string;
  sufijo?: string;
  decimales?: boolean;
  onAceptar: (v: string) => void;
  onCerrar: () => void;
}) {
  const [v, setV] = useState(inicial);
  return (
    <Modal titulo={titulo} onCerrar={onCerrar} ancho="max-w-md">
      {descripcion && <p className="mb-3 text-slate-600">{descripcion}</p>}
      <div className="mb-4 rounded-xl border-2 border-slate-300 p-3 text-right text-4xl font-bold">
        {v || '0'} {sufijo}
      </div>
      <NumPad valor={v} onChange={setV} decimales={decimales} onEnter={() => v && Number(v) >= 0 && onAceptar(v)} />
    </Modal>
  );
}
