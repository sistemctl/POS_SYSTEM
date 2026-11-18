# POS Supermercado

Punto de venta multi-sucursal, offline-first, con pantalla táctil y roles.
React + TypeScript (web) · Electron (.exe) · NestJS · PostgreSQL nativo (sin Docker, sin nube).

```
SERVIDOR CENTRAL (oficina)  ◄── REST/VPN ──►  SERVIDOR DE TIENDA (LAN)  ◄──►  Cajas (.exe)
NestJS modo central + PG                       NestJS modo store + PG
```
Si se cae internet, la tienda sigue vendiendo con su base local; las ventas se suben solas al volver.

## Estructura
| Carpeta | Contenido |
|---|---|
| `packages/shared` | Precios/impuestos/promociones, códigos de balanza, permisos y tipos (usado por API y caja) |
| `packages/hardware` | Impresora ESC/POS (Windows o red), cajón, balanzas (genérica, Toledo, CAS, simulada) |
| `apps/api` | NestJS + Prisma. `SERVER_MODE=central\|store` |
| `apps/web` | React táctil: caja y administración |
| `apps/desktop` | Electron: kiosco, hardware, visor de cliente, auto-actualización |
| `scripts` | `setup-db.ps1`, `restore-db.ps1` |

## Desarrollo (Windows)
Requisitos: Node.js LTS, pnpm (`npm i -g pnpm`), PostgreSQL 18 instalado nativamente.

```powershell
pnpm install
powershell -ExecutionPolicy Bypass -File scripts\setup-db.ps1 -SuperPassword "<clave postgres>"
cd apps\api
pnpm db:deploy:central; pnpm db:deploy:store; pnpm db:seed
pnpm dev:central      # :3000  (otra terminal)
pnpm dev:store        # :3001  (otra terminal)
cd ..\web; pnpm dev   # http://localhost:5173
cd ..\desktop; pnpm dev   # caja Electron apuntando a Vite
```

Usuarios demo: `admin/admin123` · `gerente/gerente123` · `supervisor/super123` (PIN 2222, tarjeta SUP-0001) · `cajero1/cajero123` (PIN 1111) · `almacen/almacen123`.

## Roles
Cajero, Supervisor de caja, Almacén, Administrador de tienda, Administrador general (editables en Administración → Roles).
Si un cajero intenta algo sin permiso (descuento, cambio de precio, quitar producto, anular, retiro) aparece el modal
para que un supervisor ingrese su PIN o escanee su tarjeta; queda registrado en Auditoría.

## Configuración del sistema (Administración → Configuración del sistema)
Se edita en el **servidor central** y llega a todas las tiendas por sincronización:
- **Regional e impuestos**: país (Colombia, Perú, México, Ecuador, Chile o personalizado), moneda, decimales (0 o 2), separadores, NIT/RUC/RFC, lista de impuestos (IVA 19 %, 5 %, exento…).
- **Marca**: nombre comercial, logo y colores (la caja cambia de color al instante).
- **Ticket**: encabezado, pie, logo impreso, QR, copias, con vista previa.
- **Caja**: billetes de cobro rápido, formas de pago, inactividad, venta sin stock.
- **Pantalla de caja**: orden y color de categorías, columnas, tamaño de botones y favoritos.
La primera vez que entra el administrador general aparece un asistente de 3 pasos.

## Carga de productos
- **Excel / CSV** (Productos → Importar): descargue la plantilla o use su propio archivo. Primero se muestra una vista previa
  con errores por fila (no guarda nada); luego se importa con barra de progreso. Modos: crear y actualizar, solo crear, solo precios.
  **Exportar catálogo** → editar en Excel → reimportar = cambio masivo de precios.
- **Escaneando en la tienda** (Productos → Escanear productos): lector USB/Bluetooth o cámara del celular.
  Si el código existe muestra el producto; si no, pide nombre y precio. Enter = guardar y siguiente.
  La cámara requiere HTTPS: `scripts\crear-certificado.ps1 -Direcciones <IP del central> -Clave <clave>` y en el `.env`
  `HTTPS_PFX=...` / `HTTPS_PASSPHRASE=...`.
- Probado con 15.000 productos: importación ~40 s, sincronización a la tienda ~15 s, búsqueda en caja < 10 ms.
  La caja guarda el catálogo en el equipo (arranque instantáneo) y cada 5 min descarga solo los cambios.
- Las imágenes se guardan como archivos en `MEDIA_DIR` (por defecto `C:\POS-media\<modo>`); la tienda las descarga del central.

## Errores de caja
Todo error que ve el cajero queda registrado en el servidor de la tienda (Administración → Errores de caja) y el panel
«Estado de sucursales» avisa cuántos hubo en las últimas 24 h.

## Atajos de la caja
F1 buscar · F2 cantidad · F3 ayuda · F4 pesar · F5 más opciones · F6 en espera · F7 recuperar · F8 descuento · F9 quitar · F10 cobrar · F11 ventas · F12 cerrar turno.

La barra de la caja muestra solo lo de cada venta (Buscar, Cantidad, Quitar, En espera/Recuperar, COBRAR);
descuento, cambio de precio, reimprimir, cajón, retiros, ventas del turno y cancelar venta están en **Más opciones**.
Cobro rápido: si el primer pago en efectivo (billete o «Pago exacto») o con tarjeta/Nequi cubre el total, la venta se
registra en ese mismo toque. Pagos combinados y montos escritos a mano se confirman con «Finalizar venta».

## Producción
1. **Servidor central**: PostgreSQL + `setup-db.ps1 -Modo central`, `.env.central`, API como servicio de Windows
   (NSSM: `nssm install POS-API "C:\Program Files\nodejs\node.exe" "C:\POS\apps\api\dist\main.js"` con `ENV_FILE`).
   En la web: Sucursales → crear sucursal y cajas → **Generar token sync**.
2. **Servidor de tienda**: igual con `-Modo store`; en `.env.store` poner `SUCURSAL_ID`, `SYNC_TOKEN` y `CENTRAL_URL` (IP de la VPN WireGuard/Tailscale).
   Configurar `BACKUP_EXTERNAL_DIR` (disco USB/NAS).
3. **Cajas**: instalar `apps/desktop/release/POS-Supermercado-Setup-x.y.z.exe`, en la primera pantalla poner la IP del servidor de tienda y elegir la caja.
   Actualizaciones: copiar `latest.yml` y el instalador nuevo a la carpeta `UPDATES_DIR` del servidor de tienda.

Generar instalador: `cd apps\desktop; pnpm dist`.

**Actualizar el servidor** tras cambios de código (como Administrador): `scripts\actualizar-servidor.ps1`
(detiene servicios, migra ambas bases, compila API y web y vuelve a arrancar).

## Hardware de las cajas desde la web
Administración → Sucursales y cajas → (caja) → «Configurar impresora, balanza y escáner desde aquí».
La caja descarga su configuración al arrancar y cada 2 minutos; en la caja esos campos quedan bloqueados.
El servidor y el modo kiosco se siguen configurando en cada equipo.
Escáneres soportados: tipo teclado (sin configuración) o por puerto serie / USB COM (Datalogic Magellan, puerto «Automático»).

## Backups / restauración
Automáticos diarios (`BACKUP_HORA`) y en cada cierre de turno, retención `BACKUP_RETENCION_DIAS`.
Restaurar: `scripts\restore-db.ps1 -Archivo <.backup> -BaseDatos pos_store -SuperPassword <clave> -Confirmar` (detener antes la API).
