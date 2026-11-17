import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { PERMISOS, type Permiso } from '@pos/shared';
import { get, urlMedia } from '../lib/api';
import { useParametros } from '../store/parametros';
import { AsistenteInicial } from './Sistema';
import { bridge } from '../lib/hardware';
import { leerConfig } from '../lib/config';
import { useSesion } from '../store/sesion';
import { Boton, toast } from '../components/ui';
import { EstadoConexion } from '../components/EstadoConexion';

const MENU: { ruta: string; texto: string; permiso: Permiso }[] = [
  { ruta: 'reportes', texto: 'Reportes', permiso: PERMISOS.REPORTE_SUCURSAL },
  { ruta: 'productos', texto: 'Productos', permiso: PERMISOS.PRODUCTO_VER },
  { ruta: 'promociones', texto: 'Promociones', permiso: PERMISOS.PRODUCTO_VER },
  { ruta: 'recibir', texto: 'Recibir mercancía', permiso: PERMISOS.COMPRA_REGISTRAR },
  { ruta: 'inventario', texto: 'Inventario', permiso: PERMISOS.INVENTARIO_VER },
  { ruta: 'turnos', texto: 'Turnos / Arqueos', permiso: PERMISOS.TURNO_VER_TODOS },
  { ruta: 'usuarios', texto: 'Usuarios', permiso: PERMISOS.USUARIO_GESTIONAR },
  { ruta: 'roles', texto: 'Roles y permisos', permiso: PERMISOS.USUARIO_GESTIONAR },
  { ruta: 'sucursales', texto: 'Sucursales y cajas', permiso: PERMISOS.SUCURSAL_GESTIONAR },
  { ruta: 'monitoreo', texto: 'Estado de sucursales', permiso: PERMISOS.MONITOREO_VER },
  { ruta: 'errores', texto: 'Errores de caja', permiso: PERMISOS.MONITOREO_VER },
  { ruta: 'backups', texto: 'Copias de seguridad', permiso: PERMISOS.BACKUP_GESTIONAR },
  { ruta: 'auditoria', texto: 'Auditoría', permiso: PERMISOS.REPORTE_SUCURSAL },
  { ruta: 'sistema', texto: 'Configuración del sistema', permiso: PERMISOS.PRODUCTO_VER },
];

export function useModoServidor() {
  const [modo, setModo] = useState<'central' | 'store' | null>(null);
  useEffect(() => {
    get('/health').then((h) => setModo(h.modo)).catch(() => undefined);
  }, []);
  return modo;
}

export default function AdminLayout() {
  const nav = useNavigate();
  const { usuario, cerrarSesion, puede } = useSesion();
  const modo = useModoServidor();
  const { configurado, cargado, p } = useParametros();
  const [asistenteCerrado, setAsistenteCerrado] = useState(false);
  useEffect(() => {
    if (!usuario) nav('/admin-login');
  }, [usuario]);
  useEffect(() => {
    useParametros.getState().cargar().catch(() => undefined);
  }, []);
  if (!usuario) return null;
  const cfg = leerConfig();
  const mostrarAsistente = cargado && !configurado && !asistenteCerrado && modo === 'central' && puede(PERMISOS.CONFIG_GESTIONAR);

  return (
    <div className="flex h-full">
      <aside className="scroll-touch flex w-64 shrink-0 flex-col gap-1 bg-slate-900 p-3 text-white">
        <div className="mb-2 px-2">
          {p.marca.logoId && <img src={urlMedia(p.marca.logoId)!} className="mb-2 max-h-14 rounded bg-white object-contain p-1" />}
          <div className="text-lg font-bold">{p.marca.nombreComercial}</div>
          <div className="text-sm opacity-80">Administración</div>
          <div className="text-sm opacity-70">{usuario.nombre}</div>
          <div className="mt-1 text-xs opacity-60">Servidor {modo === 'central' ? 'CENTRAL' : modo === 'store' ? 'de TIENDA' : '…'}</div>
        </div>
        {MENU.filter((m) => puede(m.permiso)).map((m) => (
          <NavLink
            key={m.ruta}
            to={m.ruta}
            className={({ isActive }) => `flex min-h-[52px] items-center rounded-lg px-3 text-lg ${isActive ? 'bg-marca-600' : 'hover:bg-slate-800'}`}
          >
            {m.texto}
          </NavLink>
        ))}
        <div className="flex-1" />
        {cfg.cajaId && usuario.permisos.includes(PERMISOS.VENTA_CREAR) && (
          <Boton variante="primario" onClick={() => nav('/venta')}>
            Ir a caja
          </Boton>
        )}
        {bridge() && puede(PERMISOS.KIOSCO_SALIR) && (
          <Boton variante="neutro" onClick={() => bridge()!.app.exitKiosk().then(() => toast.info('Modo kiosco desactivado'))}>
            Salir de kiosco
          </Boton>
        )}
        <Boton
          variante="peligro"
          onClick={() => {
            cerrarSesion();
            nav(cfg.cajaId ? '/login' : '/admin-login');
          }}
        >
          Cerrar sesión
        </Boton>
      </aside>
      <main className="scroll-touch flex-1 p-6">
        <div className="mb-4 flex justify-end">
          <EstadoConexion />
        </div>
        {modo === 'store' && (
          <div className="mb-4 rounded-xl bg-sky-50 p-3 text-sky-800">
            Está conectado al servidor de la tienda. Productos, precios, usuarios y roles se editan en el <b>servidor central</b> y
            llegan aquí por sincronización.
          </div>
        )}
        <Outlet />
      </main>
      {mostrarAsistente && <AsistenteInicial onTerminar={() => setAsistenteCerrado(true)} />}
    </div>
  );
}
