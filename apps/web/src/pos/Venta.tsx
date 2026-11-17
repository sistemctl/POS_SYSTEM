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
import { Boton, toast } from '../components/ui';
import { conAutorizacion, solicitarAutorizacion } from '../components/Autorizacion';
import { EstadoConexion } from '../components/EstadoConexion';
import { ATAJOS } from './shortcuts';
import { BuscarModal } from './BuscarModal';
import { CobroModal } from './CobroModal';
import { ModalNumero } from './ModalNumero';
import { PesarModal } from './PesarModal';
import { CerrarTurnoModal, MovimientoCajaModal, SuspendidasModal, VentasTurnoModal } from './ModalesCaja';
import AbrirTurno from '../pages/AbrirTurno';

type ModalAbierto =
  | { tipo: 'buscar' }
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
  const params = useParametros((s) => s.p);

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
        toast.error(`Producto no encontrado: ${codigo}`);
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
      toast.ok('Venta puesta en espera');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const cancelarVenta = async () => {
    if (!venta.lineas.length) return;
    if (!confirm('¿Cancelar toda la venta?')) return;
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

  // ── Atajos de teclado ──
  const sinModal = modal === null;
  useShortcuts(
    {
      [ATAJOS.buscar]: () => setModal({ tipo: 'buscar' }),
      [ATAJOS.cantidad]: () => setModal({ tipo: 'cantidad' }),
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
      <header className="flex items-center gap-3 bg-marca-800 px-4 py-2 text-white">
        {params.marca.logoId && <img src={urlMedia(params.marca.logoId)!} className="h-10 max-w-[120px] rounded bg-white object-contain p-0.5" />}
        <div className="text-xl font-bold">{cfg.cajaNombre}</div>
        <div className="text-lg opacity-90">· {usuario.nombre}</div>
        <div className="flex-1" />
        <EstadoConexion />
        <Boton variante="neutro" className="h-12 min-h-0" onClick={() => setModal({ tipo: 'ventas' })} atajo={ATAJOS.ventas}>
          Ventas
        </Boton>
        <Boton variante="neutro" className="h-12 min-h-0" onClick={() => setModal({ tipo: 'movimiento' })}>
          Retiro / Ingreso
        </Boton>
        <Boton variante="neutro" className="h-12 min-h-0" disabled={!!venta.lineas.length} onClick={() => setModal({ tipo: 'cerrarTurno' })} atajo={ATAJOS.cerrarTurno}>
          Cerrar turno
        </Boton>
        {puede(PERMISOS.PRODUCTO_GESTIONAR) || puede(PERMISOS.REPORTE_SUCURSAL) ? (
          <Boton variante="neutro" className="h-12 min-h-0" onClick={() => nav('/admin')}>
            Admin
          </Boton>
        ) : null}
        <Boton variante="peligro" className="h-12 min-h-0" disabled={!!venta.lineas.length} onClick={() => cerrarSesion()}>
          Salir
        </Boton>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Ticket */}
        <section className="flex w-[42%] min-w-[420px] flex-col border-r bg-white">
          <div className="scroll-touch flex-1">
            {venta.lineas.map((l, i) => {
              const calc = totales?.lineas[i];
              const sel = l.key === venta.seleccion;
              return (
                <div
                  key={l.key}
                  onClick={() => venta.seleccionar(l.key)}
                  className={`flex items-center gap-2 border-b px-3 py-2 ${sel ? 'bg-marca-50 ring-2 ring-inset ring-marca-500' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-lg font-semibold">{l.nombre}</div>
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
                  {!l.pesable && (
                    <div className="flex items-center gap-1">
                      <button className="btn-touch h-12 min-h-0 w-12 bg-slate-100 text-2xl" onClick={(e) => { e.stopPropagation(); cambiarCantidad(l.key, -1); }}>
                        −
                      </button>
                      <button className="btn-touch h-12 min-h-0 w-12 bg-slate-100 text-2xl" onClick={(e) => { e.stopPropagation(); cambiarCantidad(l.key, 1); }}>
                        +
                      </button>
                    </div>
                  )}
                  <div className="w-28 text-right">
                    <div className="text-lg font-bold">{dinero(calc?.total ?? 0)}</div>
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
                  <div className="w-full rounded-2xl bg-marca-50 p-6 text-slate-800">
                    <div className="text-lg">Ticket {ultimaVenta.numero}</div>
                    <div className="text-xl">Total {dinero(ultimaVenta.total)}</div>
                    <div className="mt-2 text-lg text-slate-600">Vuelto</div>
                    <div className="text-6xl font-bold text-marca-700">{dinero(ultimaVenta.vuelto)}</div>
                  </div>
                ) : (
                  <>
                    <div className="text-2xl">Escanee o toque un producto</div>
                    <div>{venta.multiplicador ? `Cantidad: ${venta.multiplicador}` : ''}</div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Totales */}
          <div className="border-t bg-slate-50 p-3">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{dinero(totales?.subtotal ?? 0)}</span>
            </div>
            {(params.regional.impuestos.some((i) => i.tasa > 0) || Number(totales?.impuesto ?? 0) > 0) && (
              <div className="flex justify-between text-slate-600">
                <span>{params.regional.nombreImpuesto}</span>
                <span>{dinero(totales?.impuesto ?? 0)}</span>
              </div>
            )}
            {Number(totales?.descuento ?? 0) > 0 && (
              <div className="flex justify-between font-semibold text-marca-700">
                <span>Ahorro</span>
                <span>-{dinero(totales!.descuento)}</span>
              </div>
            )}
            <div className="flex items-end justify-between">
              <span className="text-2xl font-bold">TOTAL</span>
              <span className="text-5xl font-extrabold">{dinero(totales?.total ?? 0)}</span>
            </div>
            {venta.multiplicador && venta.lineas.length > 0 && (
              <div className="mt-1 rounded bg-amber-100 p-1 text-center font-semibold">Próximo producto × {venta.multiplicador}</div>
            )}
          </div>
        </section>

        {/* Productos y acciones */}
        <section className="flex flex-1 flex-col overflow-hidden">
          <div className="flex gap-2 overflow-x-auto p-2">
            <Boton variante={categoria === 'favoritos' ? 'alerta' : 'secundario'} className="shrink-0" onClick={() => { setCategoria('favoritos'); setPaginaGrilla(0); }}>
              ★ Favoritos
            </Boton>
            {catalogo.categorias.map((c) => (
              <button
                key={c.id}
                onClick={() => { setCategoria(c.id); setPaginaGrilla(0); }}
                style={{ backgroundColor: categoria === c.id ? c.color ?? '#334155' : undefined }}
                className={`btn-touch shrink-0 px-4 ${categoria === c.id ? 'text-white' : 'border-2 border-slate-300 bg-white'}`}
              >
                {c.nombre}
              </button>
            ))}
          </div>

          <div
            className="scroll-touch grid flex-1 gap-2 p-2"
            style={{
              gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))`,
              gridAutoRows: params.caja.tamanoBotones === 'GRANDE' ? '140px' : '110px',
            }}
          >
            {productosVisibles.map((p) => (
              <button
                key={p.id}
                onClick={() => agregarProducto(p)}
                className="btn-touch relative flex flex-col items-center justify-center overflow-hidden border-b-4 bg-white p-2 text-center shadow-sm"
                style={{ borderBottomColor: p.color ?? catalogo.categorias.find((c) => c.id === p.categoriaId)?.color ?? '#94a3b8' }}
              >
                {p.imagen && params.caja.mostrarImagenes && (
                  <img src={urlMedia(p.imagen)!} loading="lazy" className="absolute inset-0 h-full w-full object-cover opacity-25" />
                )}
                <span className={`relative line-clamp-2 leading-tight ${params.caja.tamanoBotones === 'GRANDE' ? 'text-lg' : 'text-base'}`}>{p.nombre}</span>
                <span className="relative mt-1 text-sm font-normal text-slate-600">
                  {dinero(p.precio)}
                  {p.pesable ? '/kg' : ''}
                </span>
                {p.pesable && <span className="absolute right-1 top-1 rounded bg-amber-100 px-1 text-[10px] text-amber-700">PESO</span>}
              </button>
            ))}
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
          <div className="grid grid-cols-6 gap-2 border-t bg-slate-200 p-2">
            <Boton onClick={() => setModal({ tipo: 'buscar' })} atajo={ATAJOS.buscar}>
              Buscar
            </Boton>
            <Boton onClick={() => setModal({ tipo: 'cantidad' })} atajo={ATAJOS.cantidad}>
              Cantidad
            </Boton>
            <Boton onClick={() => lineaSel && setModal({ tipo: 'descuento' })} disabled={!lineaSel} atajo={ATAJOS.descuento}>
              Descuento
            </Boton>
            <Boton onClick={() => lineaSel && setModal({ tipo: 'precio' })} disabled={!lineaSel}>
              Precio
            </Boton>
            <Boton variante="peligro" onClick={() => lineaSel && quitar(lineaSel.key)} disabled={!lineaSel} atajo={ATAJOS.quitar}>
              Quitar
            </Boton>
            <Boton variante="peligro" onClick={cancelarVenta} disabled={!venta.lineas.length}>
              Cancelar venta
            </Boton>
            <Boton onClick={suspender} disabled={!venta.lineas.length} atajo={ATAJOS.suspender}>
              En espera
            </Boton>
            <Boton onClick={() => setModal({ tipo: 'suspendidas' })} atajo={ATAJOS.recuperar}>
              Recuperar
            </Boton>
            <Boton
              onClick={async () => {
                try {
                  const t = await get('/ventas/ultima');
                  await imprimirTicket(t, cfg.moneda);
                } catch (e: any) {
                  toast.error(e.message);
                }
              }}
            >
              Reimprimir
            </Boton>
            {bridge() && puede(PERMISOS.CAJA_ABRIR_CAJON) ? (
              <Boton onClick={() => abrirCajon()}>Abrir cajón</Boton>
            ) : (
              <div />
            )}
            <Boton
              variante="primario"
              className="col-span-2 text-3xl"
              disabled={!venta.lineas.length || !totales}
              onClick={() => setModal({ tipo: 'cobro' })}
              atajo={ATAJOS.cobrar}
            >
              COBRAR {totales && venta.lineas.length ? dinero(totales.total) : ''}
            </Boton>
          </div>
        </section>
      </div>

      {/* Modales */}
      {modal?.tipo === 'buscar' && (
        <BuscarModal
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
          titulo="Cantidad"
          descripcion={lineaSel ? `Cambiar cantidad de ${lineaSel.nombre}, o fijar cantidad para el próximo producto` : 'Cantidad para el próximo producto'}
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
          onCerrar={() => setModal(null)}
          onRecuperar={(d) => {
            if (venta.lineas.length) {
              toast.error('Termine o ponga en espera la venta actual primero');
              return;
            }
            venta.restaurar(d);
            setModal(null);
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
