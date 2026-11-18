import { useState } from 'react';
import { post } from '../lib/api';
import { dinero } from '../lib/config';
import { useParametros } from '../store/parametros';
import { useSesion, type Turno } from '../store/sesion';
import { Boton, NumPad, toast } from '../components/ui';

export default function AbrirTurno() {
  const usuario = useSesion((s) => s.usuario);
  const setTurno = useSesion((s) => s.setTurno);
  const cerrarSesion = useSesion((s) => s.cerrarSesion);
  const [monto, setMonto] = useState('');
  const decimales = useParametros((s) => s.p.regional.decimales);

  const abrir = async (valor = monto) => {
    try {
      const t = await post<Turno>('/turnos/abrir', { montoInicial: valor || '0' });
      setTurno(t);
      toast.ok('Turno abierto');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-4">
      <div className="grid w-[820px] grid-cols-2 gap-6 rounded-2xl bg-white p-6 shadow">
        <div className="flex flex-col gap-4">
          <h1 className="text-2xl font-bold">Hola, {usuario?.nombre}</h1>
          <p className="text-lg text-slate-600">
            Cuente el dinero con el que empieza la caja (<b>base de caja</b>), escríbalo y toque <b>Aceptar</b>.
          </p>
          <div className="rounded-xl border-2 border-slate-300 p-3 text-right text-4xl font-bold">{dinero(monto || 0)}</div>
          <Boton className="w-full" onClick={() => abrir('0')}>
            Empezar sin base ({dinero(0)})
          </Boton>
          <Boton className="w-full" onClick={() => cerrarSesion()}>
            Cerrar sesión
          </Boton>
        </div>
        <NumPad valor={monto} onChange={setMonto} decimales={decimales > 0} onEnter={() => abrir()} />
      </div>
    </div>
  );
}
