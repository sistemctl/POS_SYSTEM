import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { PERMISO_DESCRIPCION, type Permiso, type UsuarioCaja } from '@pos/shared';
import { ApiError, get, post } from '../lib/api';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useSesion } from '../store/sesion';
import { Boton, Modal, NumPad } from './ui';

export interface ResultadoAutorizacion {
  autorizacionId: string;
  supervisor: { id: string; nombre: string };
  descuentoMaximo: number;
  retiroMaximo: number;
}

interface Solicitud {
  permiso: Permiso;
  motivo?: string;
  consumir?: boolean;
  detalle?: unknown;
  resolve: (r: ResultadoAutorizacion | null) => void;
}

const useSolicitud = create<{ actual: Solicitud | null; set: (s: Solicitud | null) => void }>((set) => ({
  actual: null,
  set: (actual) => set({ actual }),
}));

/** Abre el modal táctil para que un supervisor autorice con su PIN o tarjeta. */
export function solicitarAutorizacion(
  permiso: Permiso,
  opts: { motivo?: string; consumir?: boolean; detalle?: unknown } = {},
): Promise<ResultadoAutorizacion | null> {
  return new Promise((resolve) => useSolicitud.getState().set({ permiso, ...opts, resolve }));
}

/**
 * Ejecuta una acción; si la API responde que requiere autorización de supervisor,
 * la solicita y reintenta con el id de autorización.
 */
export async function conAutorizacion<T>(fn: (ids: string[]) => Promise<T>, idsIniciales: string[] = []): Promise<T | null> {
  const ids = [...idsIniciales];
  for (let i = 0; i < 4; i++) {
    try {
      return await fn(ids);
    } catch (e) {
      if (e instanceof ApiError && e.requiereAutorizacion) {
        const r = await solicitarAutorizacion(e.requiereAutorizacion);
        if (!r) return null;
        ids.push(r.autorizacionId);
        continue;
      }
      throw e;
    }
  }
  return null;
}

export function AutorizacionModal() {
  const solicitud = useSolicitud((s) => s.actual);
  const cerrar = useSolicitud((s) => s.set);
  const yo = useSesion((s) => s.usuario);
  const [usuarios, setUsuarios] = useState<UsuarioCaja[]>([]);
  const [elegido, setElegido] = useState<UsuarioCaja | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!solicitud) return;
    setElegido(null);
    setPin('');
    setError(null);
    get<UsuarioCaja[]>('/auth/usuarios-caja')
      .then((u) => setUsuarios(u.filter((x) => x.id !== yo?.id && x.roles.some((r) => r !== 'Cajero'))))
      .catch(() => setUsuarios([]));
  }, [solicitud, yo?.id]);

  const enviar = async (datos: { supervisorId?: string; pin?: string; codigoTarjeta?: string }) => {
    if (!solicitud) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await post<ResultadoAutorizacion>('/auth/autorizar', {
        ...datos,
        permiso: solicitud.permiso,
        motivo: solicitud.motivo,
        consumir: solicitud.consumir,
        detalle: solicitud.detalle,
      });
      solicitud.resolve(r);
      cerrar(null);
    } catch (e: any) {
      setError(e.message);
      setPin('');
    } finally {
      setEnviando(false);
    }
  };

  // Tarjeta/carnet de supervisor escaneado
  useBarcodeScanner((codigo) => enviar({ codigoTarjeta: codigo }), !!solicitud);

  if (!solicitud) return null;
  const cancelar = () => {
    solicitud.resolve(null);
    cerrar(null);
  };

  return (
    <Modal titulo="Autorización de supervisor" onCerrar={cancelar} ancho="max-w-3xl">
      <div className="mb-4 rounded-xl bg-amber-50 p-4 text-lg">
        <b>Acción:</b> {PERMISO_DESCRIPCION[solicitud.permiso] ?? solicitud.permiso}
        {solicitud.motivo && <div className="text-base text-slate-600">{solicitud.motivo}</div>}
        <div className="mt-1 text-sm text-slate-500">También puede escanear la tarjeta del supervisor.</div>
      </div>
      {!elegido ? (
        <div className="grid grid-cols-3 gap-3">
          {usuarios.map((u) => (
            <Boton key={u.id} className="h-24 text-lg" onClick={() => setElegido(u)}>
              {u.nombre}
              <span className="text-xs font-normal text-slate-500">{u.roles.join(', ')}</span>
            </Boton>
          ))}
          {!usuarios.length && <div className="col-span-3 text-slate-500">No hay supervisores disponibles.</div>}
        </div>
      ) : (
        <div className="grid grid-cols-2 items-start gap-5">
          <div className="flex flex-col gap-3">
            <div className="text-center text-lg">
              PIN de <b>{elegido.nombre}</b>
            </div>
            <div className="h-14 rounded-xl border-2 border-slate-300 text-center text-4xl leading-[3.25rem] tracking-[0.5em]">
              {'•'.repeat(pin.length)}
            </div>
            <Boton className="w-full" onClick={() => setElegido(null)}>
              Elegir otro supervisor
            </Boton>
          </div>
          <NumPad
            valor={pin}
            onChange={setPin}
            decimales={false}
            maxLen={6}
            onEnter={() => pin.length >= 4 && !enviando && enviar({ supervisorId: elegido.id, pin })}
          />
        </div>
      )}
      {error && <div className="mt-4 rounded-xl bg-red-100 p-3 text-center text-lg font-semibold text-red-700">{error}</div>}
    </Modal>
  );
}
