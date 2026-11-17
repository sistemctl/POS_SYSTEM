import { Module } from '@nestjs/common';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { ComprobanteProvider, TicketProvider } from '../comprobantes/comprobante.provider';
import { VentasController } from './ventas.controller';
import { VentasService } from './ventas.service';

@Module({
  imports: [CatalogoModule],
  controllers: [VentasController],
  // Para facturación electrónica: reemplazar TicketProvider por el provider del país
  providers: [VentasService, { provide: ComprobanteProvider, useClass: TicketProvider }],
  exports: [VentasService],
})
export class VentasModule {}
