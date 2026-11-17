import { useState } from 'react';
import { post } from '../lib/api';
import { dinero } from '../lib/config';
import { useSesion, type Turno } from '../store/sesion';
import { Boton, NumPad, toast } from '../components/ui';

export default function AbrirTurno() {
  const usuario = useSesion((s) => s.usuario);
  const setTurno = useSesion((s) => s.setTurno);
  const cerrarSesion = useSesion((s) => s.cerrarSesion);
  const [monto, setMonto] = useState('');

  const abrir = async () => {
    try {
      const t = await post<Turno>('/turnos/abrir', { montoInicial: monto || '0' });
      setTurno(t);
      toast.ok('Turno abierto');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-[420px] rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold">Abrir turno</h1>
        <p className="mb-4 text-slate-600">
          {usuario?.nombre}, ingrese el efectivo inicial (fondo de caja).
        </p>
        <div className="mb-4 rounded-xl border-2 border-slate-300 p-3 text-right text-4xl font-bold">{dinero(monto || 0)}</div>
        <NumPad valor={monto} onChange={setMonto} onEnter={abrir} />
        <Boton className="mt-3 w-full" onClick={() => cerrarSesion()}>
          Cerrar sesión
        </Boton>
      </div>
    </div>
  );
}
