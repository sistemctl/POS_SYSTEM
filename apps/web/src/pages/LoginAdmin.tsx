import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginResponse } from '@pos/shared';
import { post } from '../lib/api';
import { leerConfig } from '../lib/config';
import { useSesion } from '../store/sesion';
import { Boton, Campo, inputCls } from '../components/ui';
import { TecladoVirtual } from '../components/TecladoVirtual';

export default function LoginAdmin() {
  const nav = useNavigate();
  const iniciar = useSesion((s) => s.iniciar);
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [foco, setFoco] = useState<'usuario' | 'password' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const entrar = async () => {
    setError(null);
    try {
      const r = await post<LoginResponse>('/auth/login', { usuario, password });
      iniciar(r.token, r.usuario);
      nav('/admin');
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
      <form
        className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6 shadow"
        onSubmit={(e) => {
          e.preventDefault();
          entrar();
        }}
      >
        <h1 className="text-2xl font-bold">Administración</h1>
        <div className="text-sm text-slate-500">Servidor: {leerConfig().servidor}</div>
        <Campo etiqueta="Usuario">
          <input className={inputCls} value={usuario} onChange={(e) => setUsuario(e.target.value)} onFocus={() => setFoco('usuario')} autoFocus />
        </Campo>
        <Campo etiqueta="Contraseña">
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} onFocus={() => setFoco('password')} />
        </Campo>
        {error && <div className="rounded-lg bg-red-100 p-3 font-semibold text-red-700">{error}</div>}
        <div className="flex gap-2">
          <Boton type="submit" variante="primario" className="flex-1">
            Entrar
          </Boton>
          {leerConfig().cajaId && (
            <Boton onClick={() => nav('/login')}>Volver a caja</Boton>
          )}
          <Boton onClick={() => nav('/config')}>⚙</Boton>
        </div>
      </form>
      {foco && (
        <div className="w-full max-w-4xl">
          <TecladoVirtual
            valor={foco === 'usuario' ? usuario : password}
            onChange={foco === 'usuario' ? setUsuario : setPassword}
            onEnter={() => (foco === 'usuario' ? setFoco('password') : entrar())}
          />
        </div>
      )}
    </div>
  );
}
