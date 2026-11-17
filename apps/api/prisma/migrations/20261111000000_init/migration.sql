-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Sucursal" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "ruc" TEXT,
    "telefono" TEXT,
    "pieTicket" TEXT,
    "configBalanza" JSONB,
    "syncTokenHash" TEXT,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Sucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Caja" (
    "id" UUID NOT NULL,
    "sucursalId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "serie" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Caja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rol" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "permisos" TEXT[],
    "descuentoMaximo" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "retiroMaximo" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Rol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "usuario" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "codigoTarjeta" TEXT,
    "foto" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioRol" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "rolId" UUID NOT NULL,
    "sucursalId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UsuarioRol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categoria" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "color" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Categoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Producto" (
    "id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "categoriaId" UUID,
    "unidad" TEXT NOT NULL DEFAULT 'UND',
    "pesable" BOOLEAN NOT NULL DEFAULT false,
    "plu" TEXT,
    "precio" DECIMAL(12,2) NOT NULL,
    "costo" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "tasaImpuesto" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "stockMinimo" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "imagen" TEXT,
    "color" TEXT,
    "favorito" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Producto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductoCodigo" (
    "id" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ProductoCodigo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrecioSucursal" (
    "id" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "sucursalId" UUID NOT NULL,
    "precio" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "PrecioSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Promocion" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "productoIds" TEXT[],
    "porcentaje" DECIMAL(5,2),
    "llevar" INTEGER,
    "pagar" INTEGER,
    "cantidadMinima" DECIMAL(12,3),
    "precioPromo" DECIMAL(12,2),
    "sucursalId" UUID,
    "desde" TIMESTAMP(3),
    "hasta" TIMESTAMP(3),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Promocion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" UUID NOT NULL,
    "tipoDocumento" TEXT NOT NULL DEFAULT 'DNI',
    "numeroDocumento" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "direccion" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurnoCaja" (
    "id" UUID NOT NULL,
    "sucursalId" UUID NOT NULL,
    "cajaId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'ABIERTO',
    "abiertoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cerradoEn" TIMESTAMP(3),
    "montoInicial" DECIMAL(12,2) NOT NULL,
    "montoCierreDeclarado" DECIMAL(12,2),
    "montoCierreEsperado" DECIMAL(12,2),
    "diferencia" DECIMAL(12,2),
    "resumen" JSONB,
    "cerradoPorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TurnoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoCaja" (
    "id" UUID NOT NULL,
    "turnoId" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "usuarioId" UUID NOT NULL,
    "autorizadoPorId" UUID,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoCaja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venta" (
    "id" UUID NOT NULL,
    "sucursalId" UUID NOT NULL,
    "cajaId" UUID NOT NULL,
    "turnoId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "clienteId" UUID,
    "tipoComprobante" TEXT NOT NULL DEFAULT 'TICKET',
    "serie" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "numeroCompleto" TEXT NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "impuesto" DECIMAL(12,2) NOT NULL,
    "descuento" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "pagado" DECIMAL(12,2) NOT NULL,
    "vuelto" DECIMAL(12,2) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'COMPLETADA',
    "anuladaEn" TIMESTAMP(3),
    "anuladaPorId" UUID,
    "motivoAnulacion" TEXT,
    "estadoEnvio" TEXT NOT NULL DEFAULT 'NO_APLICA',
    "respuestaEnvio" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaDetalle" (
    "id" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "descripcion" TEXT NOT NULL,
    "unidad" TEXT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "precioUnitario" DECIMAL(12,2) NOT NULL,
    "precioLista" DECIMAL(12,2) NOT NULL,
    "costoUnitario" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "descuentoPromocion" DECIMAL(12,2) NOT NULL,
    "descuentoManual" DECIMAL(12,2) NOT NULL,
    "baseImponible" DECIMAL(12,2) NOT NULL,
    "impuesto" DECIMAL(12,2) NOT NULL,
    "tasaImpuesto" DECIMAL(5,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "promocionId" UUID,

    CONSTRAINT "VentaDetalle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaPago" (
    "id" UUID NOT NULL,
    "ventaId" UUID NOT NULL,
    "metodo" TEXT NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "referencia" TEXT,

    CONSTRAINT "VentaPago_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MovimientoInventario" (
    "id" UUID NOT NULL,
    "sucursalId" UUID NOT NULL,
    "productoId" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "cantidad" DECIMAL(12,3) NOT NULL,
    "costoUnitario" DECIMAL(12,4),
    "referenciaId" UUID,
    "motivo" TEXT,
    "usuarioId" UUID NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimientoInventario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Auditoria" (
    "id" UUID NOT NULL,
    "sucursalId" UUID,
    "usuarioId" UUID,
    "autorizadoPorId" UUID,
    "accion" TEXT NOT NULL,
    "entidad" TEXT,
    "entidadId" TEXT,
    "detalle" JSONB,
    "motivo" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CajaCorrelativo" (
    "cajaId" UUID NOT NULL,
    "ultimoNumero" INTEGER NOT NULL DEFAULT 0,
    "ultimaActividad" TIMESTAMP(3),

    CONSTRAINT "CajaCorrelativo_pkey" PRIMARY KEY ("cajaId")
);

-- CreateTable
CREATE TABLE "Autorizacion" (
    "id" UUID NOT NULL,
    "supervisorId" UUID NOT NULL,
    "solicitanteId" UUID NOT NULL,
    "permiso" TEXT NOT NULL,
    "motivo" TEXT,
    "usadaEn" TIMESTAMP(3),
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Autorizacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VentaBorrador" (
    "cajaId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VentaBorrador_pkey" PRIMARY KEY ("cajaId")
);

-- CreateTable
CREATE TABLE "VentaSuspendida" (
    "id" UUID NOT NULL,
    "cajaId" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "etiqueta" TEXT,
    "data" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VentaSuspendida_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncOutbox" (
    "id" UUID NOT NULL,
    "entidad" TEXT NOT NULL,
    "entidadId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEn" TIMESTAMP(3),
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "ultimoError" TEXT,

    CONSTRAINT "SyncOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRecibido" (
    "id" UUID NOT NULL,
    "sucursalId" UUID NOT NULL,
    "entidad" TEXT NOT NULL,
    "recibidoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRecibido_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncEstado" (
    "clave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncEstado_pkey" PRIMARY KEY ("clave")
);

-- CreateTable
CREATE TABLE "SucursalEstado" (
    "sucursalId" UUID NOT NULL,
    "data" JSONB NOT NULL,
    "ultimoHeartbeat" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SucursalEstado_pkey" PRIMARY KEY ("sucursalId")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" UUID NOT NULL,
    "tipo" TEXT NOT NULL,
    "archivo" TEXT,
    "copiaExterna" TEXT,
    "tamano" BIGINT,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Configuracion" (
    "clave" TEXT NOT NULL,
    "valor" JSONB NOT NULL,

    CONSTRAINT "Configuracion_pkey" PRIMARY KEY ("clave")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sucursal_codigo_key" ON "Sucursal"("codigo");

-- CreateIndex
CREATE INDEX "Sucursal_updatedAt_id_idx" ON "Sucursal"("updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Caja_serie_key" ON "Caja"("serie");

-- CreateIndex
CREATE INDEX "Caja_updatedAt_id_idx" ON "Caja"("updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Caja_sucursalId_codigo_key" ON "Caja"("sucursalId", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Rol_codigo_key" ON "Rol"("codigo");

-- CreateIndex
CREATE INDEX "Rol_updatedAt_id_idx" ON "Rol"("updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_usuario_key" ON "Usuario"("usuario");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_codigoTarjeta_key" ON "Usuario"("codigoTarjeta");

-- CreateIndex
CREATE INDEX "Usuario_updatedAt_id_idx" ON "Usuario"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "UsuarioRol_updatedAt_id_idx" ON "UsuarioRol"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "UsuarioRol_usuarioId_idx" ON "UsuarioRol"("usuarioId");

-- CreateIndex
CREATE INDEX "Categoria_updatedAt_id_idx" ON "Categoria"("updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_sku_key" ON "Producto"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "Producto_plu_key" ON "Producto"("plu");

-- CreateIndex
CREATE INDEX "Producto_updatedAt_id_idx" ON "Producto"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "Producto_nombre_idx" ON "Producto"("nombre");

-- CreateIndex
CREATE INDEX "ProductoCodigo_codigo_idx" ON "ProductoCodigo"("codigo");

-- CreateIndex
CREATE INDEX "ProductoCodigo_updatedAt_id_idx" ON "ProductoCodigo"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "PrecioSucursal_updatedAt_id_idx" ON "PrecioSucursal"("updatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PrecioSucursal_productoId_sucursalId_key" ON "PrecioSucursal"("productoId", "sucursalId");

-- CreateIndex
CREATE INDEX "Promocion_updatedAt_id_idx" ON "Promocion"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "Cliente_numeroDocumento_idx" ON "Cliente"("numeroDocumento");

-- CreateIndex
CREATE INDEX "TurnoCaja_cajaId_estado_idx" ON "TurnoCaja"("cajaId", "estado");

-- CreateIndex
CREATE INDEX "TurnoCaja_sucursalId_abiertoEn_idx" ON "TurnoCaja"("sucursalId", "abiertoEn");

-- CreateIndex
CREATE INDEX "Venta_sucursalId_fecha_idx" ON "Venta"("sucursalId", "fecha");

-- CreateIndex
CREATE INDEX "Venta_turnoId_idx" ON "Venta"("turnoId");

-- CreateIndex
CREATE UNIQUE INDEX "Venta_serie_numero_key" ON "Venta"("serie", "numero");

-- CreateIndex
CREATE INDEX "VentaDetalle_productoId_idx" ON "VentaDetalle"("productoId");

-- CreateIndex
CREATE INDEX "MovimientoInventario_sucursalId_productoId_idx" ON "MovimientoInventario"("sucursalId", "productoId");

-- CreateIndex
CREATE INDEX "MovimientoInventario_referenciaId_idx" ON "MovimientoInventario"("referenciaId");

-- CreateIndex
CREATE INDEX "Auditoria_sucursalId_creadoEn_idx" ON "Auditoria"("sucursalId", "creadoEn");

-- CreateIndex
CREATE INDEX "Auditoria_accion_idx" ON "Auditoria"("accion");

-- CreateIndex
CREATE INDEX "VentaSuspendida_cajaId_idx" ON "VentaSuspendida"("cajaId");

-- CreateIndex
CREATE INDEX "SyncOutbox_enviadoEn_creadoEn_idx" ON "SyncOutbox"("enviadoEn", "creadoEn");

-- AddForeignKey
ALTER TABLE "Caja" ADD CONSTRAINT "Caja_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioRol" ADD CONSTRAINT "UsuarioRol_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioRol" ADD CONSTRAINT "UsuarioRol_rolId_fkey" FOREIGN KEY ("rolId") REFERENCES "Rol"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioRol" ADD CONSTRAINT "UsuarioRol_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductoCodigo" ADD CONSTRAINT "ProductoCodigo_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecioSucursal" ADD CONSTRAINT "PrecioSucursal_productoId_fkey" FOREIGN KEY ("productoId") REFERENCES "Producto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecioSucursal" ADD CONSTRAINT "PrecioSucursal_sucursalId_fkey" FOREIGN KEY ("sucursalId") REFERENCES "Sucursal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MovimientoCaja" ADD CONSTRAINT "MovimientoCaja_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "TurnoCaja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_turnoId_fkey" FOREIGN KEY ("turnoId") REFERENCES "TurnoCaja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Venta" ADD CONSTRAINT "Venta_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaDetalle" ADD CONSTRAINT "VentaDetalle_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VentaPago" ADD CONSTRAINT "VentaPago_ventaId_fkey" FOREIGN KEY ("ventaId") REFERENCES "Venta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
