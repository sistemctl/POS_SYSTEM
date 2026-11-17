import { useEffect, useState } from 'react';
import type { EstadoSincronizacion } from '@pos/shared';
import { ApiError, get, post } from '../lib/api';
import { toast } from './ui';

/**
 * Indicador de conexión:
 *  - Servidor de tienda (LAN): si cae, la caja no puede vender.
 *  - Central (internet): si cae, la tienda sigue vendiendo y las ventas quedan pendientes de subir.
 */
export function EstadoConexion() {
  const [servidor, setServidor] = useState(true);
  const [sync, setSync] = useState<EstadoSincronizacion | null>(null);

  useEffect(() => {
    let vivo = true;
    const revisar = async () => {
      try {
        const s = await get<EstadoSincronizacion>('/sync/estado');
        if (!vivo) return;
        setServidor(true);
        setSync(s);
      } catch (e) {
        // Solo es "sin servidor" si no hubo respuesta; un 401/403 significa que el servidor sí responde
        if (vivo) setServidor(!(e instanceof ApiError && e.sinConexion));
      }
    };
    revisar();
    const t = setInterval(revisar, 15_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, []);

  const forzar = async () => {
    try {
      const r = await post<{ ok: boolean; estado: EstadoSincronizacion }>('/sync/forzar');
      setSync(r.estado);
      r.ok ? toast.ok('Sincronizado con el central') : toast.error('Sin conexión con el central');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  if (!servidor) {
    return <span className="rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white">● Sin servidor de tienda</span>;
  }
  if (!sync || sync.modo === 'central') {
    return <span className="rounded-full bg-marca-600 px-3 py-1 text-sm font-bold text-white">● En línea</span>;
  }
  return (
    <button onClick={forzar} className={`rounded-full px-3 py-1 text-sm font-bold text-white ${sync.online ? 'bg-marca-600' : 'bg-amber-500'}`}>
      ● {sync.online ? 'En línea' : 'Sin internet (vendiendo local)'}
      {sync.ventasPendientes > 0 && ` · ${sync.ventasPendientes} por subir`}
    </button>
  );
}
