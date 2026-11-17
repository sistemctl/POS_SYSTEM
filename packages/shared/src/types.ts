import type { MetodoPago, PromocionInput } from './pricing';
import type { Permiso } from './permissions';

export type ServerMode = 'central' | 'store';

export type TipoComprobante = 'TICKET' | 'BOLETA' | 'FACTURA';
export type EstadoVenta = 'COMPLETADA' | 'ANULADA';
export type EstadoEnvioComprobante = 'NO_APLICA' | 'PENDIENTE' | 'ENVIADO' | 'ERROR';

export interface UsuarioSesion {
  id: string;
  nombre: string;
  usuario: string;
  sucursalId: string | null;
  roles: string[];
  permisos: Permiso[];
  descuentoMaximo: number;
  retiroMaximo: number;
}

export interface LoginResponse {
  token: string;
  usuario: UsuarioSesion;
}

export interface UsuarioCaja {
  id: string;
  nombre: string;
  usuario: string;
  foto: string | null;
  roles: string[];
}

export interface ProductoCaja {
  id: string;
  sku: string;
  nombre: string;
  categoriaId: string | null;
  categoriaNombre: string | null;
  codigos: string[];
  /** Código PLU de balanza etiquetadora */
  plu: string | null;
  precio: string;
  tasaImpuesto: string;
  pesable: boolean;
  unidad: string;
  imagen: string | null;
  favorito: boolean;
  color: string | null;
}

export interface CategoriaCaja {
  id: string;
  nombre: string;
  color: string | null;
  orden: number;
}

export interface CatalogoCaja {
  productos: ProductoCaja[];
  categorias: CategoriaCaja[];
  promociones: PromocionInput[];
  /** Fecha del último cambio; se envía como ?desde= para pedir solo lo nuevo */
  version: string;
  /** true si es una respuesta parcial (solo cambios) */
  incremental?: boolean;
  /** Productos que dejaron de venderse (solo en respuestas incrementales) */
  eliminados?: string[];
}

export interface VentaItemDto {
  productoId: string;
  cantidad: string;
  precioUnitario: string;
  descuentoPorcentaje?: string;
}

export interface VentaPagoDto {
  metodo: MetodoPago;
  monto: string;
  referencia?: string | null;
}

/** Venta enviada desde la caja al servidor de tienda */
export interface CrearVentaDto {
  id: string; // UUID v7 generado en la caja
  turnoId: string;
  items: VentaItemDto[];
  pagos: VentaPagoDto[];
  /** Total calculado por la caja; la API lo recalcula y valida */
  totalEsperado: string;
  clienteId?: string | null;
  tipoComprobante?: TipoComprobante;
  /** IDs de autorizaciones de supervisor (para descuentos / cambio de precio) */
  autorizacionIds?: string[];
}

export interface TicketItem {
  nombre: string;
  cantidad: string;
  unidad: string;
  precioUnitario: string;
  total: string;
  descuento: string;
}

/** Logo en mapa de bits 1-bit listo para ESC/POS (GS v 0) y PNG para el navegador. */
export interface TicketLogo {
  /** Ancho en bytes (8 puntos por byte) */
  anchoBytes: number;
  alto: number;
  /** Bits en base64, fila por fila, 1 = negro */
  bits: string;
  /** URL relativa de la imagen (/media/...) para la vista previa HTML */
  url: string;
}

export interface FormatoDinero {
  monedaSimbolo: string;
  decimales: 0 | 2;
  separadorMiles: '.' | ',' | ' ' | '';
  separadorDecimal: ',' | '.';
}

export interface TicketData {
  empresa: string;
  sucursal: string;
  direccion: string | null;
  /** Número de identificación fiscal (NIT, RUC...) de la sucursal */
  ruc: string | null;
  /** Texto que acompaña al número fiscal: NIT, RUC, RFC... */
  etiquetaFiscal?: string;
  /** Nombre del impuesto: IVA, IGV */
  nombreImpuesto?: string;
  /** Líneas adicionales del encabezado */
  encabezado?: string[];
  telefono?: string | null;
  logo?: TicketLogo | null;
  qr?: string | null;
  mostrarAhorro?: boolean;
  copias?: number;
  formato?: FormatoDinero;
  /** Desglose de impuestos por tasa */
  impuestos?: { nombre: string; base: string; impuesto: string }[];
  caja: string;
  cajero: string;
  numero: string;
  fecha: string;
  items: TicketItem[];
  subtotal: string;
  impuesto: string;
  descuento: string;
  total: string;
  pagos: { metodo: string; monto: string }[];
  vuelto: string;
  pie: string | null;
  anulada?: boolean;
  reimpresion?: boolean;
}

export interface CrearVentaResponse {
  ventaId: string;
  numero: string;
  total: string;
  vuelto: string;
  ticket: TicketData;
}

// --- Sincronización ---

export type EntidadSync =
  | 'venta'
  | 'turno_caja'
  | 'movimiento_caja'
  | 'movimiento_inventario'
  | 'auditoria'
  | 'cliente';

export interface SyncEvento {
  id: string; // id del registro outbox
  entidad: EntidadSync;
  entidadId: string;
  operacion: 'UPSERT';
  payload: unknown;
  creadoEn: string;
}

export interface SyncPushRequest {
  sucursalId: string;
  eventos: SyncEvento[];
}

export interface SyncPushResponse {
  aceptados: string[];
  rechazados: { id: string; error: string }[];
}

export interface SyncPullResponse {
  cursor: string;
  hayMas: boolean;
  cambios: {
    tabla: string;
    filas: Record<string, unknown>[];
  }[];
}

export interface HeartbeatDto {
  sucursalId: string;
  version: string;
  ventasPendientes: number;
  ultimoSyncPush: string | null;
  ultimoSyncPull: string | null;
  ultimoBackup: string | null;
  ultimoBackupOk: boolean | null;
  /** Errores reportados por las cajas en las últimas 24 h */
  erroresCaja24h?: number;
  cajas: { id: string; nombre: string; ultimaActividad: string | null }[];
}

export interface EstadoSincronizacion {
  modo: ServerMode;
  online: boolean;
  ventasPendientes: number;
  ultimoSyncPush: string | null;
  ultimoSyncPull: string | null;
}
