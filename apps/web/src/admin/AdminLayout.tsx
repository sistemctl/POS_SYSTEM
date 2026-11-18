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

interface ItemMenu {
  ruta: string;
  texto: string;
  /** Explicación corta que aparece debajo del nombre */
  ayuda: string;
  permiso: Permiso;
}

/** Menú agrupado por tarea, para que cada persona encuentre rápido lo que necesita. */
const MENU: { grupo: string; items: ItemMenu[] }[] = [
  {
    grupo: 'Ventas',
    items: [
      { ruta: 'reportes', texto: 'Informes de ventas', ayuda: 'Cuánto se vendió hoy y por cajero', permiso: PERMISOS.REPORTE_SUCURSAL },
      { ruta: 'turnos', texto: 'Cierres de caja', ayuda: 'Turnos, arqueos y diferencias', permiso: PERMISOS.TURNO_VER_TODOS },
    ],
  },
  {
    grupo: 'Productos y bodega',
    items: [
      { ruta: 'productos', texto: 'Productos y precios', ayuda: 'Crear, importar de Excel, cambiar precios', permiso: PERMISOS.PRODUCTO_VER },
      { ruta: 'promociones', texto: 'Promociones', ayuda: '2x1, % de descuento, precio por cantidad', permiso: PERMISOS.PRODUCTO_VER },
      { ruta: 'recibir', texto: 'Recibir mercancía', ayuda: 'Entrada de pedidos de proveedores', permiso: PERMISOS.COMPRA_REGISTRAR },
      { ruta: 'inventario', texto: 'Inventario', ayuda: 'Existencias y ajustes', permiso: PERMISOS.INVENTARIO_VER },
    ],
  },
  {
    grupo: 'Personal',
    items: [
      { ruta: 'usuarios', texto: 'Usuarios', ayuda: 'Cajeros, supervisores, claves y PIN', permiso: PERMISOS.USUARIO_GESTIONAR },
      { ruta: 'roles', texto: 'Roles y permisos', ayuda: 'Qué puede hacer cada cargo', permiso: PERMISOS.USUARIO_GESTIONAR },
    ],
  },
  {
    grupo: 'Tiendas y control',
    items: [
      { ruta: 'sucursales', texto: 'Tiendas y cajas', ayuda: 'Sucursales, cajas, impresora y báscula', permiso: PERMISOS.SUCURSAL_GESTIONAR },
      { ruta: 'monitoreo', texto: 'Estado de las tiendas', ayuda: 'Conexión y sincronización', permiso: PERMISOS.MONITOREO_VER },
      { ruta: 'errores', texto: 'Errores de caja', ayuda: 'Problemas que vieron los cajeros', permiso: PERMISOS.MONITOREO_VER },
      { ruta: 'auditoria', texto: 'Auditoría', ayuda: 'Quién autorizó descuentos y anulaciones', permiso: PERMISOS.REPORTE_SUCURSAL },
    ],
  },
  {
    grupo: 'Sistema',
    items: [
      { ruta: 'sistema', texto: 'Configuración', ayuda: 'País, IVA, logo, recibo y caja', permiso: PERMISOS.PRODUCTO_VER },
      { ruta: 'backups', texto: 'Copias de seguridad', ayuda: 'Respaldos de la base de datos', permiso: PERMISOS.BACKUP_GESTIONAR },
    ],
  },
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
        {MENU.map((g) => {
          const visibles = g.items.filter((m) => puede(m.permiso));
          if (!visibles.length) return null;
          return (
            <div key={g.grupo} className="mb-2">
              <div className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wider text-slate-400">{g.grupo}</div>
              {visibles.map((m) => (
                <NavLink
                  key={m.ruta}
                  to={m.ruta}
                  className={({ isActive }) =>
                    `flex min-h-[52px] flex-col justify-center rounded-lg px-3 py-1 ${isActive ? 'bg-marca-600' : 'hover:bg-slate-800'}`
                  }
                >
                  <span className="text-lg leading-tight">{m.texto}</span>
                  <span className="text-xs leading-tight opacity-70">{m.ayuda}</span>
                </NavLink>
              ))}
            </div>
          );
        })}
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
