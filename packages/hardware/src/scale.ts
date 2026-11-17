import { EventEmitter } from 'events';

export interface LecturaPeso {
  /** kg */
  peso: number;
  estable: boolean;
}

export interface ConfigBalanza {
  driver: 'ninguna' | 'generico' | 'toledo' | 'cas' | 'datalogic' | 'simulada';
  puerto?: string;
  baudios?: number;
  /** Por defecto 8 (Datalogic: 7) */
  bitsDatos?: 7 | 8;
  /** Por defecto 'none' (Datalogic: 'odd') */
  paridad?: 'none' | 'odd' | 'even';
}

export interface ScaleDriver {
  conectar(): Promise<void>;
  /** Pide una lectura (para balanzas que responden a comando) o devuelve la última recibida */
  leer(): Promise<LecturaPeso>;
  on(evento: 'peso', cb: (l: LecturaPeso) => void): this;
  off(evento: 'peso', cb: (l: LecturaPeso) => void): this;
  cerrar(): Promise<void>;
}

/** Extrae el primer número de una trama de texto ("ST,GS,+  1.255kg" → 1.255) */
export function parsearPeso(trama: string): number | null {
  const m = trama.replace(',', '.').match(/([-+]?\s*\d+\.\d+|[-+]?\s*\d+)/);
  if (!m) return null;
  const n = Number(m[1].replace(/\s/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Balanzas por puerto serie (USB-serial o RS-232). */
abstract class SerialScale extends EventEmitter implements ScaleDriver {
  protected port: any = null;
  protected ultima: LecturaPeso | null = null;
  protected historial: number[] = [];
  protected buffer = '';

  constructor(protected cfg: ConfigBalanza) {
    super();
  }

  async conectar() {
    if (this.port?.isOpen) return;
    if (!this.cfg.puerto) throw new Error('Configure el puerto COM de la balanza');
    // Carga diferida: serialport es un módulo nativo
    const { SerialPort } = require('serialport');
    this.port = new SerialPort({
      path: this.cfg.puerto,
      baudRate: this.cfg.baudios ?? 9600,
      dataBits: this.cfg.bitsDatos ?? this.serieDefecto.bitsDatos,
      parity: this.cfg.paridad ?? this.serieDefecto.paridad,
      stopBits: 1,
      autoOpen: false,
    });
    await new Promise<void>((res, rej) => this.port.open((e: Error | null) => (e ? rej(new Error(`Balanza: ${e.message}`)) : res())));
    this.port.on('data', (d: Buffer) => this.recibir(d));
    this.port.on('error', (e: Error) => this.emit('error', e));
  }

  protected recibir(d: Buffer) {
    this.buffer += d.toString('latin1');
    const tramas = this.buffer.split(/[\r\n\x03]/);
    this.buffer = tramas.pop() ?? '';
    for (const t of tramas) {
      const limpia = t.replace(/[\x00-\x1f]/g, '').trim();
      if (!limpia) continue;
      const l = this.interpretar(limpia);
      if (l) {
        this.ultima = l;
        this.emit('peso', l);
      }
    }
  }

  /** Estable si las últimas 3 lecturas son iguales (para balanzas sin bandera de estabilidad) */
  protected estabilidad(peso: number): boolean {
    this.historial.push(peso);
    if (this.historial.length > 3) this.historial.shift();
    return this.historial.length === 3 && this.historial.every((x) => Math.abs(x - peso) < 0.0005);
  }

  /** Formato del puerto cuando la configuración no lo indica */
  protected serieDefecto: { bitsDatos: 7 | 8; paridad: 'none' | 'odd' | 'even' } = { bitsDatos: 8, paridad: 'none' };

  protected abstract interpretar(trama: string): LecturaPeso | null;
  protected abstract comando(): Buffer | null;

  async leer(): Promise<LecturaPeso> {
    await this.conectar();
    const cmd = this.comando();
    if (!cmd) {
      if (this.ultima) return this.ultima;
      return this.esperar();
    }
    const p = this.esperar();
    this.port.write(cmd);
    return p;
  }

  private esperar(ms = 1500): Promise<LecturaPeso> {
    return new Promise((res, rej) => {
      const t = setTimeout(() => {
        this.off('peso', cb);
        rej(new Error('La balanza no respondió'));
      }, ms);
      const cb = (l: LecturaPeso) => {
        clearTimeout(t);
        this.off('peso', cb);
        res(l);
      };
      this.on('peso', cb);
    });
  }

  async cerrar() {
    if (this.port?.isOpen) await new Promise((r) => this.port.close(r));
    this.port = null;
  }
}

/** Balanza que transmite el peso continuamente (la mayoría de modelos genéricos) */
class GenericoScale extends SerialScale {
  protected comando() {
    return null;
  }
  protected interpretar(t: string): LecturaPeso | null {
    const peso = parsearPeso(t);
    if (peso === null) return null;
    const kg = /\bg\b/i.test(t) && !/kg/i.test(t) ? peso / 1000 : peso;
    const bandera = /\bST\b/i.test(t) ? true : /\bUS\b/i.test(t) ? false : null;
    const estable = this.estabilidad(kg);
    return { peso: kg, estable: bandera ?? estable };
  }
}

/** Toledo / Mettler protocolo 8217: se envía 'W' y responde STX + peso + CR, o STX ? + estado si está en movimiento */
class ToledoScale extends SerialScale {
  protected comando() {
    return Buffer.from('W', 'ascii');
  }
  protected interpretar(t: string): LecturaPeso | null {
    if (t.startsWith('?')) return { peso: this.ultima?.peso ?? 0, estable: false };
    const peso = parsearPeso(t);
    return peso === null ? null : { peso, estable: true };
  }
}

/** CAS (protocolo ENQ/ACK + DC1): trama tipo "ST,GS,+  1.255kg" */
class CasScale extends SerialScale {
  protected comando() {
    return Buffer.from([0x05, 0x11]);
  }
  protected interpretar(t: string): LecturaPeso | null {
    if (t === '\x06') return null;
    const peso = parsearPeso(t.replace(/^[A-Z]{2},[A-Z]{2},/, ''));
    if (peso === null) return null;
    return { peso, estable: !/^US/i.test(t) };
  }
}

/**
 * Datalogic Magellan escáner-balanza (protocolo de cable único RS-232 / USB-COM, 9600 7-O-1).
 * Se envía "S11" + CR y la balanza responde con ACK y luego:
 *   S11 + 5 dígitos  → peso métrico en gramos      ("S1101255" = 1,255 kg)
 *   S11 + 4 dígitos  → peso inglés en centésimas de libra ("S110275" = 2,75 lb)
 *   S14 + estado     → sin peso válido (0 no lista, 1 en movimiento, 2 sobrecarga, 3 cero, 4 bajo cero)
 * Las tramas de códigos de barras ("S08…") se ignoran.
 */
export function interpretarDatalogic(t: string): LecturaPeso | 'movimiento' | 'cero' | null {
  const s = t.replace(/\s/g, '');
  const peso = s.match(/^S11(\d{4,5})$/);
  if (peso) {
    const n = Number(peso[1]);
    const kg = peso[1].length === 5 ? n / 1000 : Math.round(((n / 100) * 0.45359237) * 1000) / 1000;
    return { peso: kg, estable: true };
  }
  const estado = s.match(/^S14(\d)$/);
  if (estado) {
    if (estado[1] === '3') return 'cero';
    if (estado[1] === '1') return 'movimiento';
    return null;
  }
  return null;
}

export class DatalogicScale extends SerialScale {
  protected serieDefecto = { bitsDatos: 7 as const, paridad: 'odd' as const };
  protected comando() {
    return Buffer.from('S11\r', 'ascii');
  }
  protected interpretar(t: string): LecturaPeso | null {
    const r = interpretarDatalogic(t);
    if (r === 'cero') return { peso: 0, estable: true };
    if (r === 'movimiento') return { peso: this.ultima?.peso ?? 0, estable: false };
    return r;
  }
}

/** Lo mínimo que la balanza compartida necesita del escáner Datalogic (ver ScannerDriver) */
export interface CanalDatalogic {
  escribir(datos: Buffer): boolean;
  on(evento: 'balanza', cb: (trama: string) => void): unknown;
  on(evento: 'control', cb: (byte: number) => void): unknown;
  off(evento: string, cb: (...args: any[]) => void): unknown;
}

/**
 * Magellan con escáner y balanza por el mismo cable USB-COM: el escáner ya tiene el puerto abierto
 * (Windows no deja abrirlo dos veces), así que el pedido de peso viaja por su conexión.
 */
export class DatalogicCompartidaScale extends EventEmitter implements ScaleDriver {
  private ultima: LecturaPeso | null = null;
  private readonly alTrama = (t: string) => {
    const r = interpretarDatalogic(t);
    const l: LecturaPeso | null =
      r === 'cero' ? { peso: 0, estable: true } : r === 'movimiento' ? { peso: this.ultima?.peso ?? 0, estable: false } : r;
    if (!l) return;
    this.ultima = l;
    this.emit('peso', l);
  };

  constructor(private canal: CanalDatalogic) {
    super();
    canal.on('balanza', this.alTrama);
  }

  async conectar() {
    /* el escáner gestiona la conexión y los reintentos */
  }

  leer(): Promise<LecturaPeso> {
    return new Promise((res, rej) => {
      const fin = (e: Error | null, l?: LecturaPeso) => {
        clearTimeout(t);
        this.off('peso', alPeso);
        this.canal.off('control', alControl);
        e ? rej(e) : res(l!);
      };
      const alPeso = (l: LecturaPeso) => fin(null, l);
      // BEL = el Magellan rechazó el comando: la balanza está deshabilitada en su configuración
      const alControl = (b: number) => {
        if (b === 0x07) fin(new Error('El Magellan rechazó el pedido de peso: habilite la balanza (interfaz USB-COM Single Cable)'));
      };
      const t = setTimeout(() => fin(new Error('La balanza no respondió')), 1500);
      this.on('peso', alPeso);
      this.canal.on('control', alControl);
      if (!this.canal.escribir(Buffer.from('S11\r', 'ascii'))) fin(new Error('El escáner Datalogic no está conectado'));
    });
  }

  async cerrar() {
    this.canal.off('balanza', this.alTrama);
  }
}

/** Balanza simulada para pruebas sin hardware */
class SimuladaScale extends EventEmitter implements ScaleDriver {
  private timer: NodeJS.Timeout | null = null;
  private objetivo = 0;
  private actual = 0;
  async conectar() {
    if (this.timer) return;
    this.objetivo = Math.round((0.2 + Math.random() * 2) * 1000) / 1000;
    this.timer = setInterval(() => {
      this.actual += (this.objetivo - this.actual) * 0.5;
      if (Math.abs(this.objetivo - this.actual) < 0.002) this.actual = this.objetivo;
      this.emit('peso', { peso: Math.round(this.actual * 1000) / 1000, estable: this.actual === this.objetivo });
    }, 300);
  }
  async leer() {
    await this.conectar();
    return { peso: Math.round(this.actual * 1000) / 1000, estable: this.actual === this.objetivo };
  }
  async cerrar() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.actual = 0;
  }
}

export function crearBalanza(cfg: ConfigBalanza): ScaleDriver | null {
  switch (cfg.driver) {
    case 'generico':
      return new GenericoScale(cfg);
    case 'toledo':
      return new ToledoScale(cfg);
    case 'cas':
      return new CasScale(cfg);
    case 'datalogic':
      return new DatalogicScale(cfg);
    case 'simulada':
      return new SimuladaScale();
    default:
      return null;
  }
}

export async function listarPuertos(): Promise<{ path: string; manufacturer?: string }[]> {
  const { SerialPort } = require('serialport');
  return SerialPort.list();
}
