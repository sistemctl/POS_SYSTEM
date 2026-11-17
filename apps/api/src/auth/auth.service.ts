import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { newId, Permiso, PERMISO_DESCRIPCION, UsuarioCaja } from '@pos/shared';
import type { LoginResponse, UsuarioSesion } from '@pos/shared';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AppConfig } from '../config/app-config';
import { JwtUser } from '../common/decorators';
import { PrismaService, Tx } from '../prisma/prisma.service';

const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;
const AUTORIZACION_VIGENCIA_MS = 5 * 60 * 1000;

/**
 * Autenticación. Funciona igual en el central y en la tienda: la tienda tiene una copia
 * de los usuarios (con hash de contraseña y PIN) gracias al pull, por eso el login funciona sin internet.
 */
@Injectable()
export class AuthService {
  /** Intentos fallidos en memoria (no se modifica la tabla usuario, que pertenece al central) */
  private intentos = new Map<string, { n: number; hasta: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Usuarios que pueden iniciar sesión en las cajas de esta sucursal (pantalla de selección táctil). */
  async usuariosCaja(): Promise<UsuarioCaja[]> {
    const sucursalId = this.config.sucursalId;
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        activo: true,
        deletedAt: null,
        pinHash: { not: null },
        roles: {
          some: { deletedAt: null, OR: [{ sucursalId: null }, ...(sucursalId ? [{ sucursalId }] : [])] },
        },
      },
      include: { roles: { where: { deletedAt: null }, include: { rol: true } } },
      orderBy: { nombre: 'asc' },
    });
    return usuarios
      .map((u) => ({
        id: u.id,
        nombre: u.nombre,
        usuario: u.usuario,
        foto: u.foto,
        roles: u.roles.filter((r) => this.aplicaRol(r.sucursalId)).map((r) => r.rol.nombre),
        permisos: this.permisosDe(u.roles.filter((r) => this.aplicaRol(r.sucursalId)).map((r) => r.rol)),
      }))
      .filter((u) => u.permisos.has('venta.crear') || u.permisos.has('turno.ver_todos'))
      .map(({ permisos, ...u }) => u);
  }

  private aplicaRol(sucursalId: string | null) {
    if (sucursalId === null) return true;
    // En el central sin sucursal se consideran todos los roles
    if (!this.config.sucursalId) return true;
    return sucursalId === this.config.sucursalId;
  }

  private permisosDe(roles: { permisos: string[]; deletedAt: Date | null }[]): Set<Permiso> {
    const s = new Set<Permiso>();
    for (const r of roles) if (!r.deletedAt) for (const p of r.permisos) s.add(p as Permiso);
    return s;
  }

  async sesion(usuarioId: string): Promise<UsuarioSesion> {
    const u = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: { roles: { where: { deletedAt: null }, include: { rol: true } } },
    });
    if (!u || !u.activo || u.deletedAt) throw new UnauthorizedException('Usuario inactivo');
    const roles = u.roles.filter((r) => this.aplicaRol(r.sucursalId) && !r.rol.deletedAt);
    if (!roles.length) throw new ForbiddenException('El usuario no tiene roles en esta sucursal');
    const sucursalesDeRoles = new Set(roles.map((r) => r.sucursalId));
    const sucursalId =
      this.config.sucursalId ??
      (sucursalesDeRoles.size === 1 && !sucursalesDeRoles.has(null) ? [...sucursalesDeRoles][0] : null);
    return {
      id: u.id,
      nombre: u.nombre,
      usuario: u.usuario,
      sucursalId,
      roles: roles.map((r) => r.rol.codigo),
      permisos: [...this.permisosDe(roles.map((r) => r.rol))],
      descuentoMaximo: Math.max(0, ...roles.map((r) => Number(r.rol.descuentoMaximo))),
      retiroMaximo: Math.max(0, ...roles.map((r) => Number(r.rol.retiroMaximo))),
    };
  }

  private async emitir(usuarioId: string, cajaId: string | null): Promise<LoginResponse> {
    const usuario = await this.sesion(usuarioId);
    const payload: JwtUser = {
      sub: usuario.id,
      nombre: usuario.nombre,
      usuario: usuario.usuario,
      sucursalId: usuario.sucursalId,
      cajaId,
      roles: usuario.roles,
      permisos: usuario.permisos,
      descuentoMaximo: usuario.descuentoMaximo,
      retiroMaximo: usuario.retiroMaximo,
    };
    const token = await this.jwt.signAsync(payload);
    return { token, usuario };
  }

  private verificarBloqueo(clave: string) {
    const i = this.intentos.get(clave);
    if (i && i.n >= MAX_INTENTOS && i.hasta > Date.now()) {
      const min = Math.ceil((i.hasta - Date.now()) / 60000);
      throw new UnauthorizedException(`Usuario bloqueado por intentos fallidos. Intente en ${min} min.`);
    }
  }

  private registrarFallo(clave: string) {
    const i = this.intentos.get(clave);
    const n = i && i.hasta > Date.now() ? i.n + 1 : 1;
    this.intentos.set(clave, { n, hasta: Date.now() + BLOQUEO_MS });
  }

  async login(usuario: string, password: string): Promise<LoginResponse> {
    const clave = `u:${usuario.toLowerCase()}`;
    this.verificarBloqueo(clave);
    const u = await this.prisma.usuario.findUnique({ where: { usuario: usuario.toLowerCase() } });
    if (!u || !u.activo || u.deletedAt || !(await bcrypt.compare(password, u.passwordHash))) {
      this.registrarFallo(clave);
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }
    this.intentos.delete(clave);
    return this.emitir(u.id, null);
  }

  async loginPin(usuarioId: string, pin: string, cajaId: string | null): Promise<LoginResponse> {
    const clave = `p:${usuarioId}`;
    this.verificarBloqueo(clave);
    const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId } });
    if (!u?.pinHash || !u.activo || u.deletedAt || !(await bcrypt.compare(pin, u.pinHash))) {
      this.registrarFallo(clave);
      throw new UnauthorizedException('PIN incorrecto');
    }
    this.intentos.delete(clave);
    if (cajaId) {
      const caja = await this.prisma.caja.findUnique({ where: { id: cajaId } });
      if (!caja || caja.sucursalId !== this.config.sucursalId) {
        throw new BadRequestException('La caja no pertenece a esta sucursal');
      }
    }
    return this.emitir(u.id, cajaId);
  }

  /**
   * Autorización de supervisor en el momento: el supervisor ingresa su PIN (o escanea su tarjeta)
   * en la caja del cajero para permitir una acción puntual.
   */
  async autorizar(
    solicitante: JwtUser,
    datos: { supervisorId?: string; pin?: string; codigoTarjeta?: string; permiso: Permiso; motivo?: string; consumir?: boolean; detalle?: unknown },
  ) {
    let supervisor;
    if (datos.codigoTarjeta) {
      supervisor = await this.prisma.usuario.findUnique({ where: { codigoTarjeta: datos.codigoTarjeta } });
      if (!supervisor) throw new UnauthorizedException('Tarjeta no reconocida');
    } else if (datos.supervisorId && datos.pin) {
      const clave = `p:${datos.supervisorId}`;
      this.verificarBloqueo(clave);
      supervisor = await this.prisma.usuario.findUnique({ where: { id: datos.supervisorId } });
      if (!supervisor?.pinHash || !(await bcrypt.compare(datos.pin, supervisor.pinHash))) {
        this.registrarFallo(clave);
        throw new UnauthorizedException('PIN de supervisor incorrecto');
      }
      this.intentos.delete(clave);
    } else {
      throw new BadRequestException('Indique supervisor y PIN, o tarjeta');
    }
    if (supervisor.id === solicitante.sub) {
      throw new ForbiddenException('No puede autorizarse a sí mismo');
    }
    const ses = await this.sesion(supervisor.id);
    if (!ses.permisos.includes(datos.permiso)) {
      throw new ForbiddenException(`${ses.nombre} no tiene permiso para: ${PERMISO_DESCRIPCION[datos.permiso] ?? datos.permiso}`);
    }
    const aut = await this.prisma.autorizacion.create({
      data: {
        id: newId(),
        supervisorId: supervisor.id,
        solicitanteId: solicitante.sub,
        permiso: datos.permiso,
        motivo: datos.motivo,
        usadaEn: datos.consumir ? new Date() : null,
        expiraEn: new Date(Date.now() + AUTORIZACION_VIGENCIA_MS),
      },
    });
    await this.auditoria.registrar({
      sucursalId: this.config.sucursalId,
      usuarioId: solicitante.sub,
      autorizadoPorId: supervisor.id,
      accion: `autorizacion:${datos.permiso}`,
      entidad: 'autorizacion',
      entidadId: aut.id,
      motivo: datos.motivo,
      detalle: datos.detalle,
    });
    return {
      autorizacionId: aut.id,
      supervisor: { id: ses.id, nombre: ses.nombre },
      descuentoMaximo: ses.descuentoMaximo,
      retiroMaximo: ses.retiroMaximo,
    };
  }

  /**
   * Verifica que el usuario tenga el permiso o una autorización de supervisor válida para él.
   * Marca la autorización como usada. Devuelve el id del supervisor que autorizó (o null).
   */
  async exigirPermiso(
    tx: Tx,
    user: JwtUser,
    permiso: Permiso,
    autorizacionIds: string[] = [],
    /** true: exige autorización de supervisor aunque el usuario tenga el permiso (ej. superó su límite) */
    forzarAutorizacion = false,
  ): Promise<string | null> {
    if (!forzarAutorizacion && user.permisos.includes(permiso)) return null;
    for (const id of autorizacionIds) {
      // Consumo atómico: una autorización sirve para UNA sola operación.
      // (Dentro de una venta, el llamador cachea el supervisor para no pedirla dos veces.)
      const ahora = new Date();
      const { count } = await tx.autorizacion.updateMany({
        where: { id, permiso, solicitanteId: user.sub, usadaEn: null, expiraEn: { gt: ahora } },
        data: { usadaEn: ahora },
      });
      if (count === 1) {
        const a = await tx.autorizacion.findUniqueOrThrow({ where: { id } });
        return a.supervisorId;
      }
    }
    throw new ForbiddenException({
      message: `Requiere autorización de supervisor: ${PERMISO_DESCRIPCION[permiso]}`,
      requiereAutorizacion: permiso,
    });
  }

  /** Límite (descuento o retiro) efectivo considerando una autorización de supervisor. */
  async limiteAutorizado(
    user: JwtUser,
    campo: 'descuentoMaximo' | 'retiroMaximo',
    supervisorId: string | null,
  ): Promise<number> {
    if (!supervisorId) return user[campo];
    const s = await this.sesion(supervisorId);
    return Math.max(user[campo], s[campo]);
  }

  static hash(valor: string) {
    return bcrypt.hash(valor, 10);
  }
}
