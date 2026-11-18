import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Decimal from 'decimal.js';
import { PERMISOS, type CrearVentaResponse, type PagoInput, type ProductoCaja } from '@pos/shared';
import { ApiError, del, get, post, put, urlMedia } from '../lib/api';
import { useParametros } from '../store/parametros';
import { cantidad as fmtCantidad, dinero, leerConfig } from '../lib/config';
import { abrirCajon, actualizarVisor, bridge, imprimirTicket } from '../lib/hardware';
import { useCatalogo } from '../store/catalogo';
import { useSesion, type Turno } from '../store/sesion';
import { calcularCarrito, useVenta, type DatosVenta } from '../store/venta';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useShortcuts } from '../hooks/useShortcuts';
import { Boton, ConfirmarModal, toast } from '../components/ui';
import { conAutorizacion, solicitarAutorizacion } from '../components/Autorizacion';
import { EstadoConexion } from '../components/EstadoConexion';
import { ATAJOS } from './shortcuts';
import { BuscarModal } from './BuscarModal';
import { CobroModal } from './CobroModal';
import { ModalNumero } from './ModalNumero';
import { PesarModal } from './PesarModal';
import {
  AyudaModal,
  CerrarTurnoModal,
  MasOpcionesModal,
  MovimientoCajaModal,
  SuspendidasModal,
  VentasTurnoModal,
  type OpcionCaja,
} from './ModalesCaja';
import AbrirTurno from '../pages/AbrirTurno';

type ModalAbierto =
  | { tipo: 'buscar'; aviso?: string }
  | { tipo: 'masOpciones' }
  | { tipo: 'ayuda' }
  | { tipo: 'cancelar' }
  | { tipo: 'cobro' }
  | { tipo: 'pesar'; producto: ProductoCaja }
  | { tipo: 'cantidad' }
  | { tipo: 'descuento' }
  | { tipo: 'precio' }
  | { tipo: 'ventas' }
  | { tipo: 'movimiento' }
  | { tipo: 'suspendidas' }
  | { tipo: 'cerrarTurno' }
  | null;

const BORRADOR_KEY = (cajaId: string) => `pos.borrador.${cajaId}`;
const POR_PAGINA_GRILLA = 40;

export default function Venta() {
  const nav = useNavigate();
  const cfg = leerConfig();
  const { usuario, turno, setTurno, cerrarSesion, puede } = useSesion();
  const catalogo = useCatalogo();
  const venta = useVenta();
  const [modal, setModal] = useState<ModalAbierto>(null);
  const [categoria, setCategoria] = useState<string>('favoritos');
  const [procesando, setProcesando] = useState(false);
  const [ultimaVenta, setUltimaVenta] = useState<CrearVentaResponse | null>(null);
  const [cargandoTurno, setCargandoTurno] = useState(true);
  const [paginaGrilla, setPaginaGrilla] = useState(0);
  const [enEspera, setEnEspera] = useState(0);
  const params = useParametros((s) => s.p);

  /** Cuántas ventas hay en espera (para el botón «Recuperar (N)») */
  const contarEnEspera = () =>
    get<unknown[]>('/ventas/suspendidas')
      .then((r) => setEnEspera(r.length))
      .catch(() => undefined);

  // ── Turno y catálogo ──
  useEffect(() => {
    if (!usuario) return nav('/login');
    get<{ turno: Turno | null }>('/turnos/actual')
      .then((r) => {
        if (r.turno && r.turno.usuarioId !== usuario.id) {
          toast.error('Esta caja tiene un turno abierto de otro cajero');
          cerrarSesion();
          return;
        }
        setTurno(r.turno);
      })
      .catch((e) => toast.error(e.message))
      .finally(() => setCargandoTurno(false));
    contarEnEspera();
    catalogo.cargar().catch((e) => {
      // Con copia local se puede seguir vendiendo aunque el servidor no responda
      if (!useCatalogo.getState().cargado) toast.error(`Catálogo: ${e.message}`);
    });
    useParametros.getState().cargar().catch(() => undefined);
    // Cada 5 min solo los cambios (precios del central); cada hora el catálogo completo
    const t = setInterval(() => useCatalogo.getState().cargar().catch(() => undefined), 5 * 60 * 1000);
    const tCompleto = setInterval(() => useCatalogo.getState().cargar(true).catch(() => undefined), 60 * 60 * 1000);
    const tParams = setInterval(() => useParametros.getState().cargar().catch(() => undefined), 5 * 60 * 1000);
    return () => {
      clearInterval(t);
      clearInterval(tCompleto);
      clearInterval(tParams);
    };
  }, []);

  // ── Recuperación de venta en curso (corte de luz / cierre inesperado) ──
  const restaurado = useRef(false);
  useEffect(() => {
    if (!turno || restaurado.current || !cfg.cajaId) return;
    restaurado.current = true;
    if (useVenta.getState().lineas.length) return;
    let local: DatosVenta | null = null;
    try {
      const raw = localStorage.getItem(BORRADOR_KEY(cfg.cajaId));
      if (raw) local = JSON.parse(raw);
    } catch {
      /* ignorar */
    }
    const aplicar = (d: DatosVenta | null) => {
      if (d?.lineas?.length) {
        venta.restaurar(d);
        toast.info('Se recuperó la venta en curso');
      }
    };
    if (local?.lineas?.length) aplicar(local);
    else get<{ data: DatosVenta | null }>('/ventas/borrador').then((r) => aplicar(r.data)).catch(() => undefined);
  }, [turno]);

  // Guardar borrador en cada cambio (local inmediato + servidor con retardo)
  useEffect(() => {
    if (!cfg.cajaId || !turno) return;
    const datos: DatosVenta = { ventaId: venta.ventaId, lineas: venta.lineas, autorizacionIds: venta.autorizacionIds };
    try {
      if (datos.lineas.length) localStorage.setItem(BORRADOR_KEY(cfg.cajaId), JSON.stringify(datos));
      else localStorage.removeItem(BORRADOR_KEY(cfg.cajaId));
    } catch {
      /* ignorar */
    }
    const t = setTimeout(() => {
      (datos.lineas.length ? put('/ventas/borrador', { data: datos }) : del('/ventas/borrador')).catch(() => undefined);
    }, 1000);
    return () => clearTimeout(t);
  }, [venta.lineas, venta.autorizacionIds, venta.ventaId, turno]);

  // ── Totales (misma lógica que la API) ──
  const totales = useMemo(() => {
    try {
      return calcularCarrito(venta.lineas, catalogo.promociones);
    } catch {
      return null;
    }
  }, [venta.lineas, catalogo.promociones]);

  // Visor de cliente (segundo monitor)
  useEffect(() => {
    actualizarVisor({
      lineas: venta.lineas.map((l, i) => ({ nombre: l.nombre, cantidad: fmtCantidad(l.cantidad, l.unidad), total: totales?.lineas[i]?.total ?? '0' })),
      total: totales?.total ?? '0.00',
      ahorro: totales?.descuento ?? '0.00',
      moneda: cfg.moneda,
      vuelto: ultimaVenta?.vuelto ?? null,
    });
  }, [totales, ultimaVenta]);

  // ── Cierre de sesión por inactividad (solo con el carrito vacío) ──
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!useVenta.getState().lineas.length) cerrarSesion('Sesión cerrada por inactividad');
      }, useParametros.getState().p.caja.inactividadMin * 60_000);
    };
    reset();
    window.addEventListener('pointerdown', reset);
    window.addEventListener('keydown', reset);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', reset);
      window.removeEventListener('keydown', reset);
    };
  }, []);

  // ── Agregar productos ──
  const agregarProducto = useCallback(
    (p: ProductoCaja, cant?: number) => {
      setUltimaVenta(null);
      if (p.pesable && cant === undefined) {
        setModal({ tipo: 'pesar', producto: p });
        return;
      }
      venta.agregar(p, cant);
    },
    [venta],
  );

  useBarcodeScanner(
    (codigo) => {
      const r = catalogo.resolver(codigo);
      if (!r) {
        // En vez de solo un aviso que desaparece, se abre la búsqueda para encontrarlo por nombre
        setModal({ tipo: 'buscar', aviso: `No se encontró el código ${codigo}. Búsquelo por nombre:` });
        import('../lib/logs').then((m) => m.reportarError(`Producto no encontrado: ${codigo}`, undefined, 'warn')).catch(() => undefined);
        return;
      }
      agregarProducto(r.producto, r.cantidad ?? (r.producto.pesable ? undefined : undefined));
    },
    !!turno && (modal === null || modal.tipo === 'buscar'),
  );

  // Avisos del escáner por puerto serie (cable desconectado, puerto ocupado…)
  useEffect(() => bridge()?.scanner?.onError((m) => toast.error(m)), []);

  const lineaSel = venta.lineas.find((l) => l.key === venta.seleccion) ?? null;

  // ── Acciones con permisos ──
  const quitar = async (key: string) => {
    const l = venta.lineas.find((x) => x.key === key);
    if (!l) return;
    if (!puede(PERMISOS.VENTA_ANULAR_ITEM)) {
      const r = await solicitarAutorizacion(PERMISOS.VENTA_ANULAR_ITEM, {
        motivo: `Quitar ${l.nombre}`,
        consumir: true,
        detalle: { productoId: l.productoId, cantidad: l.cantidad, precio: l.precioUnitario },
      });
      if (!r) return;
    }
    venta.quitar(key);
  };

  const cambiarCantidad = async (key: string, delta: number) => {
    const l = venta.lineas.find((x) => x.key === key);
    if (!l) return;
    const nueva = new Decimal(l.cantidad).plus(delta);
    if (nueva.lte(0)) return quitar(key);
    if (delta < 0 && !puede(PERMISOS.VENTA_ANULAR_ITEM)) {
      const r = await solicitarAutorizacion(PERMISOS.VENTA_ANULAR_ITEM, { motivo: `Reducir ${l.nombre}`, consumir: true });
      if (!r) return;
    }
    venta.setCantidad(key, nueva.toString());
  };

  const aplicarDescuento = async (pct: string) => {
    if (!lineaSel) return;
    const n = Number(pct);
    if (n < 0 || n > 100) return toast.error('Porcentaje inválido');
    const propio = puede(PERMISOS.VENTA_DESCUENTO) && n <= (usuario?.descuentoMaximo ?? 0);
    if (n > 0 && !propio) {
      const r = await solicitarAutorizacion(PERMISOS.VENTA_DESCUENTO, { motivo: `${n}% en ${lineaSel.nombre}` });
      if (!r) return;
      if (n > r.descuentoMaximo) return toast.error(`El supervisor puede autorizar hasta ${r.descuentoMaximo}%`);
      venta.agregarAutorizacion(r.autorizacionId);
    }
    venta.setDescuento(lineaSel.key, String(n));
    setModal(null);
  };

  const cambiarPrecio = async (precio: string) => {
    if (!lineaSel) return;
    if (!puede(PERMISOS.PRECIO_MODIFICAR)) {
      const r = await solicitarAutorizacion(PERMISOS.PRECIO_MODIFICAR, { motivo: `${lineaSel.nombre}: ${dinero(lineaSel.precioLista)} → ${dinero(precio)}` });
      if (!r) return;
      venta.agregarAutorizacion(r.autorizacionId);
    }
    venta.setPrecio(lineaSel.key, precio);
    setModal(null);
  };

  const suspender = async () => {
    if (!venta.lineas.length) return;
    try {
      await post('/ventas/suspendidas', {
        etiqueta: `${venta.lineas.length} productos · ${dinero(totales?.total ?? 0)}`,
        data: { ventaId: venta.ventaId, lineas: venta.lineas, autorizacionIds: venta.autorizacionIds },
      });
      venta.limpiar();
      setUltimaVenta(null);
      toast.ok('Venta puesta en espera. Puede atender al siguiente cliente.');
      contarEnEspera();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  /** Se llama después de que el cajero confirma en la ventana «¿Cancelar toda la venta?» */
  const cancelarVenta = async () => {
    setModal(null);
    if (!venta.lineas.length) return;
    if (!puede(PERMISOS.VENTA_ANULAR_ITEM)) {
      const r = await solicitarAutorizacion(PERMISOS.VENTA_ANULAR_ITEM, {
        motivo: 'Cancelar venta completa',
        consumir: true,
        detalle: { lineas: venta.lineas.length, total: totales?.total },
      });
      if (!r) return;
    }
    venta.limpiar();
  };

  // ── Cobro ──
  const cobrar = async (pagos: PagoInput[]) => {
    if (!turno || !totales) return;
    setProcesando(true);
    try {
      const r = await conAutorizacion(
        (ids) =>
          post<CrearVentaResponse>('/ventas', {
            id: venta.ventaId,
            turnoId: turno.id,
            items: venta.lineas.map((l) => ({
              productoId: l.productoId,
              cantidad: l.cantidad,
              precioUnitario: l.precioUnitario,
              descuentoPorcentaje: l.descuentoPorcentaje,
            })),
            pagos: pagos.map((p) => ({ ...p, monto: String(p.monto) })),
            totalEsperado: totales.total,
            autorizacionIds: ids,
          }),
        venta.autorizacionIds,
      );
      if (!r) return;
      setModal(null);
      setUltimaVenta(r);
      venta.limpiar();
      // En Electron el cajón se abre junto con la impresión del ticket (si hay pago en efectivo)
      imprimirTicket(r.ticket, cfg.moneda).catch((e) => toast.error(`Impresora: ${e.message}`));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast.error(e.message);
        await catalogo.cargar();
      } else if (e instanceof ApiError && e.sinConexion) {
        toast.error('Sin conexión con el servidor de la tienda. La venta NO se registró; reintente.');
      } else {
        toast.error((e as Error).message);
      }
    } finally {
      setProcesando(false);
    }
  };

  const reimprimirUltima = async () => {
    setModal(null);
    try {
      const t = await get('/ventas/ultima');
      await imprimirTicket(t, cfg.moneda);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // ── Opciones que no se usan en cada venta (botón «Más opciones») ──
  const sinSeleccion = 'Primero toque un producto de la lista';
  const opciones: OpcionCaja[] = [
    {
      texto: 'Descuento',
      ayuda: 'Rebajar un % al producto seleccionado',
      atajo: ATAJOS.descuento,
      bloqueada: lineaSel ? null : sinSeleccion,
      onClick: () => setModal({ tipo: 'descuento' }),
    },
    {
      texto: 'Cambiar precio',
      ayuda: 'Cuando el precio de la etiqueta es distinto',
      bloqueada: lineaSel ? null : sinSeleccion,
      onClick: () => setModal({ tipo: 'precio' }),
    },
    {
      texto: 'Ventas del turno',
      ayuda: 'Ver, reimprimir o anular una venta ya cobrada',
      atajo: ATAJOS.ventas,
      onClick: () => setModal({ tipo: 'ventas' }),
    },
    { texto: 'Reimprimir último recibo', ayuda: 'Si el cliente pide otra copia', onClick: reimprimirUltima },
    { texto: 'Retiro / ingreso de efectivo', ayuda: 'Sacar o meter dinero al cajón', onClick: () => setModal({ tipo: 'movimiento' }) },
    ...(bridge() && puede(PERMISOS.CAJA_ABRIR_CAJON)
      ? [{ texto: 'Abrir cajón', ayuda: 'Abre el cajón del dinero', onClick: () => { setModal(null); abrirCajon(); } }]
      : []),
    { texto: 'Ayuda', ayuda: 'Cómo usar la caja y teclas rápidas', atajo: ATAJOS.ayuda, onClick: () => setModal({ tipo: 'ayuda' }) },
    {
      texto: 'Cancelar venta',
      ayuda: 'Borra todos los productos de esta venta',
      peligro: true,
      bloqueada: venta.lineas.length ? null : 'No hay venta en curso',
      onClick: () => setModal({ tipo: 'cancelar' }),
    },
  ];

  // ── Atajos de teclado ──
  const sinModal = modal === null;
  useShortcuts(
    {
      [ATAJOS.buscar]: () => setModal({ tipo: 'buscar' }),
      [ATAJOS.cantidad]: () => setModal({ tipo: 'cantidad' }),
      [ATAJOS.ayuda]: () => setModal({ tipo: 'ayuda' }),
      [ATAJOS.masOpciones]: () => setModal({ tipo: 'masOpciones' }),
      [ATAJOS.pesar]: () => lineaSel?.pesable && setModal({ tipo: 'pesar', producto: catalogo.porId.get(lineaSel.productoId)! }),
      [ATAJOS.suspender]: suspender,
      [ATAJOS.recuperar]: () => setModal({ tipo: 'suspendidas' }),
      [ATAJOS.descuento]: () => lineaSel && setModal({ tipo: 'descuento' }),
      [ATAJOS.quitar]: () => lineaSel && quitar(lineaSel.key),
      [ATAJOS.cobrar]: () => venta.lineas.length && setModal({ tipo: 'cobro' }),
      [ATAJOS.ventas]: () => setModal({ tipo: 'ventas' }),
      [ATAJOS.cerrarTurno]: () => !venta.lineas.length && setModal({ tipo: 'cerrarTurno' }),
    },
    sinModal,
  );

  if (!usuario) return null;
  if (cargandoTurno) return <div className="p-10 text-2xl">Cargando…</div>;
  if (!turno) return <AbrirTurno />;

  const todosVisibles =
    categoria === 'favoritos'
      ? catalogo.productos.filter((p) => p.favorito)
      : catalogo.productos.filter((p) => p.categoriaId === categoria);
  // Con miles de productos no se dibujan todos los botones: se pagina la grilla
  const totalPaginas = Math.max(1, Math.ceil(todosVisibles.length / POR_PAGINA_GRILLA));
  const pag = Math.min(paginaGrilla, totalPaginas - 1);
  const productosVisibles = todosVisibles.slice(pag * POR_PAGINA_GRILLA, (pag + 1) * POR_PAGINA_GRILLA);
  const columnas = params.caja.columnasGrilla;

  return (
    <div className="flex h-full flex-col">
      {/* Encabezado */}
      <header className="flex items-center gap-3 bg-gradient-to-r from-marca-800 to-marca-700 px-4 py-2 text-white shadow-md">
        {params.marca.logoId ? (
          <img src={urlMedia(params.marca.logoId)!} className="h-11 max-w-[130px] rounded-lg bg-white object-contain p-1 shadow" />
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-2xl">🛒</div>
        )}
        <div className="leading-tight">
          <div className="text-xl font-bold tracking-tight">{cfg.cajaNombre}</div>
          <div className="text-xs uppercase tracking-wider text-white/70">Punto de venta</div>
        </div>
        <div className="ml-2 flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-sm font-bold text-marca-800">
            {usuario.nombre.trim().charAt(0).toUpperCase()}
          </span>
          <span className="text-base font-semibold">{usuario.nombre}</span>
        </div>
        <div className="flex-1" />
        <Reloj />
        <EstadoConexion />
        <Boton variante="neutro" className="h-12 min-h-0 !bg-white/10 !shadow-none hover:!bg-white/20" onClick={() => setModal({ tipo: 'ayuda' })} atajo={ATAJOS.ayuda}>
          ? Ayuda
        </Boton>
        <Boton
          variante="neutro"
          className="h-12 min-h-0 !bg-white/10 !shadow-none hover:!bg-white/20"
          onClick={() =>
            venta.lineas.length ? toast.info('Termine o ponga en espera la venta antes de cerrar el turno') : setModal({ tipo: 'cerrarTurno' })
          }
          atajo={ATAJOS.cerrarTurno}
        >
          Cerrar turno
        </Boton>
        {puede(PERMISOS.PRODUCTO_GESTIONAR) || puede(PERMISOS.REPORTE_SUCURSAL) ? (
          <Boton variante="neutro" className="h-12 min-h-0 !bg-white/10 !shadow-none hover:!bg-white/20" onClick={() => nav('/admin')}>
            Admin
          </Boton>
        ) : null}
        <Boton variante="peligro" className="h-12 min-h-0" disabled={!!venta.lineas.length} onClick={() => cerrarSesion()}>
          Salir
        </Boton>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Ticket */}
        <section className="m-3 mr-0 flex w-[42%] min-w-[420px] flex-col overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="text-lg font-bold text-slate-800">Venta actual</div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
              {venta.lineas.length} {venta.lineas.length === 1 ? 'producto' : 'productos'}
            </span>
          </div>
          <div className="scroll-touch flex-1 space-y-1.5 p-2">
            {venta.lineas.map((l, i) => {
              const calc = totales?.lineas[i];
              const sel = l.key === venta.seleccion;
              return (
                <div
                  key={l.key}
                  onClick={() => venta.seleccionar(l.key)}
                  className={`flex items-center gap-3 rounded-xl border-l-4 px-3 py-2 transition-colors ${
                    sel ? 'linea-nueva border-marca-600 bg-marca-50 shadow-sm' : 'border-transparent hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`flex h-12 min-w-12 shrink-0 items-center justify-center rounded-xl px-2 text-lg font-extrabold ${
                      sel ? 'bg-marca-600 text-white' : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {l.pesable ? fmtCantidad(l.cantidad, l.unidad) : `${Number(l.cantidad)}×`}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-semibold text-slate-900">{l.nombre}</div>
                    <div className="text-sm text-slate-500">
                      {fmtCantidad(l.cantidad, l.unidad)} × {dinero(l.precioUnitario)}
                      {l.precioUnitario !== l.precioLista && <span className="ml-1 text-amber-600">(precio modificado)</span>}
                      {Number(l.descuentoPorcentaje) > 0 && <span className="ml-1 text-amber-600">-{l.descuentoPorcentaje}%</span>}
                      {calc?.promocionId && (
                        <span className="ml-1 rounded bg-violet-100 px-1 text-violet-700">
                          {catalogo.promociones.find((p) => p.id === calc.promocionId)?.nombre ?? 'Promo'}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!l.pesable && (
                      <div className="flex items-center rounded-xl bg-white p-0.5 ring-1 ring-slate-200">
                        <button
                          aria-label="Una menos"
                          className="btn-touch h-11 min-h-0 w-11 min-w-0 rounded-lg text-2xl text-slate-600 hover:bg-slate-100"
                          onClick={(e) => { e.stopPropagation(); cambiarCantidad(l.key, -1); }}
                        >
                          −
                        </button>
                        <button
                          aria-label="Una más"
                          className="btn-touch h-11 min-h-0 w-11 min-w-0 rounded-lg text-2xl text-marca-700 hover:bg-marca-50"
                          onClick={(e) => { e.stopPropagation(); cambiarCantidad(l.key, 1); }}
                        >
                          +
                        </button>
                      </div>
                    )}
                    {sel && (
                      <button
                        aria-label={`Quitar ${l.nombre}`}
                        className="btn-touch h-11 min-h-0 w-11 min-w-0 rounded-xl bg-red-50 text-lg text-red-600 ring-1 ring-red-200 hover:bg-red-100"
                        onClick={(e) => { e.stopPropagation(); quitar(l.key); }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  <div className="w-28 text-right">
                    <div className="text-lg font-bold text-slate-900">{dinero(calc?.total ?? 0)}</div>
                    {calc && Number(calc.descuentoPromocion) + Number(calc.descuentoManual) > 0 && (
                      <div className="text-xs text-marca-700">ahorro {dinero(Number(calc.descuentoPromocion) + Number(calc.descuentoManual))}</div>
                    )}
                  </div>
                </div>
              );
            })}
            {!venta.lineas.length && (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-slate-400">
                {ultimaVenta ? (
                  <div className="w-full rounded-2xl bg-gradient-to-br from-marca-50 to-white p-6 text-slate-800 ring-1 ring-marca-100">
                    <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-marca-600 text-3xl text-white shadow-lg shadow-marca-600/30">✓</div>
                    <div className="text-lg text-slate-500">Ticket {ultimaVenta.numero} · Total {dinero(ultimaVenta.total)}</div>
                    <div className="mt-3 text-lg font-semibold uppercase tracking-wide text-slate-600">Cambio para el cliente</div>
                    <div className="text-6xl font-extrabold text-marca-700">{dinero(ultimaVenta.vuelto)}</div>
                  </div>
                ) : (
                  <div className="w-full max-w-sm space-y-4 text-left text-slate-600">
                    <div className="mb-2 text-center text-5xl opacity-60">🛒</div>
                    {[
                      'Pase el producto por el lector o tóquelo a la derecha',
                      'Toque el botón verde COBRAR',
                      'Entregue el cambio y el recibo',
                    ].map((t, i) => (
                      <div key={t} className="flex items-center gap-3 text-xl">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-marca-100 font-bold text-marca-700">
                          {i + 1}
                        </span>
                        {t}
                      </div>
                    ))}
                    {venta.multiplicador && (
                      <div className="rounded bg-amber-100 p-2 text-center text-lg font-semibold text-amber-900">
                        Próximo producto × {venta.multiplicador}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Totales */}
          <div className="bg-slate-900 px-5 py-4 text-white">
            <div className="flex justify-between text-base text-slate-300">
              <span>Subtotal</span>
              <span>{dinero(totales?.subtotal ?? 0)}</span>
            </div>
            {(params.regional.impuestos.some((i) => i.tasa > 0) || Number(totales?.impuesto ?? 0) > 0) && (
              <div className="flex justify-between text-base text-slate-300">
                <span>{params.regional.nombreImpuesto}</span>
                <span>{dinero(totales?.impuesto ?? 0)}</span>
              </div>
            )}
            {Number(totales?.descuento ?? 0) > 0 && (
              <div className="flex justify-between font-semibold text-emerald-300">
                <span>Ahorro</span>
                <span>-{dinero(totales!.descuento)}</span>
              </div>
            )}
            <div className="mt-2 flex items-end justify-between border-t border-white/15 pt-2">
              <span className="pb-1 text-xl font-semibold uppercase tracking-widest text-slate-300">Total</span>
              <span className="text-5xl font-extrabold tracking-tight">{dinero(totales?.total ?? 0)}</span>
            </div>
            {venta.multiplicador && venta.lineas.length > 0 && (
              <div className="mt-2 rounded-lg bg-amber-400 p-1.5 text-center font-bold text-amber-950">Próximo producto × {venta.multiplicador}</div>
            )}
          </div>
        </section>

        {/* Productos y acciones */}
        <section className="flex flex-1 flex-col overflow-hidden">
          <div className="flex gap-2 overflow-x-auto px-3 pb-1 pt-3">
            <button
              onClick={() => { setCategoria('favoritos'); setPaginaGrilla(0); }}
              className={`btn-touch shrink-0 rounded-full px-5 ${
                categoria === 'favoritos' ? 'bg-amber-500 text-white shadow-md shadow-amber-500/30' : 'bg-white text-slate-700 shadow-sm ring-1 ring-slate-200'
              }`}
            >
              ★ Favoritos
            </button>
            {catalogo.categorias.map((c) => {
              const activa = categoria === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => { setCategoria(c.id); setPaginaGrilla(0); }}
                  style={activa ? { backgroundColor: c.color ?? '#334155' } : undefined}
                  className={`btn-touch flex shrink-0 items-center gap-2 rounded-full px-5 ${
                    activa ? 'text-white shadow-md' : 'bg-white text-slate-700 shadow-sm ring-1 ring-slate-200'
                  }`}
                >
                  {!activa && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color ?? '#94a3b8' }} />}
                  {c.nombre}
                </button>
              );
            })}
          </div>

          <div
            className="scroll-touch grid flex-1 content-start gap-3 p-3"
            style={{
              gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))`,
              gridAutoRows: params.caja.tamanoBotones === 'GRANDE' ? '140px' : '110px',
            }}
          >
            {productosVisibles.map((p) => {
              const color = p.color ?? catalogo.categorias.find((c) => c.id === p.categoriaId)?.color ?? '#94a3b8';
              const conImagen = !!p.imagen && params.caja.mostrarImagenes;
              return (
                <button
                  key={p.id}
                  onClick={() => agregarProducto(p)}
                  className="btn-touch group relative flex flex-col items-center justify-end overflow-hidden rounded-2xl bg-white p-2 pt-3 text-center shadow-sm ring-1 ring-slate-200 hover:shadow-md hover:ring-slate-300"
                >
                  <span className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: color }} />
                  {conImagen ? (
                    <img src={urlMedia(p.imagen!)!} loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-20" />
                  ) : (
                    <span
                      className="relative mb-auto mt-1 flex h-9 w-9 items-center justify-center rounded-full text-base font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {p.nombre.trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className={`relative line-clamp-2 font-semibold leading-tight text-slate-800 ${params.caja.tamanoBotones === 'GRANDE' ? 'text-lg' : 'text-base'}`}>
                    {p.nombre}
                  </span>
                  <span className="relative mt-1 rounded-full bg-marca-50 px-2.5 py-0.5 text-sm font-bold text-marca-700">
                    {dinero(p.precio)}
                    {p.pesable ? '/kg' : ''}
                  </span>
                  {p.pesable && (
                    <span className="absolute right-1.5 top-2.5 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">⚖ PESO</span>
                  )}
                </button>
              );
            })}
            {!productosVisibles.length && (
              <div className="col-span-full p-6 text-center text-slate-400">
                {categoria === 'favoritos' ? 'No hay favoritos. Márquelos en Administración → Productos.' : 'Sin productos en esta categoría.'}
              </div>
            )}
          </div>
          {totalPaginas > 1 && (
            <div className="flex items-center justify-center gap-3 pb-2">
              <Boton className="h-12 min-h-0 w-20" disabled={pag === 0} onClick={() => setPaginaGrilla(pag - 1)}>
                ◀
              </Boton>
              <span className="text-lg">
                {pag + 1} / {totalPaginas}
              </span>
              <Boton className="h-12 min-h-0 w-20" disabled={pag >= totalPaginas - 1} onClick={() => setPaginaGrilla(pag + 1)}>
                ▶
              </Boton>
            </div>
          )}

          {/* Barra de acciones táctil */}
          {/* Solo lo que se usa en cada venta; lo demás está en «Más opciones» */}
          <div className="m-3 mt-0 grid grid-cols-4 gap-2 rounded-2xl bg-white p-2 shadow-lg ring-1 ring-slate-200">
            <Boton className="text-xl" onClick={() => setModal({ tipo: 'buscar' })} atajo={ATAJOS.buscar}>
              🔍 Buscar
            </Boton>
            <Boton className="text-xl" onClick={() => setModal({ tipo: 'cantidad' })} atajo={ATAJOS.cantidad}>
              🔢 Cantidad
            </Boton>
            <Boton
              variante={lineaSel ? 'peligro' : 'secundario'}
              className="text-xl"
              onClick={() => (lineaSel ? quitar(lineaSel.key) : toast.info(sinSeleccion))}
              atajo={ATAJOS.quitar}
            >
              Quitar
            </Boton>
            {venta.lineas.length ? (
              <Boton variante="alerta" className="text-xl" onClick={suspender} atajo={ATAJOS.suspender}>
                En espera
              </Boton>
            ) : (
              <Boton variante={enEspera ? 'alerta' : 'secundario'} className="text-xl" onClick={() => setModal({ tipo: 'suspendidas' })} atajo={ATAJOS.recuperar}>
                Recuperar{enEspera ? ` (${enEspera})` : ''}
              </Boton>
            )}
            <Boton variante="neutro" className="text-xl" onClick={() => setModal({ tipo: 'masOpciones' })} atajo={ATAJOS.masOpciones}>
              ☰ Más opciones
            </Boton>
            <Boton
              variante="primario"
              className="col-span-3 min-h-[80px] bg-gradient-to-r from-marca-600 to-marca-700 text-3xl font-extrabold tracking-wide"
              disabled={!venta.lineas.length || !totales}
              onClick={() => setModal({ tipo: 'cobro' })}
              atajo={ATAJOS.cobrar}
            >
              💵 COBRAR {totales && venta.lineas.length ? dinero(totales.total) : ''}
            </Boton>
          </div>
        </section>
      </div>

      {/* Modales */}
      {modal?.tipo === 'masOpciones' && <MasOpcionesModal opciones={opciones} onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'ayuda' && <AyudaModal onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'cancelar' && (
        <ConfirmarModal
          titulo="¿Cancelar toda la venta?"
          mensaje={
            <>
              Se borrarán <b>{venta.lineas.length} productos</b> por <b>{dinero(totales?.total ?? 0)}</b>.
              {!puede(PERMISOS.VENTA_ANULAR_ITEM) && <div className="mt-2 text-base text-slate-500">Necesitará la autorización de un supervisor.</div>}
            </>
          }
          textoSi="Sí, cancelar venta"
          onSi={cancelarVenta}
          onNo={() => setModal(null)}
        />
      )}
      {modal?.tipo === 'buscar' && (
        <BuscarModal
          key={modal.aviso ?? ''}
          aviso={modal.aviso}
          onCerrar={() => setModal(null)}
          onElegir={(p) => {
            setModal(null);
            agregarProducto(p);
          }}
        />
      )}
      {modal?.tipo === 'pesar' && (
        <PesarModal
          producto={modal.producto}
          onCerrar={() => setModal(null)}
          onAceptar={(kg) => {
            venta.agregar(modal.producto, kg);
            setModal(null);
          }}
        />
      )}
      {modal?.tipo === 'cantidad' && (
        <ModalNumero
          titulo={lineaSel && !lineaSel.pesable ? `¿Cuántas unidades de ${lineaSel.nombre}?` : '¿Cuántas unidades del próximo producto?'}
          descripcion={
            lineaSel && !lineaSel.pesable
              ? `Ahora hay ${fmtCantidad(lineaSel.cantidad, lineaSel.unidad)}. Escriba la cantidad total y toque Aceptar.`
              : 'Escriba el número, toque Aceptar y luego pase el producto por el lector.'
          }
          onCerrar={() => setModal(null)}
          onAceptar={async (v) => {
            const n = Number(v);
            if (n <= 0) return;
            if (lineaSel && !lineaSel.pesable) {
              const delta = n - Number(lineaSel.cantidad);
              setModal(null);
              if (delta !== 0) await cambiarCantidad(lineaSel.key, delta);
            } else {
              venta.setMultiplicador(Math.round(n));
              setModal(null);
            }
          }}
          decimales={false}
        />
      )}
      {modal?.tipo === 'descuento' && lineaSel && (
        <ModalNumero titulo={`Descuento: ${lineaSel.nombre}`} sufijo="%" onCerrar={() => setModal(null)} onAceptar={aplicarDescuento} />
      )}
      {modal?.tipo === 'precio' && lineaSel && (
        <ModalNumero titulo={`Nuevo precio: ${lineaSel.nombre}`} descripcion={`Precio de lista: ${dinero(lineaSel.precioLista)}`} onCerrar={() => setModal(null)} onAceptar={cambiarPrecio} />
      )}
      {modal?.tipo === 'cobro' && totales && (
        <CobroModal total={totales.total} procesando={procesando} onCerrar={() => setModal(null)} onCobrar={cobrar} />
      )}
      {modal?.tipo === 'ventas' && <VentasTurnoModal onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'movimiento' && <MovimientoCajaModal onCerrar={() => setModal(null)} />}
      {modal?.tipo === 'suspendidas' && (
        <SuspendidasModal
          onCerrar={() => {
            setModal(null);
            contarEnEspera();
          }}
          onRecuperar={(d) => {
            if (venta.lineas.length) {
              toast.error('Termine o ponga en espera la venta actual primero');
              return;
            }
            venta.restaurar(d);
            setUltimaVenta(null);
            setModal(null);
            contarEnEspera();
          }}
        />
      )}
      {modal?.tipo === 'cerrarTurno' && (
        <CerrarTurnoModal
          onCerrar={() => setModal(null)}
          onCerrado={() => {
            setModal(null);
            setTurno(null);
            cerrarSesion('Turno cerrado');
          }}
        />
      )}
    </div>
  );
}

/** Hora y fecha en el encabezado de la caja */
function Reloj() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="mr-1 text-right leading-tight">
      <div className="text-xl font-bold">{ahora.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</div>
      <div className="text-xs capitalize text-white/70">{ahora.toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
    </div>
  );
}
