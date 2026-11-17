import { contextBridge, ipcRenderer } from 'electron';

/** API segura expuesta a la web como window.pos (sin acceso directo a Node). */
contextBridge.exposeInMainWorld('pos', {
  esElectron: true,
  version: process.env.npm_package_version ?? '',
  printer: {
    printTicket: (t: unknown, opciones: unknown) => ipcRenderer.invoke('printer:ticket', t, opciones),
    printText: (texto: string) => ipcRenderer.invoke('printer:text', texto),
    list: () => ipcRenderer.invoke('printer:list'),
  },
  drawer: {
    open: () => ipcRenderer.invoke('drawer:open'),
  },
  scale: {
    read: () => ipcRenderer.invoke('scale:read'),
    onWeight: (cb: (d: unknown) => void) => {
      const h = (_e: unknown, d: unknown) => cb(d);
      ipcRenderer.on('scale:weight', h);
      ipcRenderer.send('scale:subscribe');
      return () => {
        ipcRenderer.removeListener('scale:weight', h);
        ipcRenderer.send('scale:unsubscribe');
      };
    },
    listPorts: () => ipcRenderer.invoke('scale:ports'),
  },
  scanner: {
    /** Códigos leídos por un escáner serie/USB-COM (p. ej. Datalogic Magellan) */
    onCode: (cb: (codigo: string) => void) => {
      const h = (_e: unknown, c: string) => cb(c);
      ipcRenderer.on('scanner:code', h);
      return () => ipcRenderer.removeListener('scanner:code', h);
    },
    onError: (cb: (mensaje: string) => void) => {
      const h = (_e: unknown, m: string) => cb(m);
      ipcRenderer.on('scanner:error', h);
      return () => ipcRenderer.removeListener('scanner:error', h);
    },
  },
  display: {
    update: (estado: unknown) => ipcRenderer.send('display:update', estado),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (c: unknown) => ipcRenderer.invoke('config:set', c),
  },
  app: {
    exitKiosk: () => ipcRenderer.invoke('app:exitKiosk'),
    setKiosk: (on: boolean) => ipcRenderer.invoke('app:setKiosk', on),
    quit: () => ipcRenderer.invoke('app:quit'),
  },
});
