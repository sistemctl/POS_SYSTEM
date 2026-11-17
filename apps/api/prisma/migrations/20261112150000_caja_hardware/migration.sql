-- AlterTable: periféricos de la caja configurables desde la web (null = configuración local)
ALTER TABLE "Caja" ADD COLUMN     "hardware" JSONB;
