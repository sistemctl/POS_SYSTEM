import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

export interface ConfigImpresora {
  tipo: 'windows' | 'red' | 'serie' | 'ninguna';
  /** Nombre de la impresora en Windows (vacío = predeterminada) */
  nombre?: string;
  host?: string;
  puerto?: number;
  /** Puerto COM (tipo 'serie': térmicas USB que se instalan como puerto serie virtual) */
  com?: string;
  baudios?: number;
  ancho: 58 | 80;
  abrirCajon: boolean;
}

/** Envía bytes ESC/POS a una impresora de red (puerto 9100, RAW). */
export function enviarRed(host: string, puerto: number, datos: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port: puerto, timeout: 5000 }, () => {
      s.end(datos, () => resolve());
    });
    s.on('timeout', () => {
      s.destroy();
      reject(new Error(`Tiempo agotado conectando a ${host}:${puerto}`));
    });
    s.on('error', (e) => reject(new Error(`Impresora de red: ${e.message}`)));
  });
}

/**
 * Impresión RAW por el spooler de Windows (sin módulos nativos):
 * usa la API winspool.drv desde PowerShell. Funciona con cualquier térmica instalada con su driver
 * (o con el driver "Generic / Text Only").
 */
const PS_RAW = `
param([string]$Printer, [string]$Data)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class RawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] public static extern int StartDocPrinter(IntPtr h, int l, DOCINFO di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static void Send(string printer, byte[] data) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("No se pudo abrir la impresora " + printer);
    try {
      var di = new DOCINFO { pDocName = "Ticket POS", pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter fallo");
      StartPagePrinter(h); int w; WritePrinter(h, data, data.Length, out w); EndPagePrinter(h); EndDocPrinter(h);
    } finally { ClosePrinter(h); }
  }
}
"@
if (-not $Printer) { $Printer = (Get-CimInstance Win32_Printer | Where-Object Default).Name }
[RawPrinter]::Send($Printer, [IO.File]::ReadAllBytes($Data))
`;

let scriptPath: string | null = null;

export async function enviarWindows(nombre: string | undefined, datos: Buffer): Promise<void> {
  if (process.platform !== 'win32') throw new Error('La impresión RAW por spooler solo está disponible en Windows');
  const dir = path.join(os.tmpdir(), 'pos-print');
  await fs.mkdir(dir, { recursive: true });
  if (!scriptPath) {
    scriptPath = path.join(dir, 'raw-print.ps1');
    await fs.writeFile(scriptPath, PS_RAW, 'utf8');
  }
  const archivo = path.join(dir, `ticket-${Date.now()}-${Math.random().toString(36).slice(2)}.bin`);
  await fs.writeFile(archivo, datos);
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath!, '-Printer', nombre ?? '', '-Data', archivo],
        { windowsHide: true },
      );
      let err = '';
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `Error de impresión (${code})`))));
    });
  } finally {
    fs.unlink(archivo).catch(() => undefined);
  }
}

/**
 * Envía bytes ESC/POS por puerto serie (USB-COM o RS-232). Muchas térmicas genéricas
 * (chip STM32, VID 0483) se instalan como "Dispositivo serie USB" sin cola de Windows.
 *
 * Se escribe el puerto como archivo (\\.\COMn) en lugar de usar el módulo `serialport`:
 * con estas impresoras la escritura de `serialport` no termina nunca (no levantan CTS/DSR).
 * La velocidad se fija con `mode` de Windows (irrelevante en USB-COM, necesaria en RS-232).
 */
let colaSerie: Promise<unknown> = Promise.resolve();
const puertosConfigurados = new Set<string>();

function configurarPuerto(com: string, baudios: number): Promise<void> {
  const clave = `${com}:${baudios}`;
  if (process.platform !== 'win32' || puertosConfigurados.has(clave)) return Promise.resolve();
  return new Promise((resolve) => {
    const p = spawn('mode.com', [com, `BAUD=${baudios}`, 'PARITY=n', 'DATA=8', 'STOP=1', 'xon=off', 'octs=off', 'odsr=off', 'dtr=on', 'rts=on'], {
      windowsHide: true,
    });
    p.on('error', () => resolve());
    // Si `mode` falla (puerto ocupado, etc.) se intenta escribir igual: el error real lo dará la escritura
    p.on('close', (code) => {
      if (code === 0) puertosConfigurados.add(clave);
      resolve();
    });
  });
}

export function enviarSerie(com: string, baudios: number, datos: Buffer): Promise<void> {
  if (!/^COM\d{1,3}$/i.test(com)) return Promise.reject(new Error(`Puerto inválido: ${com}`));
  const trabajo = colaSerie.then(async () => {
    await configurarPuerto(com, baudios);
    const ruta = process.platform === 'win32' ? `\\\\.\\${com.toUpperCase()}` : com;
    let tiempo: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        fs.writeFile(ruta, datos),
        new Promise((_, rej) => (tiempo = setTimeout(() => rej(new Error('tiempo agotado (¿impresora apagada o sin papel?)')), 15000))),
      ]);
    } catch (e) {
      throw new Error(`Impresora ${com}: ${(e as Error).message}`);
    } finally {
      clearTimeout(tiempo);
    }
  });
  colaSerie = trabajo.catch(() => undefined);
  return trabajo;
}

export async function enviarImpresora(cfg: ConfigImpresora, datos: Buffer): Promise<void> {
  if (cfg.tipo === 'ninguna') return;
  if (cfg.tipo === 'serie') {
    if (!cfg.com) throw new Error('Configure el puerto COM de la impresora');
    return enviarSerie(cfg.com, cfg.baudios ?? 9600, datos);
  }
  if (cfg.tipo === 'red') {
    if (!cfg.host) throw new Error('Configure la IP de la impresora');
    return enviarRed(cfg.host, cfg.puerto ?? 9100, datos);
  }
  return enviarWindows(cfg.nombre, datos);
}
