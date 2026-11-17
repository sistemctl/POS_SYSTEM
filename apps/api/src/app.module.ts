import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminModule } from './admin/admin.module';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { AuthModule } from './auth/auth.module';
import { BackupModule } from './backup/backup.module';
import { CatalogoModule } from './catalogo/catalogo.module';
import { Public } from './common/decorators';
import { SecurityGuard } from './common/security.guard';
import { AppConfig } from './config/app-config';
import { AppConfigModule } from './config/config.module';
import { InventarioModule } from './inventario/inventario.module';
import { LogsModule } from './logs/logs.module';
import { MediaModule } from './media/media.module';
import { ParametrosModule } from './parametros/parametros.module';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaService } from './prisma/prisma.service';
import { ReportesModule } from './reportes/reportes.module';
import { SyncModule } from './sync/sync.module';
import { TurnosModule } from './turnos/turnos.module';
import { VentasModule } from './ventas/ventas.module';

@Controller('health')
class HealthController {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Usado por la caja para verificar conexión con el servidor de tienda */
  @Public()
  @Get()
  async health() {
    let db = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = false;
    }
    return {
      ok: db,
      db,
      modo: this.config.mode,
      sucursalId: this.config.sucursalId,
      version: this.config.version,
      hora: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ParametrosModule,
    MediaModule,
    LogsModule,
    SyncModule,
    AuditoriaModule,
    AuthModule,
    BackupModule,
    CatalogoModule,
    VentasModule,
    TurnosModule,
    InventarioModule,
    ReportesModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SecurityGuard }],
})
export class AppModule {}
