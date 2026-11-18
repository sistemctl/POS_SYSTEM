import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginResponse, UsuarioCaja } from '@pos/shared';
import { ApiError, get, post } from '../lib/api';
import { leerConfig } from '../lib/config';
import { useSesion } from '../store/sesion';
import { Boton, NumPad } from '../components/ui';
import { EstadoConexion } from '../components/EstadoConexion';

function iniciales(nombre: string) {
  return nombre
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase();
}

/** Inicio de sesión táctil: el cajero toca su nombre y escribe su PIN. Funciona sin internet. */
export default function LoginCaja() {
  const nav = useNavigate();
  const cfg = leerConfig();
  const iniciar = useSesion((s) => s.iniciar);
  const mensaje = useSesion((s) => s.mensaje);
  const [usuarios, setUsuarios] = useState<UsuarioCaja[]>([]);
  const [elegido, setElegido] = useState<UsuarioCaja | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(mensaje);
  const [cargando, setCargando] = useState(false);
  /** Error al traer la lista de usuarios (p. ej. el servidor todavía está arrancando); se reintenta solo */
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  useEffect(() => {
    if (!cfg.cajaId) {
      nav('/config');
      return;
    }
    // Reintenta cada 3 s mientras el servidor no responda (arranque de Windows, corte de red);
    // ya conectado, refresca la lista cada minuto.
    let vivo = true;
    let t: number | undefined;
    const cargar = async () => {
      try {
        const u = await get<UsuarioCaja[]>('/auth/usuarios-caja');
        if (!vivo) return;
        setUsuarios(u);
        setErrorCarga(null);
        t = window.setTimeout(cargar, 60_000);
      } catch (e: any) {
        if (!vivo) return;
        setErrorCarga(
          e instanceof ApiError && e.sinConexion ? 'Conectando con el servidor de la tienda… (reintentando)' : e.message,
        );
        t = window.setTimeout(cargar, 3_000);
      }
    };
    cargar();
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
  }, []);

  const entrar = async () => {
    if (!elegido || pin.length < 4) return;
    setCargando(true);
    setError(null);
    try {
      const r = await post<LoginResponse>('/auth/login-pin', { usuarioId: elegido.id, pin, cajaId: cfg.cajaId });
      iniciar(r.token, r.usuario);
      nav('/venta');
    } catch (e: any) {
      setError(e.message);
      setPin('');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (pin.length === 6) entrar();
  }, [pin]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between bg-marca-800 px-6 py-3 text-white">
        <div className="text-2xl font-bold">{cfg.cajaNombre ?? 'Caja'}</div>
        <div className="flex items-center gap-3">
          <EstadoConexion />
          <Boton variante="neutro" className="h-12 min-h-0" onClick={() => nav('/admin-login')}>
            Administración
          </Boton>
          <Boton variante="neutro" className="h-12 min-h-0" onClick={() => nav('/config')}>
            ⚙
          </Boton>
        </div>
      </header>

      <div className="flex flex-1 gap-6 overflow-hidden p-6">
        <div className="scroll-touch flex-1">
          <h1 className="mb-1 text-2xl font-bold text-slate-700">1. Toque su nombre</h1>
          <p className="mb-4 text-lg text-slate-500">2. Escriba su clave (PIN) en el teclado de la derecha</p>
          <div className="grid grid-cols-3 gap-4 xl:grid-cols-4">
            {usuarios.map((u) => (
              <button
                key={u.id}
                onClick={() => {
                  setElegido(u);
                  setPin('');
                  setError(null);
                }}
                className={`btn-touch flex h-36 flex-col items-center justify-center gap-2 border-4 bg-white shadow ${
                  elegido?.id === u.id ? 'border-marca-500' : 'border-transparent'
                }`}
              >
                {u.foto ? (
                  <img src={u.foto} className="h-16 w-16 rounded-full object-cover" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-marca-100 text-2xl font-bold text-marca-700">
                    {iniciales(u.nombre)}
                  </div>
                )}
                <div className="text-lg">{u.nombre}</div>
                <div className="text-xs font-normal text-slate-500">{u.roles.join(', ')}</div>
              </button>
            ))}
          </div>
          {errorCarga && (
            <div className="mb-4 rounded-xl bg-amber-100 p-4 text-lg font-semibold text-amber-800">{errorCarga}</div>
          )}
          {!usuarios.length && !errorCarga && <div className="text-slate-500">Cargando usuarios…</div>}
        </div>

        <div className="w-[360px] shrink-0 rounded-2xl bg-white p-5 shadow">
          <div className="mb-2 text-center text-xl">{elegido ? `${elegido.nombre}: escriba su PIN` : '← Primero toque su nombre'}</div>
          <div className="mb-4 h-16 rounded-xl border-2 border-slate-300 text-center text-5xl leading-[3.5rem] tracking-[0.5em]">
            {'•'.repeat(pin.length)}
          </div>
          <NumPad valor={pin} onChange={(v) => elegido && setPin(v)} decimales={false} maxLen={6} onEnter={entrar} />
          {cargando && <div className="mt-3 text-center">Verificando…</div>}
          {error && <div className="mt-3 rounded-xl bg-red-100 p-3 text-center font-semibold text-red-700">{error}</div>}
        </div>
      </div>
    </div>
  );
}
