import { useEffect, useState } from 'react';
import { get } from '../lib/api';
import { Boton, toast } from '../components/ui';
import { useModoServidor } from './AdminLayout';

interface Log {
  id: string;
  nivel: string;
  mensaje: string;
  detalle: string | null;
  pantalla: string | null;
  version: string | null;
  cajaId: string | null;
  equipo: string | null;
  creadoEn: string;
}

/** Errores que reportaron las cajas de esta tienda (sirve para diagnosticar problemas a distancia) */
export default function ErroresCaja() {
  const modo = useModoServidor();
  const [logs, setLogs] = useState<Log[]>([]);
  const [cajas, setCajas] = useState<Record<string, string>>({});
  const [abierto, setAbierto] = useState<string | null>(null);

  const cargar = () => get<Log[]>('/logs/cliente?limite=300').then(setLogs).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
    get('/cajas')
      .then((c: any[]) => setCajas(Object.fromEntries(c.map((x) => [x.id, x.nombre]))))
      .catch(() => undefined);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Errores de caja</h1>
        <Boton onClick={cargar}>Actualizar</Boton>
      </div>
      {modo === 'central' && (
        <div className="rounded-xl bg-sky-50 p-3 text-sky-800">
          Cada tienda guarda los errores de sus cajas. Para verlos, conecte la administración al servidor de esa tienda. El panel «Estado de sucursales»
          muestra cuántos hubo en las últimas 24 h.
        </div>
      )}
      <div className="overflow-hidden rounded-xl bg-white shadow">
        {logs.map((l) => (
          <div key={l.id} className="border-b">
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" onClick={() => setAbierto(abierto === l.id ? null : l.id)}>
              <span className={`rounded px-2 py-0.5 text-xs font-bold ${l.nivel === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                {l.nivel === 'error' ? 'ERROR' : 'AVISO'}
              </span>
              <span className="w-40 text-sm text-slate-500">{new Date(l.creadoEn).toLocaleString('es')}</span>
              <span className="w-28 truncate text-sm">{(l.cajaId && cajas[l.cajaId]) || l.equipo || '—'}</span>
              <span className="flex-1 truncate">{l.mensaje}</span>
            </button>
            {abierto === l.id && (
              <pre className="whitespace-pre-wrap bg-slate-50 px-4 py-3 text-xs">
                {`Pantalla: ${l.pantalla ?? '—'}   Versión: ${l.version ?? '—'}   Equipo: ${l.equipo ?? '—'}\n\n${l.mensaje}\n\n${l.detalle ?? ''}`}
              </pre>
            )}
          </div>
        ))}
        {!logs.length && <div className="p-6 text-center text-slate-400">Sin errores registrados.</div>}
      </div>
    </div>
  );
}
