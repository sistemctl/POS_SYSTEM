import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { guardarConfig, leerConfig } from '../lib/config';
import { Boton, Campo, inputCls, toast } from '../components/ui';
import { TecladoVirtual } from '../components/TecladoVirtual';
import { bridge, extraerHardware, type ConfigHardware, type HardwareCaja } from '../lib/hardware';
import { HardwareCampos } from '../components/HardwareCampos';
import { hardwareAdministrado, iniciarHardwareRemoto, onHardwareAdministrado, sincronizarHardware } from '../lib/hardwareRemoto';

interface Health {
  ok: boolean;
  modo: 'central' | 'store';
  sucursalId: string | null;
  version: string;
}
interface Caja {
  id: string;
  nombre: string;
  codigo: string;
  sucursalId: string;
}

const HW_DEFECTO: ConfigHardware = {
  impresora: { tipo: 'windows', ancho: 80, abrirCajon: true },
  balanza: { driver: 'ninguna', baudios: 9600 },
  escaner: { driver: 'ninguno', puerto: 'auto', baudios: 9600 },
  visorCliente: false,
  kiosco: false,
};

/** Configuración inicial del equipo: servidor, caja asignada y hardware. */
export default function Configuracion() {
  const nav = useNavigate();
  const cfg = leerConfig();
  const [servidor, setServidor] = useState(cfg.servidor);
  const [moneda, setMoneda] = useState(cfg.moneda);
  const [health, setHealth] = useState<Health | null>(null);
  const [cajas, setCajas] = useState<Caja[]>([]);
  const [cajaId, setCajaId] = useState<string | null>(cfg.cajaId);
  const [teclado, setTeclado] = useState(false);
  const [hw, setHw] = useState<ConfigHardware>(HW_DEFECTO);
  const [impresoras, setImpresoras] = useState<{ name: string }[]>([]);
  const [puertos, setPuertos] = useState<{ path: string; manufacturer?: string }[]>([]);
  const [administrado, setAdministrado] = useState<HardwareCaja | null>(hardwareAdministrado());
  const b = bridge();

  useEffect(() => {
    if (!b) return;
    b.config.get().then((c) => setHw({ ...HW_DEFECTO, ...c }));
    b.printer.list().then(setImpresoras).catch(() => undefined);
    b.scale.listPorts().then(setPuertos).catch(() => undefined);
    const quitar = onHardwareAdministrado(setAdministrado);
    if (cfg.cajaId) sincronizarHardware().catch(() => undefined);
    return quitar;
  }, []);

  const probar = async () => {
    try {
      const url = servidor.replace(/\/$/, '');
      const h: Health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
      setHealth(h);
      const cs: Caja[] = await fetch(`${url}/api/cajas`).then((r) => r.json());
      setCajas(h.sucursalId ? cs.filter((c) => c.sucursalId === h.sucursalId) : []);
      toast.ok(`Conectado: servidor ${h.modo === 'central' ? 'CENTRAL' : 'de TIENDA'}`);
    } catch {
      setHealth(null);
      toast.error('No se pudo conectar con el servidor');
    }
  };

  useEffect(() => {
    probar();
  }, []);

  const guardar = async () => {
    const caja = cajas.find((c) => c.id === cajaId) ?? null;
    guardarConfig({
      servidor: servidor.replace(/\/$/, ''),
      cajaId: caja?.id ?? null,
      cajaNombre: caja?.nombre ?? null,
      sucursalId: health?.sucursalId ?? null,
      moneda,
    });
    // Si la caja se administra desde la web, no pisar ese hardware con el formulario local
    if (b) await b.config.set({ ...hw, ...(administrado ?? {}), servidor: servidor.replace(/\/$/, '') });
    if (caja) iniciarHardwareRemoto();
    toast.ok('Configuración guardada');
    nav(caja ? '/login' : '/admin-login');
  };

  return (
    <div className="scroll-touch h-full p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <h1 className="text-3xl font-bold">Configuración del equipo</h1>

        <section className="space-y-3 rounded-2xl bg-white p-5 shadow">
          <h2 className="text-xl font-bold">Servidor</h2>
          <p className="text-slate-600">
            Las cajas se conectan al <b>servidor de la tienda</b> (por red local). Los equipos de administración pueden
            conectarse al <b>servidor central</b>.
          </p>
          <div className="flex gap-2">
            <input className={`${inputCls} flex-1`} value={servidor} onChange={(e) => setServidor(e.target.value)} onFocus={() => setTeclado(true)} placeholder="http://192.168.1.10:3001" />
            <Boton variante="info" onClick={probar}>
              Probar conexión
            </Boton>
          </div>
          {teclado && <TecladoVirtual valor={servidor} onChange={setServidor} onEnter={() => { setTeclado(false); probar(); }} />}
          {health && (
            <div className="rounded-xl bg-marca-50 p-3">
              Servidor <b>{health.modo === 'central' ? 'CENTRAL' : 'DE TIENDA'}</b> · versión {health.version} · BD{' '}
              {health.ok ? 'OK' : 'con error'}
            </div>
          )}
        </section>

        <section className="space-y-3 rounded-2xl bg-white p-5 shadow">
          <h2 className="text-xl font-bold">Caja de este equipo</h2>
          {!health?.sucursalId ? (
            <p className="text-slate-600">Este servidor no tiene sucursal: el equipo se usará solo para administración.</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <Boton variante={cajaId === null ? 'neutro' : 'secundario'} className="h-20" onClick={() => setCajaId(null)}>
                Solo administración
              </Boton>
              {cajas.map((c) => (
                <Boton key={c.id} variante={cajaId === c.id ? 'primario' : 'secundario'} className="h-20 text-xl" onClick={() => setCajaId(c.id)}>
                  {c.nombre}
                </Boton>
              ))}
            </div>
          )}
          <Campo etiqueta="Símbolo de moneda">
            <input className={`${inputCls} w-32`} value={moneda} onChange={(e) => setMoneda(e.target.value)} />
          </Campo>
        </section>

        {b && (
          <section className="space-y-4 rounded-2xl bg-white p-5 shadow">
            <h2 className="text-xl font-bold">Hardware</h2>
            {administrado && (
              <div className="rounded-xl border-2 border-sky-300 bg-sky-50 p-3 text-sky-900">
                La impresora, la balanza y el escáner de esta caja se configuran desde la web:{' '}
                <b>Administración → Sucursales y cajas → {cfg.cajaNombre ?? 'esta caja'}</b>. Los cambios llegan solos en
                unos 2 minutos (o al reiniciar la caja).
              </div>
            )}
            <HardwareCampos
              hw={administrado ?? extraerHardware(hw)}
              onChange={(h) => setHw({ ...hw, ...h })}
              impresoras={impresoras.map((i) => i.name)}
              puertos={puertos}
              deshabilitado={!!administrado}
            />
            <div className="grid grid-cols-2 gap-4">
              <label className="flex items-center gap-3 text-lg">
                <input type="checkbox" className="h-7 w-7" checked={hw.kiosco} onChange={(e) => setHw({ ...hw, kiosco: e.target.checked })} />
                Modo kiosco (pantalla completa bloqueada)
              </label>
            </div>
            <div className="flex gap-2">
              <Boton onClick={() => b.printer.printText('Prueba de impresora POS\n\n')}>Imprimir prueba</Boton>
              <Boton onClick={() => b.drawer.open()}>Abrir cajón</Boton>
              <Boton
                onClick={async () => {
                  try {
                    await b.config.set({ ...hw, ...(administrado ?? {}) });
                    const r = await b.scale.read();
                    toast.info(`Peso: ${r.peso.toFixed(3)} kg ${r.estable ? '(estable)' : ''}`);
                  } catch (e: any) {
                    toast.error(e.message);
                  }
                }}
              >
                Leer balanza
              </Boton>
            </div>
          </section>
        )}

        <div className="flex justify-end gap-3">
          <Boton variante="primario" className="w-64 text-xl" onClick={guardar} disabled={!health}>
            Guardar
          </Boton>
        </div>
      </div>
    </div>
  );
}
