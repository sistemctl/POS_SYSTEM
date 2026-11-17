import { Controller, Get, Global, Module, Post } from '@nestjs/common';
import { PERMISOS } from '@pos/shared';
import { RequirePermission } from '../common/decorators';
import { BackupService } from './backup.service';

@Controller('backups')
class BackupController {
  constructor(private readonly svc: BackupService) {}

  @RequirePermission(PERMISOS.BACKUP_GESTIONAR)
  @Get()
  listar() {
    return this.svc.listar();
  }

  @RequirePermission(PERMISOS.BACKUP_GESTIONAR)
  @Get('estado')
  estado() {
    return this.svc.estado();
  }

  @RequirePermission(PERMISOS.BACKUP_GESTIONAR)
  @Post()
  async ejecutar() {
    const r: any = await this.svc.ejecutar('MANUAL');
    return { ...r, tamano: r?.tamano ? Number(r.tamano) : null };
  }
}

@Global()
@Module({
  controllers: [BackupController],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
