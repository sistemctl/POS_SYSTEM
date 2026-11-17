import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PERMISOS } from '@pos/shared';
import type { HeartbeatDto, SyncPushRequest } from '@pos/shared';
import { Public, RequirePermission, SyncAuth, SyncSucursal } from '../common/decorators';
import { SyncCentralService } from './sync-central.service';
import { SyncStoreService } from './sync-store.service';

@Controller('sync')
export class SyncController {
  constructor(
    private readonly central: SyncCentralService,
    private readonly store: SyncStoreService,
  ) {}

  // ── Endpoints del central, llamados por los servidores de tienda ──

  @SyncAuth()
  @Post('push')
  push(@SyncSucursal() sucursalId: string, @Body() body: SyncPushRequest) {
    return this.central.recibir(sucursalId, body.eventos ?? []);
  }

  @SyncAuth()
  @Get('pull')
  pull(@Query('cursor') cursor?: string) {
    return this.central.cambios(cursor || undefined);
  }

  @SyncAuth()
  @Post('heartbeat')
  async heartbeat(@SyncSucursal() sucursalId: string, @Body() body: HeartbeatDto) {
    await this.central.heartbeat(sucursalId, body);
    return { ok: true };
  }

  // ── Endpoints para la UI ──

  /** Estado para el indicador online/offline de la caja (público: se muestra también en la pantalla de ingreso) */
  @Public()
  @Get('estado')
  estado() {
    return this.store.estadoActual();
  }

  @RequirePermission(PERMISOS.VENTA_CREAR)
  @Post('forzar')
  async forzar() {
    const ok = await this.store.sincronizar();
    return { ok, estado: await this.store.estadoActual() };
  }
}
