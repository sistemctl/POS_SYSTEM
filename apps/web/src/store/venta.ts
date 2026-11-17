import { create } from 'zustand';
import Decimal from 'decimal.js';
import { calcularVenta, newId, type ProductoCaja, type PromocionInput, type TotalesVenta } from '@pos/shared';
import { parametros } from './parametros';

export interface LineaCarrito {
  key: string;
  productoId: string;
  nombre: string;
  unidad: string;
  pesable: boolean;
  cantidad: string;
  precioUnitario: string;
  precioLista: string;
  tasaImpuesto: string;
  descuentoPorcentaje: string;
}

export interface DatosVenta {
  ventaId: string;
  lineas: LineaCarrito[];
  autorizacionIds: string[];
}

interface VentaState extends DatosVenta {
  seleccion: string | null;
  /** Cantidad pendiente para el próximo producto (tecla "Cantidad" / F2) */
  multiplicador: number | null;
  agregar: (p: ProductoCaja, cantidad?: number) => void;
  setCantidad: (key: string, cantidad: string) => void;
  quitar: (key: string) => void;
  setDescuento: (key: string, pct: string) => void;
  setPrecio: (key: string, precio: string) => void;
  seleccionar: (key: string | null) => void;
  setMultiplicador: (n: number | null) => void;
  agregarAutorizacion: (id: string) => void;
  limpiar: () => void;
  restaurar: (d: DatosVenta) => void;
}

const nuevaVenta = (): DatosVenta => ({ ventaId: newId(), lineas: [], autorizacionIds: [] });

export const useVenta = create<VentaState>((set, getState) => ({
  ...nuevaVenta(),
  seleccion: null,
  multiplicador: null,

  agregar: (p, cantidad) => {
    const s = getState();
    const qty = new Decimal(cantidad ?? s.multiplicador ?? 1);
    // Agrupa productos por unidad iguales (necesario para promociones NxM)
    if (!p.pesable) {
      const existente = s.lineas.find(
        (l) => l.productoId === p.id && l.precioUnitario === l.precioLista && Number(l.descuentoPorcentaje) === 0,
      );
      if (existente) {
        set({
          lineas: s.lineas.map((l) => (l.key === existente.key ? { ...l, cantidad: qty.plus(l.cantidad).toString() } : l)),
          seleccion: existente.key,
          multiplicador: null,
        });
        return;
      }
    }
    const linea: LineaCarrito = {
      key: newId(),
      productoId: p.id,
      nombre: p.nombre,
      unidad: p.unidad,
      pesable: p.pesable,
      cantidad: p.pesable ? qty.toFixed(3) : qty.toFixed(0),
      precioUnitario: p.precio,
      precioLista: p.precio,
      tasaImpuesto: p.tasaImpuesto,
      descuentoPorcentaje: '0',
    };
    set({ lineas: [...s.lineas, linea], seleccion: linea.key, multiplicador: null });
  },

  setCantidad: (key, cantidad) =>
    set((s) => ({ lineas: s.lineas.map((l) => (l.key === key ? { ...l, cantidad } : l)) })),

  quitar: (key) =>
    set((s) => {
      const lineas = s.lineas.filter((l) => l.key !== key);
      return { lineas, seleccion: lineas.length ? lineas[lineas.length - 1].key : null };
    }),

  setDescuento: (key, pct) =>
    set((s) => ({ lineas: s.lineas.map((l) => (l.key === key ? { ...l, descuentoPorcentaje: pct } : l)) })),

  setPrecio: (key, precio) =>
    set((s) => ({ lineas: s.lineas.map((l) => (l.key === key ? { ...l, precioUnitario: new Decimal(precio).toFixed(2) } : l)) })),

  seleccionar: (seleccion) => set({ seleccion }),
  setMultiplicador: (multiplicador) => set({ multiplicador }),
  agregarAutorizacion: (id) => set((s) => ({ autorizacionIds: [...s.autorizacionIds, id] })),
  limpiar: () => set({ ...nuevaVenta(), seleccion: null, multiplicador: null }),
  restaurar: (d) => set({ ...d, seleccion: d.lineas.at(-1)?.key ?? null, multiplicador: null }),
}));

export function calcularCarrito(lineas: LineaCarrito[], promociones: PromocionInput[]): TotalesVenta {
  return calcularVenta(
    lineas.map((l) => ({
      productoId: l.productoId,
      cantidad: l.cantidad,
      precioUnitario: l.precioUnitario,
      tasaImpuesto: l.tasaImpuesto,
      descuentoPorcentaje: l.descuentoPorcentaje,
    })),
    { promociones, decimales: parametros().regional.decimales },
  );
}
