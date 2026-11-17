/**
 * Utilidades de códigos de barras, incluyendo etiquetas de balanza etiquetadora
 * (EAN-13 con prefijo 20–29 y peso o precio embebido).
 */

export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const n = Number(first12[i]);
    sum += i % 2 === 0 ? n : n * 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  return ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

export interface ConfigEtiquetaBalanza {
  /** Prefijos que identifican etiquetas de balanza, ej. ['20','21',...,'29'] */
  prefijos: string[];
  /** Dígitos del código de producto (PLU) después del prefijo */
  longitudCodigo: number;
  /** Qué representa el valor embebido */
  tipoValor: 'PESO' | 'PRECIO';
  /** Decimales del valor: PESO en kg con 3 decimales (gramos), PRECIO con 2 */
  decimales: number;
  /** Validar dígito verificador EAN-13 */
  validarDigito: boolean;
}

export const CONFIG_BALANZA_DEFECTO: ConfigEtiquetaBalanza = {
  prefijos: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'],
  longitudCodigo: 5,
  tipoValor: 'PESO',
  decimales: 3,
  validarDigito: true,
};

export interface EtiquetaBalanza {
  prefijo: string;
  codigoProducto: string;
  tipoValor: 'PESO' | 'PRECIO';
  valor: number;
}

/**
 * Interpreta una etiqueta de balanza. Formato: PP CCCCC VVVVV D
 *  PP prefijo (2), C código de producto, V valor, D dígito verificador.
 * Devuelve null si el código no es una etiqueta de balanza.
 */
export function parseEtiquetaBalanza(
  code: string,
  config: ConfigEtiquetaBalanza = CONFIG_BALANZA_DEFECTO,
): EtiquetaBalanza | null {
  if (!/^\d{13}$/.test(code)) return null;
  const prefijo = code.slice(0, 2);
  if (!config.prefijos.includes(prefijo)) return null;
  if (config.validarDigito && !isValidEan13(code)) return null;
  const codigoProducto = code.slice(2, 2 + config.longitudCodigo);
  const valorStr = code.slice(2 + config.longitudCodigo, 12);
  if (valorStr.length === 0) return null;
  const valor = Number(valorStr) / Math.pow(10, config.decimales);
  return { prefijo, codigoProducto, tipoValor: config.tipoValor, valor };
}

/** Genera una etiqueta de balanza (útil para pruebas y para imprimir etiquetas). */
export function buildEtiquetaBalanza(
  prefijo: string,
  codigoProducto: string,
  valor: number,
  config: ConfigEtiquetaBalanza = CONFIG_BALANZA_DEFECTO,
): string {
  const valorDigits = 12 - 2 - config.longitudCodigo;
  const v = Math.round(valor * Math.pow(10, config.decimales));
  const first12 =
    prefijo + codigoProducto.padStart(config.longitudCodigo, '0') + String(v).padStart(valorDigits, '0');
  if (first12.length !== 12) throw new Error('Etiqueta inválida');
  return first12 + ean13CheckDigit(first12);
}
