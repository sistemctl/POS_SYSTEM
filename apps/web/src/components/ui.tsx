import { ReactNode, useEffect } from 'react';
import { create } from 'zustand';

type Variante = 'primario' | 'secundario' | 'peligro' | 'alerta' | 'neutro' | 'info';

const estilos: Record<Variante, string> = {
  primario: 'bg-marca-600 text-white shadow-md shadow-marca-600/30 hover:brightness-105',
  secundario: 'bg-white text-slate-800 border border-slate-200 shadow-sm hover:bg-slate-50',
  peligro: 'bg-red-600 text-white shadow-md shadow-red-600/25 hover:brightness-105',
  alerta: 'bg-amber-500 text-white shadow-md shadow-amber-500/25 hover:brightness-105',
  neutro: 'bg-slate-800 text-white shadow-sm hover:bg-slate-700',
  info: 'bg-sky-600 text-white shadow-md shadow-sky-600/25 hover:brightness-105',
};

export function Boton({
  children,
  variante = 'secundario',
  className = '',
  atajo,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; atajo?: string }) {
  return (
    <button type="button" {...props} className={`btn-touch px-4 select-none ${estilos[variante]} ${className}`}>
      <span className="flex flex-col items-center justify-center leading-tight">
        {children}
        {atajo && <span className="text-[11px] font-normal opacity-70">{atajo}</span>}
      </span>
    </button>
  );
}

export function Modal({
  titulo,
  children,
  onCerrar,
  ancho = 'max-w-2xl',
  alto,
}: {
  titulo: string;
  children: ReactNode;
  onCerrar?: () => void;
  ancho?: string;
  /**
   * Altura fija (ej. 'h-[95vh]'). Úsela cuando el contenido cambia de tamaño (búsquedas):
   * así la ventana no salta de lugar. El contenido queda en columna y debe tener su propia zona con scroll.
   */
  alto?: string;
}) {
  useEffect(() => {
    if (!onCerrar) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCerrar]);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className={`w-full ${ancho} ${alto ?? 'max-h-[95vh]'} flex flex-col rounded-2xl bg-white shadow-2xl`}>
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <h2 className="text-xl font-bold">{titulo}</h2>
          {onCerrar && (
            <button className="btn-touch text-3xl leading-none text-slate-500" onClick={onCerrar} aria-label="Cerrar">
              ×
            </button>
          )}
        </div>
        <div className={`flex-1 p-4 ${alto ? 'flex min-h-0 flex-col' : 'scroll-touch'}`}>{children}</div>
      </div>
    </div>
  );
}

/** Pregunta Sí / No con botones grandes (reemplaza la ventana gris del navegador). */
export function ConfirmarModal({
  titulo,
  mensaje,
  textoSi = 'Sí',
  textoNo = 'No, volver',
  peligro = true,
  onSi,
  onNo,
}: {
  titulo: string;
  mensaje?: ReactNode;
  textoSi?: string;
  textoNo?: string;
  peligro?: boolean;
  onSi: () => void;
  onNo: () => void;
}) {
  return (
    <Modal titulo={titulo} onCerrar={onNo} ancho="max-w-lg">
      {mensaje && <div className="mb-5 text-xl text-slate-700">{mensaje}</div>}
      <div className="grid grid-cols-2 gap-3">
        <Boton className="h-20 text-xl" onClick={onNo}>
          {textoNo}
        </Boton>
        <Boton variante={peligro ? 'peligro' : 'primario'} className="h-20 text-xl" onClick={onSi}>
          {textoSi}
        </Boton>
      </div>
    </Modal>
  );
}

/** Teclado numérico táctil grande */
export function NumPad({
  valor,
  onChange,
  onEnter,
  decimales = true,
  maxLen = 12,
  textoEnter = 'Aceptar',
}: {
  valor: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  decimales?: boolean;
  maxLen?: number;
  textoEnter?: React.ReactNode;
}) {
  const tecla = (k: string) => {
    if (k === '⌫') return onChange(valor.slice(0, -1));
    if (k === 'C') return onChange('');
    if (k === '.') {
      if (!decimales || valor.includes('.')) return;
      return onChange((valor || '0') + '.');
    }
    if (valor.length >= maxLen) return;
    if (valor.includes('.') && valor.split('.')[1].length >= 3) return;
    onChange(valor === '0' ? k : valor + k);
  };
  const teclas = ['7', '8', '9', '4', '5', '6', '1', '2', '3', decimales ? '.' : 'C', '0', '⌫'];
  return (
    <div className="grid grid-cols-3 gap-2">
      {teclas.map((k) => (
        <button key={k} type="button" onClick={() => tecla(k)} className="btn-touch h-[clamp(2.75rem,7.5vh,4rem)] bg-slate-100 text-2xl text-slate-800 border border-slate-300">
          {k}
        </button>
      ))}
      {onEnter && (
        <button type="button" onClick={onEnter} className="btn-touch col-span-3 h-[clamp(2.75rem,7.5vh,4rem)] bg-marca-600 text-xl text-white">
          {textoEnter}
        </button>
      )}
    </div>
  );
}

// ───── Notificaciones ─────
interface Toast {
  id: number;
  texto: string;
  tipo: 'ok' | 'error' | 'info';
}
export const useToasts = create<{ items: Toast[]; push: (t: Omit<Toast, 'id'>) => void }>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { ...t, id }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((x) => x.id !== id) })), t.tipo === 'error' ? 6000 : 3000);
  },
}));
export const toast = {
  ok: (texto: string) => useToasts.getState().push({ texto, tipo: 'ok' }),
  error: (texto: string) => {
    useToasts.getState().push({ texto, tipo: 'error' });
    // Todo error que ve el cajero queda registrado en el servidor para poder diagnosticarlo
    import('../lib/logs').then((m) => m.reportarError(texto, undefined, 'warn')).catch(() => undefined);
  },
  info: (texto: string) => useToasts.getState().push({ texto, tipo: 'info' }),
};

export function Toasts() {
  const items = useToasts((s) => s.items);
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-96 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`rounded-xl px-4 py-3 text-lg font-semibold text-white shadow-lg ${
            t.tipo === 'ok' ? 'bg-marca-600' : t.tipo === 'error' ? 'bg-red-600' : 'bg-slate-700'
          }`}
        >
          {t.texto}
        </div>
      ))}
    </div>
  );
}

export function Campo({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-slate-600">{etiqueta}</span>
      {children}
    </label>
  );
}

export const inputCls = 'h-12 rounded-lg border-2 border-slate-300 px-3 text-lg focus:border-marca-500 focus:outline-none';
