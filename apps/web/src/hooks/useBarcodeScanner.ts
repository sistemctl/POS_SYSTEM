import { useEffect, useRef } from 'react';

/**
 * Detecta lectores de código de barras en modo teclado (HID): ráfaga de caracteres
 * muy rápidos terminada en Enter. Funciona igual en navegador y Electron, en paralelo al uso táctil.
 */
export function useBarcodeScanner(onScan: (codigo: string) => void, activo = true) {
  const buffer = useRef('');
  const ultimo = useRef(0);
  const intervalos = useRef<number[]>([]);
  const cb = useRef(onScan);
  cb.current = onScan;

  useEffect(() => {
    if (!activo) return;
    const handler = (e: KeyboardEvent) => {
      const ahora = performance.now();
      const delta = ahora - ultimo.current;
      ultimo.current = ahora;

      if (e.key === 'Enter') {
        const codigo = buffer.current;
        const promedio = intervalos.current.length
          ? intervalos.current.reduce((a, b) => a + b, 0) / intervalos.current.length
          : Infinity;
        buffer.current = '';
        intervalos.current = [];
        if (codigo.length >= 4 && promedio < 40) {
          e.preventDefault();
          e.stopPropagation();
          // Si el código se escribió en un input, limpiarlo
          const t = e.target as HTMLInputElement;
          if (t?.tagName === 'INPUT' && t.value.endsWith(codigo)) {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(t, t.value.slice(0, -codigo.length));
            t.dispatchEvent(new Event('input', { bubbles: true }));
          }
          cb.current(codigo);
        }
        return;
      }
      if (e.key.length !== 1) return;
      if (delta > 80) {
        buffer.current = '';
        intervalos.current = [];
      } else {
        intervalos.current.push(delta);
      }
      buffer.current += e.key;
    };
    window.addEventListener('keydown', handler, true);
    // Escáneres por puerto serie / USB-COM (Datalogic Magellan, etc.): llegan por el puente de Electron
    const quitarSerie = window.pos?.scanner?.onCode((codigo) => cb.current(codigo));
    return () => {
      window.removeEventListener('keydown', handler, true);
      quitarSerie?.();
    };
  }, [activo]);
}
