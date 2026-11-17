import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type {
  EstadoSincronizacion,
  HeartbeatDto,
  SyncEvento,
  SyncPullResponse,
  SyncPushResponse,
} from '@pos/shared';
import { AppConfig } from '../config/app-config';
import { LogsService } from '../logs/logs.module';
import { MediaService } from '../media/media.module';
import { ParametrosService } from '../parametros/parametros.module';
import { PrismaService } from '../prisma/prisma.service';
import { CLAVES, SyncEstadoService } from './sync-estado.service';
import { TABLAS_MAESTRAS } from './tablas-maestras';
import { Prisma } from '@prisma/client';

const LOTE_PUSH = 200;

/** Columnas Json? por tabla (delegado Prisma): Prisma no acepta `null` directo en ellas, exige Prisma.DbNull */
const CAMPOS_JSON: Record<string, string[]> = Object.fromEntries(
  Prisma.dmmf.datamodel.models.map((m) => [
    m.name.charAt(0).toLowerCase() + m.name.slice(1),
    m.fields.filter((f) => f.type === 'Json' && !f.isRequired).map((f) => f.name),
  ]),
);

function normalizarFila(tabla: string, fila: Record<string, unknown>) {
  const campos = CAMPOS_JSON[tabla];
  if (!campos?.length) return fila;
  const r = { ...fila };
  for (const c of campos) if (r[c] === null) r[c] = Prisma.DbNull;
  return r;
}
const BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * Lógica del lado TIENDA: sube el outbox al central y baja los cambios de datos maestros.
 * Si no hay internet, simplemente reintenta con backoff; la tienda sigue vendiendo con su BD local.
 */
@Injectable()
export class SyncStoreService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('SyncStore');
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private corriendo = false;
  private fallos = 0;
  private online = false;
  /** Proveedor del último estado de backup (inyectado por BackupService para evitar dependencia circular) */
  backupInfo: () => Promise<{ fecha: string | null; ok: boolean | null }> = async () => ({ fecha: null, ok: null });

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly estado: SyncEstadoService,
    private readonly media: MediaService,
    private readonly parametros: ParametrosService,
    private readonly logs: LogsService,
  ) {}

  onApplicationBootstrap() {
    if (!this.config.isStore) return;
    if (!this.config.centralUrl || !this.config.syncToken || !this.config.sucursalId) {
      this.log.warn('Sincronización deshabilitada: falta CENTRAL_URL, SYNC_TOKEN o SUCURSAL_ID');
      return;
    }
    this.programar(2000);
    this.heartbeatTimer = setInterval(() => this.heartbeat().catch(() => undefined), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  private programar(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ciclo(), ms);
  }

  private async ciclo() {
    await this.sincronizar();
    const espera =
      this.fallos === 0
        ? this.config.syncIntervaloMs
        : Math.min(this.config.syncIntervaloMs * 2 ** this.fallos, BACKOFF_MAX_MS);
    this.programar(espera);
  }

  /** Ejecuta un ciclo completo (pull + push). Público para el botón "Sincronizar ahora". */
  async sincronizar(): Promise<boolean> {
    if (this.corriendo) return false;
    this.corriendo = true;
    try {
      await this.pull();
      await this.push();
      if (!this.online) this.log.log('Conexión con el central restablecida');
      this.online = true;
      this.fallos = 0;
      return true;
    } catch (e: any) {
      if (this.online || this.fallos === 0) this.log.warn(`Sin conexión con el central: ${e.message}`);
      this.online = false;
      this.fallos = Math.min(this.fallos + 1, 10);
      return false;
    } finally {
      this.corriendo = false;
    }
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.config.centralUrl}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-sucursal-id': this.config.sucursalId!,
        'x-sync-token': this.config.syncToken,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T;
  }

  private async push() {
    for (;;) {
      const lote = await this.prisma.syncOutbox.findMany({
        where: { enviadoEn: null },
        orderBy: { creadoEn: 'asc' },
        take: LOTE_PUSH,
      });
      if (!lote.length) break;
      const eventos: SyncEvento[] = lote.map((o) => ({
        id: o.id,
        entidad: o.entidad as SyncEvento['entidad'],
        entidadId: o.entidadId,
        operacion: 'UPSERT',
        payload: o.payload,
        creadoEn: o.creadoEn.toISOString(),
      }));
      const r = await this.request<SyncPushResponse>('POST', '/sync/push', {
        sucursalId: this.config.sucursalId,
        eventos,
      });
      if (r.aceptados.length) {
        await this.prisma.syncOutbox.updateMany({
          where: { id: { in: r.aceptados } },
          data: { enviadoEn: new Date(), ultimoError: null },
        });
      }
      for (const rech of r.rechazados) {
        await this.prisma.syncOutbox.update({
          where: { id: rech.id },
          data: { intentos: { increment: 1 }, ultimoError: rech.error },
        });
      }
      await this.estado.set(CLAVES.ULTIMO_PUSH, new Date().toISOString());
      // Si todo el lote fue rechazado, no insistir en este ciclo
      if (!r.aceptados.length || lote.length < LOTE_PUSH) break;
    }
  }

  private async pull() {
    for (let i = 0; i < 50; i++) {
      const cursor = (await this.estado.get(CLAVES.CURSOR_PULL)) ?? '';
      const r = await this.request<SyncPullResponse>(
        'GET',
        `/sync/pull?cursor=${encodeURIComponent(cursor)}`,
      );
      if (r.cambios.length) {
        await this.prisma.$transaction(
          async (tx) => {
            // Respetar el orden de dependencias
            for (const { tabla } of TABLAS_MAESTRAS) {
              const bloque = r.cambios.find((c) => c.tabla === tabla);
              if (!bloque) continue;
              // Filas nuevas por lotes (rápido con miles de productos); las existentes se actualizan una a una
              const delegado = (tx as any)[tabla];
              const ids = bloque.filas.map((f) => f.id);
              const existentes = new Set<string>(
                (await delegado.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((x: { id: string }) => x.id),
              );
              const nuevas = bloque.filas.filter((f) => !existentes.has(f.id as string)).map((f) => normalizarFila(tabla, f));
              if (nuevas.length) await delegado.createMany({ data: nuevas, skipDuplicates: true });
              for (const fila of bloque.filas) {
                if (existentes.has(fila.id as string)) await delegado.update({ where: { id: fila.id }, data: normalizarFila(tabla, fila) });
              }
            }
          },
          { timeout: 120_000 },
        );
        const total = r.cambios.reduce((s, c) => s + c.filas.length, 0);
        this.log.log(`Recibidos ${total} cambios de datos maestros`);
        // Imágenes nuevas (productos y logo): se descargan para que la caja las vea sin internet
        const imagenes: string[] = [];
        for (const c of r.cambios) {
          for (const f of c.filas as any[]) {
            if (c.tabla === 'producto' && f.imagen) imagenes.push(f.imagen);
            if (c.tabla === 'parametros' && f.datos?.marca?.logoId) imagenes.push(f.datos.marca.logoId);
          }
        }
        if (r.cambios.some((c) => c.tabla === 'parametros')) this.parametros.invalidar();
        if (imagenes.length) this.media.sincronizarFaltantes(imagenes).catch(() => undefined);
      }
      await this.estado.set(CLAVES.CURSOR_PULL, r.cursor);
      await this.estado.set(CLAVES.ULTIMO_PULL, new Date().toISOString());
      if (!r.hayMas) break;
    }
  }

  async heartbeat() {
    if (!this.config.isStore || !this.config.centralUrl) return;
    const cajas = await this.prisma.caja.findMany({
      where: { sucursalId: this.config.sucursalId!, deletedAt: null },
      select: { id: true, nombre: true },
    });
    const correlativos = await this.prisma.cajaCorrelativo.findMany({
      where: { cajaId: { in: cajas.map((c) => c.id) } },
    });
    const backup = await this.backupInfo();
    const data: HeartbeatDto = {
      sucursalId: this.config.sucursalId!,
      version: this.config.version,
      ventasPendientes: await this.prisma.syncOutbox.count({ where: { enviadoEn: null } }),
      ultimoSyncPush: await this.estado.get(CLAVES.ULTIMO_PUSH),
      ultimoSyncPull: await this.estado.get(CLAVES.ULTIMO_PULL),
      ultimoBackup: backup.fecha,
      ultimoBackupOk: backup.ok,
      erroresCaja24h: await this.logs.erroresUltimas24h(),
      cajas: cajas.map((c) => ({
        id: c.id,
        nombre: c.nombre,
        ultimaActividad: correlativos.find((x) => x.cajaId === c.id)?.ultimaActividad?.toISOString() ?? null,
      })),
    };
    await this.request('POST', '/sync/heartbeat', data);
  }

  async estadoActual(): Promise<EstadoSincronizacion> {
    return {
      modo: this.config.mode,
      online: this.config.isCentral ? true : this.online,
      ventasPendientes: this.config.isStore
        ? await this.prisma.syncOutbox.count({ where: { enviadoEn: null } })
        : 0,
      ultimoSyncPush: await this.estado.get(CLAVES.ULTIMO_PUSH),
      ultimoSyncPull: await this.estado.get(CLAVES.ULTIMO_PULL),
    };
  }
}
