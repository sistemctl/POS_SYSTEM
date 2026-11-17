/** Códigos de permiso del sistema. Se validan en la API (PermissionsGuard) y en la UI (usePermission). */
export const PERMISOS = {
  // Caja
  TURNO_ABRIR: 'turno.abrir',
  TURNO_CERRAR: 'turno.cerrar',
  TURNO_VER_TODOS: 'turno.ver_todos',
  VENTA_CREAR: 'venta.crear',
  VENTA_ANULAR: 'venta.anular',
  VENTA_ANULAR_ITEM: 'venta.anular_item',
  VENTA_DESCUENTO: 'venta.descuento',
  VENTA_DEVOLUCION: 'venta.devolucion',
  VENTA_REIMPRIMIR: 'venta.reimprimir',
  PRECIO_MODIFICAR: 'precio.modificar',
  CAJA_RETIRO: 'caja.retiro',
  CAJA_INGRESO: 'caja.ingreso',
  CAJA_ABRIR_CAJON: 'caja.abrir_cajon',
  // Catálogo
  PRODUCTO_VER: 'producto.ver',
  PRODUCTO_GESTIONAR: 'producto.gestionar',
  PROMOCION_GESTIONAR: 'promocion.gestionar',
  // Inventario
  INVENTARIO_VER: 'inventario.ver',
  INVENTARIO_AJUSTAR: 'inventario.ajustar',
  COMPRA_REGISTRAR: 'compra.registrar',
  // Administración
  USUARIO_GESTIONAR: 'usuario.gestionar',
  ROL_GESTIONAR: 'rol.gestionar',
  SUCURSAL_GESTIONAR: 'sucursal.gestionar',
  CAJA_GESTIONAR: 'caja.gestionar',
  REPORTE_SUCURSAL: 'reporte.sucursal',
  REPORTE_GLOBAL: 'reporte.global',
  MONITOREO_VER: 'monitoreo.ver',
  BACKUP_GESTIONAR: 'backup.gestionar',
  KIOSCO_SALIR: 'kiosco.salir',
  CONFIG_GESTIONAR: 'config.gestionar',
} as const;

export type Permiso = (typeof PERMISOS)[keyof typeof PERMISOS];

export const TODOS_LOS_PERMISOS: Permiso[] = Object.values(PERMISOS);

export const PERMISO_DESCRIPCION: Record<Permiso, string> = {
  'turno.abrir': 'Abrir turno de caja',
  'turno.cerrar': 'Cerrar turno de caja',
  'turno.ver_todos': 'Ver turnos y arqueos de otros cajeros',
  'venta.crear': 'Registrar ventas',
  'venta.anular': 'Anular ventas',
  'venta.anular_item': 'Quitar productos de una venta en curso',
  'venta.descuento': 'Aplicar descuentos',
  'venta.devolucion': 'Registrar devoluciones',
  'venta.reimprimir': 'Reimprimir tickets',
  'precio.modificar': 'Cambiar precio durante la venta',
  'caja.retiro': 'Retiros de efectivo',
  'caja.ingreso': 'Ingresos de efectivo',
  'caja.abrir_cajon': 'Abrir cajón sin venta',
  'producto.ver': 'Consultar productos',
  'producto.gestionar': 'Crear/editar productos y precios',
  'promocion.gestionar': 'Gestionar promociones',
  'inventario.ver': 'Ver inventario',
  'inventario.ajustar': 'Ajustes y mermas de inventario',
  'compra.registrar': 'Registrar compras / ingreso de mercadería',
  'usuario.gestionar': 'Gestionar usuarios',
  'rol.gestionar': 'Gestionar roles y permisos',
  'sucursal.gestionar': 'Gestionar sucursales',
  'caja.gestionar': 'Gestionar cajas',
  'reporte.sucursal': 'Reportes de la sucursal',
  'reporte.global': 'Reportes de todas las sucursales',
  'monitoreo.ver': 'Ver estado de sucursales',
  'backup.gestionar': 'Gestionar copias de seguridad',
  'kiosco.salir': 'Salir del modo kiosco',
  'config.gestionar': 'Configuración del sistema (marca, país, ticket, caja)',
};

const P = PERMISOS;

const CAJERO: Permiso[] = [
  P.TURNO_ABRIR,
  P.TURNO_CERRAR,
  P.VENTA_CREAR,
  P.VENTA_REIMPRIMIR,
  P.PRODUCTO_VER,
];

const SUPERVISOR: Permiso[] = [
  ...CAJERO,
  P.TURNO_VER_TODOS,
  P.VENTA_ANULAR,
  P.VENTA_ANULAR_ITEM,
  P.VENTA_DESCUENTO,
  P.VENTA_DEVOLUCION,
  P.PRECIO_MODIFICAR,
  P.CAJA_RETIRO,
  P.CAJA_INGRESO,
  P.CAJA_ABRIR_CAJON,
];

const ALMACEN: Permiso[] = [P.PRODUCTO_VER, P.INVENTARIO_VER, P.INVENTARIO_AJUSTAR, P.COMPRA_REGISTRAR];

const ADMIN_TIENDA: Permiso[] = [
  ...SUPERVISOR,
  ...ALMACEN,
  P.USUARIO_GESTIONAR,
  P.CAJA_GESTIONAR,
  P.REPORTE_SUCURSAL,
  P.BACKUP_GESTIONAR,
  P.KIOSCO_SALIR,
];

export interface RolPredefinido {
  codigo: string;
  nombre: string;
  permisos: Permiso[];
  /** Descuento máximo (%) que puede aplicar sin autorización. */
  descuentoMaximo: number;
  /** Monto máximo de retiro de efectivo. 0 = sin permiso. */
  retiroMaximo: number;
}

export const ROLES_PREDEFINIDOS: RolPredefinido[] = [
  { codigo: 'CAJERO', nombre: 'Cajero', permisos: CAJERO, descuentoMaximo: 0, retiroMaximo: 0 },
  { codigo: 'SUPERVISOR', nombre: 'Supervisor de caja', permisos: unique(SUPERVISOR), descuentoMaximo: 20, retiroMaximo: 2000 },
  { codigo: 'ALMACEN', nombre: 'Almacén / Inventario', permisos: ALMACEN, descuentoMaximo: 0, retiroMaximo: 0 },
  { codigo: 'ADMIN_TIENDA', nombre: 'Administrador de tienda', permisos: unique(ADMIN_TIENDA), descuentoMaximo: 50, retiroMaximo: 10000 },
  { codigo: 'ADMIN_GENERAL', nombre: 'Administrador general', permisos: TODOS_LOS_PERMISOS, descuentoMaximo: 100, retiroMaximo: 1000000 },
];

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
