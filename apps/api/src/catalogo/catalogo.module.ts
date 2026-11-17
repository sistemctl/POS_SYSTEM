import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo.controller';
import { CatalogoService } from './catalogo.service';
import { ImportacionService } from './importacion.service';

@Module({
  controllers: [CatalogoController],
  providers: [CatalogoService, ImportacionService],
  exports: [CatalogoService],
})
export class CatalogoModule {}
