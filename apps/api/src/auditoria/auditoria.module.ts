import { Controller, Get, Global, Module, Query } from '@nestjs/common';
import { PERMISOS } from '@pos/shared';
import { CurrentUser, JwtUser, RequirePermission } from '../common/decorators';
import { AuditoriaService } from './auditoria.service';

@Controller('auditoria')
class AuditoriaController {
  constructor(private readonly svc: AuditoriaService) {}

  @RequirePermission(PERMISOS.REPORTE_SUCURSAL)
  @Get()
  listar(
    @CurrentUser() user: JwtUser,
    @Query('accion') accion?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('sucursalId') sucursalId?: string,
  ) {
    return this.svc.listar({
      sucursalId: user.sucursalId ?? sucursalId,
      accion: accion || undefined,
      desde: desde ? new Date(desde) : undefined,
      hasta: hasta ? new Date(hasta) : undefined,
    });
  }
}

@Global()
@Module({
  controllers: [AuditoriaController],
  providers: [AuditoriaService],
  exports: [AuditoriaService],
})
export class AuditoriaModule {}
