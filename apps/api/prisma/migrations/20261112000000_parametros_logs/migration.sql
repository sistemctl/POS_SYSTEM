-- AlterTable
ALTER TABLE "Producto" ADD COLUMN     "impuestoCodigo" TEXT;

-- DropTable
DROP TABLE "Configuracion";

-- CreateTable
CREATE TABLE "Parametros" (
    "id" UUID NOT NULL,
    "datos" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Parametros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogCliente" (
    "id" UUID NOT NULL,
    "nivel" TEXT NOT NULL,
    "mensaje" TEXT NOT NULL,
    "detalle" TEXT,
    "pantalla" TEXT,
    "version" TEXT,
    "cajaId" UUID,
    "usuarioId" UUID,
    "equipo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogCliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Parametros_updatedAt_id_idx" ON "Parametros"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "LogCliente_creadoEn_idx" ON "LogCliente"("creadoEn");


-- Nuevo permiso de configuracion del sistema para el Administrador general
UPDATE "Rol" SET "permisos" = array_append("permisos", 'config.gestionar'), "updatedAt" = CURRENT_TIMESTAMP
WHERE "codigo" = 'ADMIN_GENERAL' AND NOT ('config.gestionar' = ANY("permisos"));
