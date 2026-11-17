import { useMemo, useState } from 'react';
import type { ProductoCaja } from '@pos/shared';
import { useCatalogo } from '../store/catalogo';
import { dinero } from '../lib/config';
import { Modal } from '../components/ui';
import { TecladoVirtual } from '../components/TecladoVirtual';

export function BuscarModal({ onElegir, onCerrar }: { onElegir: (p: ProductoCaja) => void; onCerrar: () => void }) {
  const buscar = useCatalogo((s) => s.buscar);
  const [texto, setTexto] = useState('');
  const resultados = useMemo(() => buscar(texto, 40), [texto, buscar]);

  return (
    <Modal titulo="Buscar producto" onCerrar={onCerrar} ancho="max-w-5xl">
      <input
        autoFocus
        className="mb-3 h-14 w-full rounded-xl border-2 border-slate-300 px-4 text-2xl"
        placeholder="Nombre, código o SKU"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && resultados[0] && onElegir(resultados[0])}
      />
      <div className="scroll-touch mb-3 grid max-h-[38vh] grid-cols-3 gap-2">
        {resultados.map((p) => (
          <button key={p.id} onClick={() => onElegir(p)} className="btn-touch flex flex-col items-start bg-slate-100 p-3 text-left">
            <span className="text-lg">{p.nombre}</span>
            <span className="text-sm font-normal text-slate-500">
              {dinero(p.precio)}
              {p.pesable ? ' / kg' : ''} · {p.sku}
            </span>
          </button>
        ))}
        {texto && !resultados.length && <div className="col-span-3 p-4 text-slate-500">Sin resultados</div>}
      </div>
      <TecladoVirtual valor={texto} onChange={setTexto} onEnter={() => resultados[0] && onElegir(resultados[0])} />
    </Modal>
  );
}
