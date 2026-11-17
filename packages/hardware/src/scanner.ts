import { EventEmitter } from 'events';

/**
 * Lectores de código de barras conectados como puerto serie (RS-232 o USB-COM), por ejemplo
 * Datalogic Magellan en interfaz "USB COM". Los lectores en modo teclado (HID) no necesitan esto:
 * la caja los detecta directamente.
 */
export interface ConfigEscaner {
  driver: 'ninguno' | 'datalogic' | 'serie';
  /** 'auto' = buscar el primer puerto Datalogic (USB VID 05F9); útil porque el número COM cambia al mover el cable */
  puerto?: string;
  baudios?: number;
  bitsDatos?: 7 | 8;
  paridad?: 'none' | 'odd' | 'even';
}

/** Vendor ID USB de Datalogic */
const VID_DATALOGIC = '05f9';

/**
 * Prefijos "Label ID" que Datalogic antepone según la simbología (RS-232 / USB COM).
 * Los más largos van primero para que "FF" (EAN-8) gane sobre "F" (EAN-13).
 */
const PREFIJOS_DATALOGIC = ['FF', 'E0', 'R4', 'RX', ']C1', 'A', 'E', 'F', '#', '*', 'i', '%', '&'];

/** Quita el identificador de simbología de una lectura Datalogic: "A711719542162" → "711719542162" */
export function limpiarCodigoDatalogic(trama: string): string {
  const t = trama.replace(/[\x00-\x1f]/g, '').trim();
  for (const p of PREFIJOS_DATALOGIC) {
    if (t.startsWith(p) && t.length > p.length) {
      const resto = t.slice(p.length);
      // Solo quitar letras-prefijo si lo que sigue es el código (evita recortar códigos alfanuméricos tipo SKU)
      if (/^[A-Za-z]+$/.test(p) && !/^[0-9]/.test(resto)) continue;
      return resto;
    }
  }
  return t;
}

/** Respuestas de la balanza Datalogic por el cable único: "S11ddddd" (peso) o "S14d" (estado) */
const TRAMA_BALANZA = /^S1[14]\d/;
const ACK = 0x06;
const BEL = 0x07;

export interface ScannerDriver {
  conectar(): Promise<void>;
  /** Conecta y, si falla o se desconecta el cable, reintenta cada 5 s en segundo plano */
  iniciar(): void;
  /** Escribe en el puerto abierto (lo usa la balanza Datalogic que comparte el cable). false si no está conectado. */
  escribir(datos: Buffer): boolean;
  on(evento: 'codigo', cb: (codigo: string) => void): this;
  on(evento: 'error', cb: (e: Error) => void): this;
  /** Trama de la balanza recibida por el mismo cable (Datalogic) */
  on(evento: 'balanza', cb: (trama: string) => void): this;
  /** Byte de control suelto: ACK (06) = comando aceptado, BEL (07) = comando rechazado */
  on(evento: 'control', cb: (byte: number) => void): this;
  off(evento: string, cb: (...args: any[]) => void): this;
  cerrar(): Promise<void>;
}

class SerialScanner extends EventEmitter implements ScannerDriver {
  private port: any = null;
  private buffer = '';
  private reintento: NodeJS.Timeout | null = null;
  private cerrado = false;

  constructor(private cfg: ConfigEscaner) {
    super();
  }

  private async resolverPuerto(): Promise<string> {
    const p = this.cfg.puerto?.trim();
    if (p && p !== 'auto') return p;
    const { SerialPort } = require('serialport');
    const lista: { path: string; vendorId?: string }[] = await SerialPort.list();
    const dl = lista.find((x) => x.vendorId?.toLowerCase() === VID_DATALOGIC);
    if (!dl) throw new Error('No se encontró el escáner Datalogic. Revise el cable USB.');
    return dl.path;
  }

  async conectar() {
    if (this.port?.isOpen) return;
    this.cerrado = false;
    const path = await this.resolverPuerto();
    const datalogic = this.cfg.driver === 'datalogic';
    const { SerialPort } = require('serialport');
    this.port = new SerialPort({
      path,
      baudRate: this.cfg.baudios ?? 9600,
      dataBits: this.cfg.bitsDatos ?? (datalogic ? 7 : 8),
      parity: this.cfg.paridad ?? (datalogic ? 'odd' : 'none'),
      stopBits: 1,
      rtscts: false,
      autoOpen: false,
    });
    await new Promise<void>((res, rej) => this.port.open((e: Error | null) => (e ? rej(new Error(`Escáner (${path}): ${e.message}`)) : res())));
    await new Promise<void>((res) => this.port.set({ dtr: true, rts: true }, () => res()));
    this.port.on('data', (d: Buffer) => this.recibir(d));
    this.port.on('error', (e: Error) => this.emit('error', e));
    // Si se desconecta el cable, reintentar cada 5 s (también encuentra el nuevo COM en modo 'auto')
    this.port.on('close', () => {
      this.detenerHabilitar();
      this.programarReintento();
    });
    if (datalogic) {
      // Datalogic USB COM: el host debe habilitar el escáner ('E' = Enable Scanner, Apéndice E del manual).
      // Enviarlo apenas se abre el puerto se pierde: esperar a que el escáner esté listo y repetirlo
      // periódicamente por si el escáner se reinicia (enviarlo estando habilitado no tiene efecto).
      setTimeout(() => this.habilitar(), 500);
      this.timerHabilitar = setInterval(() => this.habilitar(), 15000);
    }
  }

  private timerHabilitar: NodeJS.Timeout | null = null;

  private habilitar() {
    if (this.port?.isOpen) this.port.write(Buffer.from('E', 'ascii'));
  }

  private detenerHabilitar() {
    if (this.timerHabilitar) clearInterval(this.timerHabilitar);
    this.timerHabilitar = null;
  }

  iniciar() {
    this.conectar().catch((e) => {
      this.emit('error', e as Error);
      this.programarReintento();
    });
  }

  private programarReintento() {
    this.port = null;
    if (this.cerrado || this.reintento) return;
    this.reintento = setTimeout(async () => {
      this.reintento = null;
      try {
        await this.conectar();
      } catch (e) {
        this.emit('error', e as Error);
        this.programarReintento();
      }
    }, 5000);
  }

  escribir(datos: Buffer): boolean {
    if (!this.port?.isOpen) return false;
    this.port.write(datos);
    return true;
  }

  private recibir(d: Buffer) {
    const datalogic = this.cfg.driver === 'datalogic';
    if (datalogic) {
      // ACK/BEL llegan sueltos, sin CR: avisar ya (la balanza compartida espera la respuesta)
      for (const b of d) if (b === ACK || b === BEL) this.emit('control', b);
    }
    this.buffer += d.toString('latin1');
    const tramas = this.buffer.split(/[\r\n]/);
    this.buffer = tramas.pop() ?? '';
    for (const t of tramas) {
      const crudo = t.replace(/[\x00-\x1f]/g, '').trim();
      if (!crudo) continue;
      if (datalogic && TRAMA_BALANZA.test(crudo)) {
        this.emit('balanza', crudo);
        continue;
      }
      const codigo = datalogic ? limpiarCodigoDatalogic(crudo) : crudo;
      if (codigo) this.emit('codigo', codigo);
    }
  }

  async cerrar() {
    this.cerrado = true;
    this.detenerHabilitar();
    if (this.reintento) clearTimeout(this.reintento);
    this.reintento = null;
    if (this.port?.isOpen) await new Promise((r) => this.port.close(r));
    this.port = null;
  }
}

export function crearEscaner(cfg: ConfigEscaner | undefined): ScannerDriver | null {
  if (!cfg || cfg.driver === 'ninguno') return null;
  return new SerialScanner(cfg);
}
