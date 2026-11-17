import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ServerMode } from '@pos/shared';

/** Configuración tipada leída de las variables de entorno (.env.central / .env.store). */
@Injectable()
export class AppConfig {
  constructor(private readonly config: ConfigService) {}

  private str(key: string, def = ''): string {
    return (this.config.get<string>(key) ?? def).trim();
  }

  get mode(): ServerMode {
    const m = this.str('SERVER_MODE', 'central');
    if (m !== 'central' && m !== 'store') throw new Error(`SERVER_MODE inválido: ${m}`);
    return m;
  }
  get isCentral() {
    return this.mode === 'central';
  }
  get isStore() {
    return this.mode === 'store';
  }
  get port(): number {
    return Number(this.str('PORT', '3000'));
  }
  get databaseUrl() {
    return this.str('DATABASE_URL');
  }
  get jwtSecret() {
    const s = this.str('JWT_SECRET');
    if (s.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');
    return s;
  }
  /** Sucursal que atiende este servidor (null en un central que no vende). */
  get sucursalId(): string | null {
    return this.str('SUCURSAL_ID') || null;
  }
  get centralUrl() {
    return this.str('CENTRAL_URL').replace(/\/$/, '');
  }
  get syncToken() {
    return this.str('SYNC_TOKEN');
  }
  get syncIntervaloMs() {
    return Number(this.str('SYNC_INTERVALO_SEGUNDOS', '30')) * 1000;
  }
  get pgBin() {
    return this.str('PG_BIN', 'C:\\Program Files\\PostgreSQL\\18\\bin');
  }
  get backupDir() {
    return this.str('BACKUP_DIR', 'C:\\POS-backups');
  }
  get backupExternalDir() {
    return this.str('BACKUP_EXTERNAL_DIR') || null;
  }
  get backupRetencionDias() {
    return Number(this.str('BACKUP_RETENCION_DIAS', '30'));
  }
  get backupHora() {
    return Number(this.str('BACKUP_HORA', '23'));
  }
  get webDist() {
    return this.str('WEB_DIST') || null;
  }
  /** Carpeta de imágenes de productos y logo */
  get mediaDir() {
    return this.str('MEDIA_DIR') || `C:\\POS-media\\${this.mode}`;
  }
  /** Certificado .pfx opcional para servir HTTPS (necesario para usar la cámara del celular) */
  get httpsPfx() {
    return this.str('HTTPS_PFX') || null;
  }
  get httpsPassphrase() {
    return this.str('HTTPS_PASSPHRASE');
  }
  get version() {
    return process.env.npm_package_version ?? '0.1.0';
  }
}
