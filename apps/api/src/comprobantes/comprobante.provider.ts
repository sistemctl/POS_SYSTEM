import { Injectable } from '@nestjs/common';

export interface VentaParaComprobante {
  id: string;
  tipoComprobante: string;
  serie: string;
  numero: number;
  total: string;
  clienteId: string | null;
}

export interface ResultadoComprobante {
  estadoEnvio: 'NO_APLICA' | 'PENDIENTE' | 'ENVIADO' | 'ERROR';
  respuesta?: unknown;
}

/**
 * Punto de extensión para la facturación electrónica.
 * Hoy solo existe TicketProvider (ticket interno). Para SUNAT/DIAN/SAT se agrega un provider
 * que firme y envíe el comprobante, y se registra en ComprobantesModule según configuración.
 */
export abstract class ComprobanteProvider {
  abstract readonly nombre: string;
  /** Se llama dentro de la transacción de la venta; no debe hacer llamadas de red (la tienda puede estar offline). */
  abstract preparar(venta: VentaParaComprobante): Promise<ResultadoComprobante>;
  /** Envío diferido (cuando haya conexión). */
  abstract enviarPendientes(): Promise<void>;
}

@Injectable()
export class TicketProvider extends ComprobanteProvider {
  readonly nombre = 'TICKET';

  async preparar(): Promise<ResultadoComprobante> {
    return { estadoEnvio: 'NO_APLICA' };
  }

  async enviarPendientes() {
    /* Sin facturación electrónica: nada que enviar */
  }
}
