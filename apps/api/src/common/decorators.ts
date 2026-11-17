import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permiso } from '@pos/shared';

export const IS_PUBLIC = 'isPublic';
/** Endpoint sin autenticación de usuario. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMISSIONS_KEY = 'permissions';
/** Requiere TODOS los permisos indicados. */
export const RequirePermission = (...permisos: Permiso[]) => SetMetadata(PERMISSIONS_KEY, permisos);

export const CENTRAL_ONLY = 'centralOnly';
/** Solo disponible en el servidor central (datos maestros: catálogo, usuarios, sucursales). */
export const CentralOnly = () => SetMetadata(CENTRAL_ONLY, true);

export const STORE_OPERATION = 'storeOperation';
/** Operación de tienda: requiere que el servidor tenga SUCURSAL_ID (ventas, turnos, inventario). */
export const StoreOperation = () => SetMetadata(STORE_OPERATION, true);

export const SYNC_AUTH = 'syncAuth';
/** Autenticado con token de sincronización de sucursal (tienda → central). */
export const SyncAuth = () => SetMetadata(SYNC_AUTH, true);

export interface JwtUser {
  sub: string;
  nombre: string;
  usuario: string;
  sucursalId: string | null;
  cajaId: string | null;
  roles: string[];
  permisos: Permiso[];
  descuentoMaximo: number;
  retiroMaximo: number;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const SyncSucursal = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  return ctx.switchToHttp().getRequest().syncSucursalId;
});
