import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('visor', {
  onUpdate: (cb: (estado: unknown) => void) => ipcRenderer.on('visor:update', (_e, estado) => cb(estado)),
});
