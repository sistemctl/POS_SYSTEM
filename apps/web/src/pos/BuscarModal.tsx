import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProductoCaja } from '@pos/shared';
import { useCatalogo } from '../store/catalogo';
import { dinero } from '../lib/config';
import { Modal } from '../components/ui';
import { TecladoVirtual } from '../components/TecladoVirtual';

export function BuscarModal({
  onElegir,
  onCerrar,
  aviso,
}: {
  onElegir: (p: ProductoCaja) => void;
  onCerrar: () => void;
  /** Mensaje arriba de la búsqueda, ej. cuando el lector no encontró un código */
  aviso?: string;
}) {
  const buscar = useCatalogo((s) => s.buscar);
  const [texto, setTexto] = useState('');
  const resultados = useMemo(() => buscar(texto, 40), [texto, buscar]);
  // Cada búsqueda nueva empieza mostrando el primer resultado
  const lista = useRef<HTMLDivElement>(null);
  useEffect(() => {
    lista.current?.scrollTo({ top: 0 });
  }, [texto]);

  return (
    // Altura fija: el campo queda arriba y el teclado abajo aunque cambie la cantidad de resultados
    <Modal titulo="Buscar producto" onCerrar={onCerrar} ancho="max-w-5xl" alto="h-[95vh]">
      {aviso && <div className="mb-3 shrink-0 rounded-xl bg-amber-100 p-3 text-lg font-semibold text-amber-900">{aviso}</div>}
      <input
        autoFocus
        className="mb-3 h-14 w-full shrink-0 rounded-xl border-2 border-slate-300 px-4 text-2xl"
        placeholder="Escriba parte del nombre (ej. arroz) o el código"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && resultados[0] && onElegir(resultados[0])}
      />
      {/* Solo esta zona cambia y se desplaza; ocupa todo el espacio libre entre el campo y el teclado */}
      <div ref={lista} className="scroll-touch mb-3 grid min-h-0 flex-1 auto-rows-min grid-cols-3 content-start gap-2 [scrollbar-gutter:stable]">
        {resultados.map((p) => (
          <button key={p.id} onClick={() => onElegir(p)} className="btn-touch flex flex-col items-start bg-slate-100 p-3 text-left">
            <span className="text-lg">{p.nombre}</span>
            <span className="text-sm font-normal text-slate-500">
              {dinero(p.precio)}
              {p.pesable ? ' / kg' : ''} · {p.sku}
            </span>
          </button>
        ))}
        {texto && !resultados.length && (
          <div className="col-span-3 p-4 text-lg text-slate-500">
            No hay productos con «{texto}». Pruebe con menos letras o llame al supervisor.
          </div>
        )}
        {!texto && <div className="col-span-3 p-4 text-slate-500">Toque el producto para agregarlo a la venta.</div>}
      </div>
      <div className="shrink-0">
        <TecladoVirtual valor={texto} onChange={setTexto} onEnter={() => resultados[0] && onElegir(resultados[0])} />
      </div>
    </Modal>
  );
}
