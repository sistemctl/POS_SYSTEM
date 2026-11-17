import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { SyncCentralService } from './sync-central.service';
import { SyncEstadoService } from './sync-estado.service';
import { SyncStoreService } from './sync-store.service';
import { SyncController } from './sync.controller';

@Global()
@Module({
  controllers: [SyncController],
  providers: [OutboxService, SyncEstadoService, SyncCentralService, SyncStoreService],
  exports: [OutboxService, SyncEstadoService, SyncStoreService],
})
export class SyncModule {}
