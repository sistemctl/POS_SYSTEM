/**
 * Tablas maestras que el central replica a las tiendas, en orden de dependencia.
 * `omitir`: columnas que nunca salen del central.
 */
export const TABLAS_MAESTRAS: { tabla: string; omitir?: string[] }[] = [
  { tabla: 'sucursal', omitir: ['syncTokenHash'] },
  { tabla: 'caja' },
  { tabla: 'rol' },
  { tabla: 'usuario' },
  { tabla: 'usuarioRol' },
  { tabla: 'categoria' },
  { tabla: 'producto' },
  { tabla: 'productoCodigo' },
  { tabla: 'precioSucursal' },
  { tabla: 'promocion' },
  { tabla: 'parametros' },
];

export const LIMITE_PULL = 500;

export type CursorPull = Record<string, { t: string; id: string }>;
