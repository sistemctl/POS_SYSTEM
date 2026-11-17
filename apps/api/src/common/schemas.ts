import { z } from 'zod';

export const uuid = z.string().uuid();
/** Decimal como string o número, se normaliza a string */
export const decimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), 'Número inválido');
export const decimalPositivo = decimal.refine((v) => Number(v) > 0, 'Debe ser mayor a 0');
export const decimalNoNegativo = decimal.refine((v) => Number(v) >= 0, 'No puede ser negativo');
