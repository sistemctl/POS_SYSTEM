import { app, BrowserWindow, dialog, ipcMain, Menu, screen } from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import * as path from 'path';
import type { TicketData } from '@pos/shared';
import {
  crearBalanza,
  crearEscaner,
  DatalogicCompartidaScale,
  type ConfigEscaner,
  type ScannerDriver,
  enviarImpresora,
  EscPos,
  COLUMNAS,
  listarPuertos,
  ticketEscPos,
  type ConfigBalanza,
  type ConfigImpresora,
  type LecturaPeso,
  type ScaleDriver,
} from '@pos/hardware';

interface ConfigHardware {
  impresora: ConfigImpresora;
  balanza: ConfigBalanza;
  /** Lector de códigos por puerto serie / USB-COM (los lectores tipo teclado no lo necesitan) */
  escaner: ConfigEscaner;
  visorCliente: boolean;
  kiosco: boolean;
  /** Servidor de tienda: también sirve las actualizaciones de la caja (/updates) */
  servidor?: string;
}

const DEFECTO: ConfigHardware = {
  impresora: { tipo: 'windows', ancho: 80, abrirCajon: true },
  balanza: { driver: 'ninguna', baudios: 9600 },
  escaner: { driver: 'ninguno', puerto: 'auto', baudios: 9600 },
  visorCliente: false,
  kiosco: false,
};

const rutaConfig = () => path.join(app.getPath('userData'), 'hardware.json');

function leerConfig(): ConfigHardware {
  try {
    if (existsSync(rutaConfig())) return { ...DEFECTO, ...JSON.parse(readFileSync(rutaConfig(), 'utf8')) };
  } catch {
    /* config corrupta: usar valores por defecto */
  }
  return { ...DEFECTO };
}

let config = DEFECTO;
let ventana: BrowserWindow | null = null;
let visor: BrowserWindow | null = null;
let balanza: ScaleDriver | null = null;
let escaner: ScannerDriver | null = null;
const suscriptoresPeso = new Set<Electron.WebContents>();

// ───────── Una sola instancia (evita dos cajas abiertas en la misma PC) ─────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (ventana) {
    if (ventana.isMinimized()) ventana.restore();
    ventana.focus();
  }
});

function urlWeb(hash = '') {
  const dev = process.env.POS_DEV_URL;
  if (dev) return `${dev}#${hash}`;
  const archivo = app.isPackaged
    ? path.join(process.resourcesPath, 'web', 'index.html')
    : path.join(__dirname, '..', '..', 'web', 'dist', 'index.html');
  return `file://${archivo.replace(/\\/g, '/')}#${hash}`;
}

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    kiosk: config.kiosco,
    fullscreen: config.kiosco,
    autoHideMenuBar: true,
    backgroundColor: '#f1f5f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  Menu.setApplicationMenu(null);
  ventana.loadURL(urlWeb('/'));
  ventana.once('ready-to-show', () => {
    ventana!.maximize();
    ventana!.show();
  });
  // Bloquear navegación a sitios externos
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://') && !(process.env.POS_DEV_URL && url.startsWith(process.env.POS_DEV_URL))) e.preventDefault();
  });
  ventana.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // En modo kiosco evitar cerrar con Alt+F4
  ventana.on('close', (e) => {
    if (config.kiosco) e.preventDefault();
  });
  ventana.on('closed', () => {
    ventana = null;
    visor?.destroy();
  });
}

/** Visor de cliente en el segundo monitor */
function actualizarVisorVentana() {
  const pantallas = screen.getAllDisplays();
  const secundaria = pantallas.find((d) => d.id !== screen.getPrimaryDisplay().id);
  if (!config.visorCliente || !secundaria) {
    visor?.destroy();
    visor = null;
    return;
  }
  if (visor) return;
  visor = new BrowserWindow({
    x: secundaria.bounds.x,
    y: secundaria.bounds.y,
    width: secundaria.bounds.width,
    height: secundaria.bounds.height,
    fullscreen: true,
    frame: false,
    focusable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-visor.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  visor.loadURL(urlWeb('/visor'));
  visor.on('closed', () => (visor = null));
}

/** Balanza del Magellan por el mismo cable que el escáner (puerto 'escaner'): no abre un COM propio */
const balanzaCompartida = () => config.balanza.driver === 'datalogic' && config.balanza.puerto === 'escaner';

/** Llamar después de reiniciarEscaner(): la balanza compartida usa la conexión del escáner actual */
async function reiniciarBalanza() {
  await balanza?.cerrar().catch(() => undefined);
  if (balanzaCompartida()) {
    balanza = escaner && config.escaner.driver === 'datalogic' ? new DatalogicCompartidaScale(escaner) : null;
  } else {
    balanza = crearBalanza(config.balanza);
  }
  balanza?.on('peso', (l: LecturaPeso) => {
    for (const wc of suscriptoresPeso) if (!wc.isDestroyed()) wc.send('scale:weight', l);
  });
}

let ultimoErrorEscaner = '';

async function reiniciarEscaner() {
  await escaner?.cerrar().catch(() => undefined);
  escaner = crearEscaner(config.escaner);
  if (!escaner) return;
  escaner.on('codigo', (codigo: string) => {
    ultimoErrorEscaner = '';
    if (ventana && !ventana.isDestroyed()) ventana.webContents.send('scanner:code', codigo);
  });
  escaner.on('error', (e: Error) => {
    // No repetir el mismo aviso en cada reintento
    if (e.message === ultimoErrorEscaner) return;
    ultimoErrorEscaner = e.message;
    if (ventana && !ventana.isDestroyed()) ventana.webContents.send('scanner:error', e.message);
  });
  escaner.iniciar();
}

function configurarActualizaciones() {
  if (!app.isPackaged || !config.servidor) return;
  // Las cajas se actualizan desde el servidor de la tienda (sin internet): http://servidor:3001/updates/
  autoUpdater.setFeedURL({ provider: 'generic', url: `${config.servidor.replace(/\/$/, '')}/updates/` });
  autoUpdater.autoDownload = true;
  autoUpdater.on('update-downloaded', async (info) => {
    const r = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Reiniciar ahora', 'Más tarde'],
      message: `Hay una nueva versión (${info.version}). Se instalará al reiniciar.`,
    });
    if (r.response === 0) {
      config.kiosco = false;
      autoUpdater.quitAndInstall();
    }
  });
  autoUpdater.checkForUpdates().catch(() => undefined);
  setInterval(() => autoUpdater.checkForUpdates().catch(() => undefined), 60 * 60 * 1000);
}

// ───────── IPC: hardware ─────────
function registrarIpc() {
  ipcMain.handle('printer:ticket', async (_e, t: TicketData, opts: { moneda: string }) => {
    const abrirCajon = config.impresora.abrirCajon && t.pagos.some((p) => p.metodo === 'Efectivo') && !t.reimpresion;
    await enviarImpresora(config.impresora, ticketEscPos(t, { ancho: config.impresora.ancho, moneda: opts.moneda, abrirCajon }));
  });
  ipcMain.handle('printer:text', async (_e, texto: string) => {
    const p = new EscPos(COLUMNAS[config.impresora.ancho]);
    p.linea(texto).avanzar(4).cortar();
    await enviarImpresora(config.impresora, p.buffer());
  });
  ipcMain.handle('printer:list', async () => {
    const lista = (await ventana?.webContents.getPrintersAsync()) ?? [];
    return lista.map((p) => ({ name: p.name, isDefault: p.isDefault }));
  });
  ipcMain.handle('drawer:open', async () => {
    if (config.impresora.tipo === 'ninguna') return;
    await enviarImpresora(config.impresora, new EscPos(COLUMNAS[config.impresora.ancho]).abrirCajon().buffer());
  });
  ipcMain.handle('scale:read', async () => {
    if (!balanza && balanzaCompartida()) throw new Error('La balanza usa el cable del escáner: configure el escáner como Datalogic Magellan');
    if (!balanza) throw new Error('No hay balanza configurada');
    return balanza.leer();
  });
  ipcMain.on('scale:subscribe', async (e) => {
    suscriptoresPeso.add(e.sender);
    try {
      await balanza?.conectar();
    } catch (err: any) {
      e.sender.send('scale:error', err.message);
    }
  });
  ipcMain.on('scale:unsubscribe', (e) => suscriptoresPeso.delete(e.sender));
  ipcMain.handle('scale:ports', () => listarPuertos());
  ipcMain.on('display:update', (_e, estado: unknown) => {
    if (visor && !visor.isDestroyed()) visor.webContents.send('visor:update', estado);
  });
  ipcMain.handle('config:get', () => config);
  ipcMain.handle('config:set', async (_e, c: ConfigHardware) => {
    config = { ...config, ...c };
    writeFileSync(rutaConfig(), JSON.stringify(config, null, 2));
    await reiniciarEscaner();
    await reiniciarBalanza();
    ventana?.setKiosk(config.kiosco);
    actualizarVisorVentana();
  });
  ipcMain.handle('app:setKiosk', (_e, on: boolean) => {
    config.kiosco = on;
    writeFileSync(rutaConfig(), JSON.stringify(config, null, 2));
    ventana?.setKiosk(on);
  });
  // La web valida el permiso kiosco.salir antes de llamar
  ipcMain.handle('app:exitKiosk', () => {
    config.kiosco = false;
    ventana?.setKiosk(false);
  });
  ipcMain.handle('app:quit', () => {
    config.kiosco = false;
    app.quit();
  });
}

app.whenReady().then(async () => {
  config = leerConfig();
  registrarIpc();
  crearVentana();
  await reiniciarEscaner();
  await reiniciarBalanza();
  actualizarVisorVentana();
  screen.on('display-added', actualizarVisorVentana);
  screen.on('display-removed', actualizarVisorVentana);
  configurarActualizaciones();
});

app.on('window-all-closed', async () => {
  await balanza?.cerrar().catch(() => undefined);
  await escaner?.cerrar().catch(() => undefined);
  app.quit();
});
