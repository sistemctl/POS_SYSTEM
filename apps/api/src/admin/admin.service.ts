import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { newId } from '@pos/shared';
import { AuthService } from '../auth/auth.service';
import { hashSyncToken } from '../common/security.guard';
import { PrismaService } from '../prisma/prisma.service';

const usuarioSelect = {
  id: true,
  usuario: true,
  nombre: true,
  foto: true,
  codigoTarjeta: true,
  activo: true,
  pinHash: true,
  createdAt: true,
  updatedAt: true,
  roles: { where: { deletedAt: null }, select: { id: true, rolId: true, sucursalId: true, rol: { select: { codigo: true, nombre: true } } } },
} as const;

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // ───── Sucursales ─────
  listarSucursales() {
    return this.prisma.sucursal.findMany({
      where: { deletedAt: null },
      orderBy: { codigo: 'asc' },
      include: { cajas: { where: { deletedAt: null }, orderBy: { codigo: 'asc' } } },
    }).then((r) => r.map(({ syncTokenHash, ...s }) => ({ ...s, tieneTokenSync: !!syncTokenHash })));
  }

  async guardarSucursal(id: string | null, d: { codigo: string; nombre: string; direccion?: string | null; ruc?: string | null; telefono?: string | null; pieTicket?: string | null; configBalanza?: any; activa?: boolean }) {
    const data = { ...d, configBalanza: d.configBalanza ?? undefined };
    const s = id
      ? await this.prisma.sucursal.update({ where: { id }, data })
      : await this.prisma.sucursal.create({ data: { id: newId(), ...data } });
    const { syncTokenHash, ...rest } = s;
    return rest;
  }

  /** Genera un nuevo token de sincronización. Se muestra UNA vez; en el central solo se guarda el hash. */
  async generarTokenSync(id: string) {
    const token = randomBytes(32).toString('base64url');
    await this.prisma.sucursal.update({ where: { id }, data: { syncTokenHash: hashSyncToken(token) } });
    return { sucursalId: id, token };
  }

  // ───── Cajas ─────
  async guardarCaja(id: string | null, d: { sucursalId: string; codigo: string; nombre: string; serie: string; activa?: boolean; hardware?: object | null }) {
    // hardware: undefined = no tocar; null = volver a configuración local en la caja
    const data = { ...d, hardware: d.hardware === null ? Prisma.DbNull : d.hardware };
    return id
      ? this.prisma.caja.update({ where: { id }, data })
      : this.prisma.caja.create({ data: { id: newId(), ...data } });
  }

  listarCajas(sucursalId?: string | null) {
    return this.prisma.caja.findMany({
      where: { deletedAt: null, activa: true, ...(sucursalId ? { sucursalId } : {}) },
      orderBy: { codigo: 'asc' },
    });
  }

  // ───── Roles ─────
  listarRoles() {
    return this.prisma.rol.findMany({ where: { deletedAt: null }, orderBy: { nombre: 'asc' } });
  }

  guardarRol(id: string | null, d: { codigo: string; nombre: string; permisos: string[]; descuentoMaximo: string; retiroMaximo: string }) {
    return id
      ? this.prisma.rol.update({ where: { id }, data: d })
      : this.prisma.rol.create({ data: { id: newId(), ...d } });
  }

  async eliminarRol(id: string) {
    const enUso = await this.prisma.usuarioRol.count({ where: { rolId: id, deletedAt: null } });
    if (enUso) throw new BadRequestException(`El rol está asignado a ${enUso} usuario(s)`);
    return this.prisma.rol.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // ───── Usuarios ─────
  async listarUsuarios(sucursalId?: string | null) {
    const r = await this.prisma.usuario.findMany({
      where: {
        deletedAt: null,
        ...(sucursalId ? { roles: { some: { deletedAt: null, OR: [{ sucursalId }, { sucursalId: null }] } } } : {}),
      },
      select: usuarioSelect,
      orderBy: { nombre: 'asc' },
    });
    return r.map(({ pinHash, ...u }) => ({ ...u, tienePin: !!pinHash }));
  }

  async guardarUsuario(
    id: string | null,
    d: {
      usuario: string;
      nombre: string;
      password?: string;
      pin?: string;
      codigoTarjeta?: string | null;
      foto?: string | null;
      activo?: boolean;
      roles: { rolId: string; sucursalId: string | null }[];
    },
  ) {
    if (!id && !d.password) throw new BadRequestException('La contraseña es obligatoria');
    const usuarioId = id ?? newId();
    await this.prisma.$transaction(async (tx) => {
      const data: any = {
        usuario: d.usuario.toLowerCase(),
        nombre: d.nombre,
        codigoTarjeta: d.codigoTarjeta || null,
        foto: d.foto ?? null,
        activo: d.activo ?? true,
      };
      if (d.password) data.passwordHash = await AuthService.hash(d.password);
      if (d.pin) data.pinHash = await AuthService.hash(d.pin);
      if (id) await tx.usuario.update({ where: { id }, data });
      else await tx.usuario.create({ data: { id: usuarioId, ...data } });

      const actuales = await tx.usuarioRol.findMany({ where: { usuarioId, deletedAt: null } });
      const clave = (r: { rolId: string; sucursalId: string | null }) => `${r.rolId}|${r.sucursalId ?? ''}`;
      const deseadas = new Set(d.roles.map(clave));
      for (const a of actuales) {
        if (!deseadas.has(clave(a))) await tx.usuarioRol.update({ where: { id: a.id }, data: { deletedAt: new Date() } });
      }
      for (const r of d.roles) {
        if (!actuales.some((a) => clave(a) === clave(r))) {
          await tx.usuarioRol.create({ data: { id: newId(), usuarioId, rolId: r.rolId, sucursalId: r.sucursalId } });
        }
      }
    });
    const u = await this.prisma.usuario.findUnique({ where: { id: usuarioId }, select: usuarioSelect });
    if (!u) throw new NotFoundException();
    const { pinHash, ...rest } = u;
    return { ...rest, tienePin: !!pinHash };
  }

  eliminarUsuario(id: string) {
    return this.prisma.usuario.update({ where: { id }, data: { deletedAt: new Date(), activo: false } }).then(() => ({ ok: true }));
  }

  // ───── Monitoreo (central) ─────
  async estadoSucursales() {
    const [sucursales, estados] = await Promise.all([
      this.prisma.sucursal.findMany({ where: { deletedAt: null }, orderBy: { codigo: 'asc' } }),
      this.prisma.sucursalEstado.findMany(),
    ]);
    const ahora = Date.now();
    return sucursales.map((s) => {
      const e = estados.find((x) => x.sucursalId === s.id);
      const data = (e?.data ?? null) as any;
      const alertas: string[] = [];
      const minHeartbeat = e ? (ahora - e.ultimoHeartbeat.getTime()) / 60000 : null;
      if (!e) alertas.push('Nunca se ha conectado');
      else if (minHeartbeat! > 5) alertas.push(`Sin conexión hace ${Math.floor(minHeartbeat!)} min`);
      if (data?.ultimoSyncPush) {
        const min = (ahora - new Date(data.ultimoSyncPush).getTime()) / 60000;
        if (min > 30) alertas.push(`Sin sincronizar ventas hace ${Math.floor(min)} min`);
      }
      if (data?.ventasPendientes > 0) alertas.push(`${data.ventasPendientes} registros pendientes de subir`);
      if (data?.erroresCaja24h > 0) alertas.push(`${data.erroresCaja24h} errores de caja en las últimas 24 h`);
      if (data) {
        if (!data.ultimoBackup) alertas.push('Sin backups registrados');
        else if (data.ultimoBackupOk === false) alertas.push('El último backup falló');
        else if ((ahora - new Date(data.ultimoBackup).getTime()) / 3_600_000 > 24) alertas.push('Backup vencido (> 24 h)');
      }
      return {
        sucursal: { id: s.id, codigo: s.codigo, nombre: s.nombre, tieneTokenSync: !!s.syncTokenHash },
        ultimoHeartbeat: e?.ultimoHeartbeat ?? null,
        online: minHeartbeat !== null && minHeartbeat <= 5,
        data,
        alertas,
      };
    });
  }
}
