import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as path from 'path';
import { newId } from '@pos/shared';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { SyncStoreService } from '../sync/sync-store.service';

export type TipoBackup = 'PROGRAMADO' | 'CIERRE_TURNO' | 'MANUAL';

/**
 * Copias de seguridad de PostgreSQL con pg_dump (formato custom, restaurable con pg_restore).
 * - Diario a la hora BACKUP_HORA y tras cada cierre de turno.
 * - Copia a BACKUP_EXTERNAL_DIR (disco USB / NAS) para no depender de un solo disco.
 * - Retención de BACKUP_RETENCION_DIAS días.
 */
@Injectable()
export class BackupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Backup');
  private timer: NodeJS.Timeout | null = null;
  private enCurso: Promise<unknown> | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sync: SyncStoreService,
  ) {}

  onApplicationBootstrap() {
    this.sync.backupInfo = async () => {
      const u = await this.ultimo();
      return { fecha: u?.creadoEn.toISOString() ?? null, ok: u?.ok ?? null };
    };
    // Revisa cada 10 minutos si toca el backup diario
    this.timer = setInterval(() => this.revisarProgramado().catch((e) => this.log.error(e.message)), 10 * 60 * 1000);
    setTimeout(() => this.revisarProgramado().catch(() => undefined), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  ultimo() {
    return this.prisma.backup.findFirst({ orderBy: { creadoEn: 'desc' } });
  }

  listar() {
    return this.prisma.backup
      .findMany({ orderBy: { creadoEn: 'desc' }, take: 100 })
      .then((r) => r.map((b) => ({ ...b, tamano: b.tamano ? Number(b.tamano) : null })));
  }

  async estado() {
    const ultimoOk = await this.prisma.backup.findFirst({ where: { ok: true }, orderBy: { creadoEn: 'desc' } });
    const ultimo = await this.ultimo();
    const horas = ultimoOk ? (Date.now() - ultimoOk.creadoEn.getTime()) / 3_600_000 : null;
    const alertas: string[] = [];
    if (!ultimoOk) alertas.push('No existe ningún backup exitoso');
    else if (horas! > 24) alertas.push(`El último backup exitoso tiene ${Math.floor(horas!)} horas`);
    if (ultimo && !ultimo.ok) alertas.push(`El último backup falló: ${ultimo.error}`);
    if (!this.config.backupExternalDir) alertas.push('No hay carpeta externa configurada (BACKUP_EXTERNAL_DIR)');
    return {
      ultimoOk: ultimoOk ? { ...ultimoOk, tamano: ultimoOk.tamano ? Number(ultimoOk.tamano) : null } : null,
      ultimo: ultimo ? { ...ultimo, tamano: ultimo.tamano ? Number(ultimo.tamano) : null } : null,
      alertas,
      directorio: this.config.backupDir,
      directorioExterno: this.config.backupExternalDir,
    };
  }

  private async revisarProgramado() {
    const ahora = new Date();
    if (ahora.getHours() < this.config.backupHora) return;
    const inicioDia = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const hecho = await this.prisma.backup.findFirst({
      where: { tipo: 'PROGRAMADO', ok: true, creadoEn: { gte: inicioDia } },
    });
    if (!hecho) await this.ejecutar('PROGRAMADO');
  }

  async ejecutar(tipo: TipoBackup) {
    if (this.enCurso) return this.enCurso; // no correr dos pg_dump a la vez
    this.enCurso = this.realizar(tipo).finally(() => (this.enCurso = null));
    return this.enCurso;
  }

  private async realizar(tipo: TipoBackup) {
    const url = new URL(this.config.databaseUrl);
    const db = url.pathname.replace(/^\//, '');
    url.search = ''; // pg_dump no entiende ?schema=public
    const sello = new Date().toISOString().replace(/[:.]/g, '-');
    const archivo = path.join(this.config.backupDir, `${db}_${sello}_${tipo.toLowerCase()}.backup`);
    let copiaExterna: string | null = null;
    try {
      await fs.mkdir(this.config.backupDir, { recursive: true });
      await this.pgDump(url.toString(), archivo);
      const { size } = await fs.stat(archivo);
      if (this.config.backupExternalDir) {
        await fs.mkdir(this.config.backupExternalDir, { recursive: true });
        copiaExterna = path.join(this.config.backupExternalDir, path.basename(archivo));
        await fs.copyFile(archivo, copiaExterna);
      }
      await this.limpiar();
      this.log.log(`Backup ${tipo} OK: ${archivo} (${(size / 1048576).toFixed(1)} MB)`);
      return this.prisma.backup.create({
        data: { id: newId(), tipo, archivo, copiaExterna, tamano: BigInt(size), ok: true },
      });
    } catch (e: any) {
      this.log.error(`Backup ${tipo} falló: ${e.message}`);
      return this.prisma.backup.create({
        data: { id: newId(), tipo, archivo, copiaExterna, ok: false, error: String(e.message).slice(0, 1000) },
      });
    }
  }

  private pgDump(connUrl: string, archivo: string): Promise<void> {
    const exe = path.join(this.config.pgBin, process.platform === 'win32' ? 'pg_dump.exe' : 'pg_dump');
    return new Promise((resolve, reject) => {
      const p = spawn(exe, ['--format=custom', '--no-owner', `--file=${archivo}`, `--dbname=${connUrl}`], {
        windowsHide: true,
      });
      let err = '';
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('error', (e) => reject(new Error(`No se pudo ejecutar pg_dump (${exe}): ${e.message}`)));
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `pg_dump terminó con código ${code}`))));
    });
  }

  private async limpiar() {
    const limite = Date.now() - this.config.backupRetencionDias * 86_400_000;
    for (const dir of [this.config.backupDir, this.config.backupExternalDir]) {
      if (!dir) continue;
      const archivos = await fs.readdir(dir).catch(() => [] as string[]);
      for (const a of archivos) {
        if (!a.endsWith('.backup')) continue;
        const ruta = path.join(dir, a);
        const st = await fs.stat(ruta).catch(() => null);
        if (st && st.mtimeMs < limite) await fs.unlink(ruta).catch(() => undefined);
      }
    }
  }
}
