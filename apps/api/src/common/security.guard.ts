import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { createHash, timingSafeEqual } from 'crypto';
import type { Permiso } from '@pos/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import {
  CENTRAL_ONLY,
  IS_PUBLIC,
  JwtUser,
  PERMISSIONS_KEY,
  STORE_OPERATION,
  SYNC_AUTH,
} from './decorators';

export function hashSyncToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Guard global: autenticación (JWT o token de sincronización), modo del servidor y permisos (RBAC).
 */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  private meta<T>(key: string, ctx: ExecutionContext): T | undefined {
    return this.reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    if (this.meta<boolean>(CENTRAL_ONLY, ctx) && !this.config.isCentral) {
      throw new ForbiddenException(
        'Esta operación solo se realiza en el servidor central (los datos maestros se sincronizan a la tienda).',
      );
    }
    if (this.meta<boolean>(STORE_OPERATION, ctx) && !this.config.sucursalId) {
      throw new ForbiddenException('Este servidor no tiene una sucursal asignada (SUCURSAL_ID).');
    }

    if (this.meta<boolean>(SYNC_AUTH, ctx)) {
      return this.validarSync(req);
    }

    if (this.meta<boolean>(IS_PUBLIC, ctx)) return true;

    const auth: string | undefined = req.headers['authorization'];
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Sesión requerida');
    let user: JwtUser;
    try {
      user = await this.jwt.verifyAsync<JwtUser>(auth.slice(7));
    } catch {
      throw new UnauthorizedException('Sesión inválida o vencida');
    }
    req.user = user;

    const requeridos = this.meta<Permiso[]>(PERMISSIONS_KEY, ctx) ?? [];
    const faltantes = requeridos.filter((p) => !user.permisos.includes(p));
    if (faltantes.length) {
      throw new ForbiddenException({ message: 'Permiso insuficiente', permisos: faltantes });
    }
    return true;
  }

  private async validarSync(req: any): Promise<boolean> {
    if (!this.config.isCentral) throw new ForbiddenException('Solo el servidor central recibe sincronización');
    const sucursalId = req.headers['x-sucursal-id'];
    const token = req.headers['x-sync-token'];
    if (typeof sucursalId !== 'string' || typeof token !== 'string') {
      throw new UnauthorizedException('Credenciales de sincronización faltantes');
    }
    const suc = await this.prisma.sucursal.findUnique({
      where: { id: sucursalId },
      select: { syncTokenHash: true, activa: true },
    });
    if (!suc?.syncTokenHash || !suc.activa) throw new UnauthorizedException('Sucursal no autorizada');
    const a = Buffer.from(hashSyncToken(token));
    const b = Buffer.from(suc.syncTokenHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Token de sincronización inválido');
    }
    req.syncSucursalId = sucursalId;
    return true;
  }
}
