import { useEffect, useRef } from 'react';

/**
 * Atajos de teclado de la caja (además del uso táctil).
 * Mapa centralizado: ver src/pos/shortcuts.ts
 */
export function useShortcuts(mapa: Record<string, () => void>, activo = true) {
  const ref = useRef(mapa);
  ref.current = mapa;
  useEffect(() => {
    if (!activo) return;
    const h = (e: KeyboardEvent) => {
      const fn = ref.current[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [activo]);
}
