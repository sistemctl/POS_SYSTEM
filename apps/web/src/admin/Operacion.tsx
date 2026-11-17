import { useEffect, useRef, useState } from 'react';
import { PERMISOS } from '@pos/shared';
import { del, get, post, put } from '../lib/api';
import { dinero } from '../lib/config';
import { usePermiso } from '../store/sesion';
import { useNavigate } from 'react-router-dom';
import { Boton, Campo, inputCls, Modal, NumPad, toast } from '../components/ui';
import { useModoServidor } from './AdminLayout';

function SelectorProductos({ valor, onChange }: { valor: string[]; onChange: (v: string[]) => void }) {
  const [buscar, setBuscar] = useState('');
  const [res, setRes] = useState<any[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  useEffect(() => {
    valor.forEach((id) => !nombres[id] && get(`/catalogo/productos/${id}`).then((p) => setNombres((n) => ({ ...n, [id]: p.nombre }))).catch(() => undefined));
  }, [valor]);
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {valor.map((id) => (
          <span key={id} className="flex items-center gap-1 rounded-full bg-marca-100 px-3 py-1">
            {nombres[id] ?? '…'}
            <button className="text-red-600" onClick={() => onChange(valor.filter((x) => x !== id))}>
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1`} placeholder="Buscar producto para agregar" value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        <Boton onClick={() => get(`/catalogo/productos?buscar=${encodeURIComponent(buscar)}&porPagina=10`).then((r) => setRes(r.items))}>Buscar</Boton>
      </div>
      {res.map((p) => (
        <button
          key={p.id}
          className="mt-1 block w-full rounded border p-2 text-left hover:bg-slate-50"
          onClick={() => {
            setNombres((n) => ({ ...n, [p.id]: p.nombre }));
            if (!valor.includes(p.id)) onChange([...valor, p.id]);
          }}
        >
          {p.nombre} · {dinero(p.precio)}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Promociones ─────────────────────────
export function Promociones() {
  const gestionar = usePermiso(PERMISOS.PROMOCION_GESTIONAR);
  const [items, setItems] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [ed, setEd] = useState<any | null>(null);
  const cargar = () => get('/catalogo/promociones').then(setItems).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
    get('/sucursales').then(setSucursales);
  }, []);

  const guardar = async () => {
    const fecha = (v: string | null) => (v ? new Date(v).toISOString() : null);
    const body = {
      nombre: ed.nombre,
      tipo: ed.tipo,
      productoIds: ed.productoIds,
      porcentaje: ed.tipo === 'PORCENTAJE' ? String(ed.porcentaje) : null,
      llevar: ed.tipo === 'NXM' ? Number(ed.llevar) : null,
      pagar: ed.tipo === 'NXM' ? Number(ed.pagar) : null,
      cantidadMinima: ed.tipo === 'PRECIO_CANTIDAD' ? String(ed.cantidadMinima) : null,
      precioPromo: ed.tipo === 'PRECIO_CANTIDAD' ? String(ed.precioPromo) : null,
      sucursalId: ed.sucursalId || null,
      desde: fecha(ed.desde),
      hasta: fecha(ed.hasta),
      activa: ed.activa,
    };
    try {
      ed.id ? await put(`/catalogo/promociones/${ed.id}`, body) : await post('/catalogo/promociones', body);
      setEd(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const descripcion = (p: any) =>
    p.tipo === 'NXM' ? `${p.llevar}x${p.pagar}` : p.tipo === 'PORCENTAJE' ? `${p.porcentaje}% de descuento` : `Desde ${p.cantidadMinima} a ${dinero(p.precioPromo)} c/u`;

  return (
    <div className="space-y-4">
      <div className="flex">
        <h1 className="flex-1 text-2xl font-bold">Promociones</h1>
        {gestionar && (
          <Boton variante="primario" onClick={() => setEd({ nombre: '', tipo: 'NXM', productoIds: [], llevar: 2, pagar: 1, porcentaje: 10, cantidadMinima: 3, precioPromo: '', sucursalId: '', desde: '', hasta: '', activa: true })}>
            + Nueva promoción
          </Boton>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {items.map((p) => (
          <button key={p.id} onClick={() => gestionar && setEd({ ...p, desde: p.desde?.slice(0, 10) ?? '', hasta: p.hasta?.slice(0, 10) ?? '', sucursalId: p.sucursalId ?? '' })} className="rounded-xl bg-white p-4 text-left shadow">
            <div className="text-lg font-bold">
              {p.nombre} {!p.activa && <span className="text-red-600">(inactiva)</span>}
            </div>
            <div className="text-slate-600">{descripcion(p)}</div>
            <div className="text-sm text-slate-500">
              {p.productoIds.length} producto(s) · {p.desde ? new Date(p.desde).toLocaleDateString('es') : 'sin inicio'} → {p.hasta ? new Date(p.hasta).toLocaleDateString('es') : 'sin fin'}
            </div>
          </button>
        ))}
      </div>
      {ed && (
        <Modal titulo={ed.id ? 'Editar promoción' : 'Nueva promoción'} onCerrar={() => setEd(null)} ancho="max-w-3xl">
          <div className="grid grid-cols-2 gap-3">
            <Campo etiqueta="Nombre (aparece en el ticket y la caja)">
              <input className={inputCls} value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="Tipo">
              <select className={inputCls} value={ed.tipo} onChange={(e) => setEd({ ...ed, tipo: e.target.value })}>
                <option value="NXM">Lleva N paga M (2x1, 3x2…)</option>
                <option value="PORCENTAJE">Porcentaje de descuento</option>
                <option value="PRECIO_CANTIDAD">Precio especial por cantidad</option>
              </select>
            </Campo>
            {ed.tipo === 'NXM' && (
              <>
                <Campo etiqueta="Lleva">
                  <input className={inputCls} type="number" value={ed.llevar ?? ''} onChange={(e) => setEd({ ...ed, llevar: e.target.value })} />
                </Campo>
                <Campo etiqueta="Paga">
                  <input className={inputCls} type="number" value={ed.pagar ?? ''} onChange={(e) => setEd({ ...ed, pagar: e.target.value })} />
                </Campo>
              </>
            )}
            {ed.tipo === 'PORCENTAJE' && (
              <Campo etiqueta="Porcentaje">
                <input className={inputCls} type="number" value={ed.porcentaje ?? ''} onChange={(e) => setEd({ ...ed, porcentaje: e.target.value })} />
              </Campo>
            )}
            {ed.tipo === 'PRECIO_CANTIDAD' && (
              <>
                <Campo etiqueta="Cantidad mínima">
                  <input className={inputCls} type="number" value={ed.cantidadMinima ?? ''} onChange={(e) => setEd({ ...ed, cantidadMinima: e.target.value })} />
                </Campo>
                <Campo etiqueta="Precio unitario promocional">
                  <input className={inputCls} type="number" step="0.01" value={ed.precioPromo ?? ''} onChange={(e) => setEd({ ...ed, precioPromo: e.target.value })} />
                </Campo>
              </>
            )}
            <Campo etiqueta="Sucursal">
              <select className={inputCls} value={ed.sucursalId} onChange={(e) => setEd({ ...ed, sucursalId: e.target.value })}>
                <option value="">Todas</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" className="h-7 w-7" checked={ed.activa} onChange={(e) => setEd({ ...ed, activa: e.target.checked })} />
              Activa
            </label>
            <Campo etiqueta="Desde">
              <input className={inputCls} type="date" value={ed.desde ?? ''} onChange={(e) => setEd({ ...ed, desde: e.target.value })} />
            </Campo>
            <Campo etiqueta="Hasta">
              <input className={inputCls} type="date" value={ed.hasta ?? ''} onChange={(e) => setEd({ ...ed, hasta: e.target.value })} />
            </Campo>
            <div className="col-span-2">
              <Campo etiqueta="Productos">
                <SelectorProductos valor={ed.productoIds} onChange={(v) => setEd({ ...ed, productoIds: v })} />
              </Campo>
            </div>
          </div>
          <div className="mt-4 flex justify-between">
            {ed.id ? (
              <Boton variante="peligro" onClick={async () => { await del(`/catalogo/promociones/${ed.id}`).catch((e) => toast.error(e.message)); setEd(null); cargar(); }}>
                Eliminar
              </Boton>
            ) : <span />}
            <Boton variante="primario" className="w-48" onClick={guardar}>
              Guardar
            </Boton>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────── Inventario ─────────────────────────
const TIPO_MOV: Record<string, string> = {
  VENTA: 'Venta',
  ANULACION: 'Venta anulada (regresa)',
  COMPRA: 'Llegó mercancía',
  AJUSTE: 'Corrección por conteo',
  MERMA: 'Pérdida',
  TRANSFERENCIA_ENTRADA: 'Recibido de otra tienda',
  TRANSFERENCIA_SALIDA: 'Enviado a otra tienda',
};
const MOTIVOS_PERDIDA = ['Vencido', 'Dañado', 'Robo', 'Consumo interno'];

/** Muestra una cantidad sin ceros de más: 12, 1,25 kg… */
const cant = (v: string | number, unidad?: string) =>
  `${Number(v).toLocaleString('es', { maximumFractionDigits: 3 })}${unidad ? ' ' + unidad.toLowerCase() : ''}`;

type Accion = 'ENTRADA' | 'CONTEO' | 'PERDIDA';

export function Inventario() {
  const nav = useNavigate();
  const modo = useModoServidor();
  // Entradas, conteos y pérdidas se registran en el servidor de la tienda (el central no tiene sucursal propia)
  const enTienda = modo === 'store';
  const puedeComprar = usePermiso(PERMISOS.COMPRA_REGISTRAR) && enTienda;
  const puedeAjustar = usePermiso(PERMISOS.INVENTARIO_AJUSTAR) && enTienda;
  const [buscar, setBuscar] = useState('');
  const [bajoMinimo, setBajoMinimo] = useState(false);
  const [stock, setStock] = useState<any[]>([]);
  const [producto, setProducto] = useState<any | null>(null);
  const [historial, setHistorial] = useState<any[] | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState('');
  const [nota, setNota] = useState('');
  const [guardando, setGuardando] = useState(false);
  const buscarRef = useRef<HTMLInputElement>(null);

  const cargar = async (texto = buscar, abrirSiUnico = false) => {
    try {
      const r = await get(`/inventario/stock?buscar=${encodeURIComponent(texto.trim())}&bajoMinimo=${bajoMinimo}`);
      setStock(r);
      // Si se escaneó un código y hay un solo producto, se abre directo
      if (abrirSiUnico && r.length === 1) abrir(r[0]);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  // Busca mientras se escribe (con una pequeña pausa)
  useEffect(() => {
    const t = setTimeout(() => cargar(), 300);
    return () => clearTimeout(t);
  }, [buscar, bajoMinimo]);

  const abrir = (p: any) => {
    setProducto(p);
    setAccion(null);
    setHistorial(null);
  };
  const cerrar = () => {
    setProducto(null);
    setAccion(null);
    setHistorial(null);
    setTimeout(() => buscarRef.current?.focus(), 50);
  };
  const elegir = (a: Accion) => {
    setAccion(a);
    setCantidad('');
    setCosto(a === 'ENTRADA' && Number(producto.costo) > 0 ? String(Number(producto.costo)) : '');
    setNota(a === 'PERDIDA' ? MOTIVOS_PERDIDA[0] : '');
  };
  const verHistorial = () =>
    get(`/inventario/kardex/${producto.id}`)
      .then(setHistorial)
      .catch((e) => toast.error(e.message));

  const diferencia = accion === 'CONTEO' && cantidad !== '' ? Number(cantidad) - Number(producto?.stock ?? 0) : null;

  const guardar = async () => {
    if (!producto || !accion) return;
    if (cantidad === '' || (accion !== 'CONTEO' && Number(cantidad) <= 0)) return toast.error('Escriba la cantidad');
    setGuardando(true);
    try {
      if (accion === 'ENTRADA') {
        await post('/inventario/compras', { documento: nota.trim() || null, items: [{ productoId: producto.id, cantidad, costoUnitario: costo || undefined }] });
        toast.ok(`Se sumaron ${cant(cantidad, producto.unidad)}`);
      } else if (accion === 'CONTEO') {
        await post('/inventario/conteo', { motivo: nota.trim() || null, items: [{ productoId: producto.id, contado: cantidad }] });
        toast.ok(diferencia === 0 ? 'El conteo coincide, no hubo cambios' : `Inventario corregido a ${cant(cantidad, producto.unidad)}`);
      } else {
        await post('/inventario/ajustes', { tipo: 'MERMA', motivo: nota.trim().length >= 3 ? nota.trim() : 'Pérdida', items: [{ productoId: producto.id, cantidad }] });
        toast.ok(`Se descontaron ${cant(cantidad, producto.unidad)}`);
      }
      cerrar();
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const tituloAccion: Record<Accion, string> = {
    ENTRADA: '¿Cuántas llegaron?',
    CONTEO: '¿Cuántas hay realmente?',
    PERDIDA: '¿Cuántas se perdieron?',
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Inventario</h1>
        {puedeComprar && (
          <Boton variante="primario" onClick={() => nav('/admin/recibir')}>
            📦 Recibir mercancía
          </Boton>
        )}
        <div className="flex overflow-hidden rounded-lg border-2 border-slate-300">
          <button className={`btn-touch px-4 ${!bajoMinimo ? 'bg-marca-600 text-white' : 'bg-white'}`} onClick={() => setBajoMinimo(false)}>
            Todos
          </button>
          <button className={`btn-touch px-4 ${bajoMinimo ? 'bg-red-600 text-white' : 'bg-white'}`} onClick={() => setBajoMinimo(true)}>
            Por reponer
          </button>
        </div>
      </div>
      <input
        ref={buscarRef}
        autoFocus
        className={`${inputCls} w-full text-xl`}
        placeholder="Escanee el código o escriba el nombre del producto"
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && cargar(buscar, true)}
      />
      {modo === 'central' ? (
        <p className="rounded-lg bg-amber-50 p-3 text-amber-800">
          Aquí ve las existencias de todas las tiendas juntas. Para recibir mercancía, contar o registrar pérdidas, abra esta pantalla en el servidor de la tienda.
        </p>
      ) : (
        <p className="text-sm text-slate-500">Toque un producto para registrar mercancía que llegó, corregir la cantidad o descontar pérdidas.</p>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow">
        {stock.length === 0 && <p className="p-6 text-center text-slate-500">No se encontraron productos.</p>}
        {stock.map((p) => (
          <button key={p.id} type="button" onClick={() => abrir(p)} className={`flex w-full items-center gap-4 border-t px-4 py-3 text-left first:border-t-0 active:bg-slate-100 ${p.bajoMinimo ? 'bg-red-50' : ''}`}>
            <span className="flex-1">
              <span className="block text-lg font-medium">{p.nombre}</span>
              <span className="text-sm text-slate-500">Código {p.sku} · mínimo {cant(p.stockMinimo)}</span>
            </span>
            {p.bajoMinimo && <span className="rounded-full bg-red-600 px-3 py-1 text-sm font-bold text-white">Reponer</span>}
            <span className={`w-36 text-right text-2xl font-bold ${Number(p.stock) < 0 || p.bajoMinimo ? 'text-red-600' : ''}`}>{cant(p.stock, p.unidad)}</span>
          </button>
        ))}
      </div>

      {producto && (
        <Modal titulo={producto.nombre} onCerrar={cerrar} ancho={historial ? 'max-w-4xl' : 'max-w-lg'}>
          <div className="mb-4 rounded-xl bg-slate-100 p-4 text-center">
            <div className="text-sm text-slate-500">Hay en la tienda</div>
            <div className={`text-4xl font-bold ${Number(producto.stock) < 0 || producto.bajoMinimo ? 'text-red-600' : ''}`}>{cant(producto.stock, producto.unidad)}</div>
            {Number(producto.stock) < 0 && <div className="mt-1 text-sm text-red-600">Se vendió más de lo registrado. Haga un conteo para corregirlo.</div>}
          </div>

          {!accion && !historial && (
            <div className="grid gap-3">
              {puedeComprar && (
                <Boton variante="primario" className="h-16 text-lg" onClick={() => elegir('ENTRADA')}>
                  ➕ Llegó mercancía
                </Boton>
              )}
              {puedeAjustar && (
                <Boton variante="info" className="h-16 text-lg" onClick={() => elegir('CONTEO')}>
                  🔢 Contar y corregir
                </Boton>
              )}
              {puedeAjustar && (
                <Boton variante="alerta" className="h-16 text-lg" onClick={() => elegir('PERDIDA')}>
                  ➖ Pérdida (vencido, dañado…)
                </Boton>
              )}
              <Boton className="h-14" onClick={verHistorial}>
                Ver historial
              </Boton>
            </div>
          )}

          {accion && (
            <div className="space-y-3">
              <div className="text-lg font-bold">{tituloAccion[accion]}</div>
              <input className={`${inputCls} w-full text-center text-3xl`} inputMode="decimal" autoFocus value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && guardar()} />
              <NumPad valor={cantidad} onChange={setCantidad} decimales={producto.pesable || producto.unidad !== 'UND'} />

              {diferencia !== null && (
                <div className={`rounded-lg p-3 text-center text-lg ${diferencia === 0 ? 'bg-slate-100' : diferencia > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {diferencia === 0 ? 'Coincide con el sistema' : diferencia > 0 ? `Se sumarán ${cant(diferencia, producto.unidad)}` : `Se descontarán ${cant(-diferencia, producto.unidad)}`}
                </div>
              )}

              {accion === 'ENTRADA' && (
                <>
                  <Campo etiqueta="Costo por unidad (opcional)">
                    <input className={`${inputCls} w-full`} inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value.replace(',', '.').replace(/[^0-9.]/g, ''))} />
                  </Campo>
                  <Campo etiqueta="N.º de factura (opcional)">
                    <input className={`${inputCls} w-full`} value={nota} onChange={(e) => setNota(e.target.value)} />
                  </Campo>
                </>
              )}
              {accion === 'PERDIDA' && (
                <div className="grid grid-cols-2 gap-2">
                  {MOTIVOS_PERDIDA.map((m) => (
                    <button key={m} type="button" onClick={() => setNota(m)} className={`btn-touch h-12 border-2 ${nota === m ? 'border-amber-500 bg-amber-50 font-bold' : 'border-slate-300 bg-white'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-2">
                <Boton className="h-14" onClick={() => setAccion(null)}>
                  Volver
                </Boton>
                <Boton variante="primario" className="h-14 text-lg" disabled={guardando || cantidad === ''} onClick={guardar}>
                  {guardando ? 'Guardando…' : 'Guardar'}
                </Boton>
              </div>
            </div>
          )}

          {historial && (
            <div className="space-y-3">
              <table className="w-full text-left">
                <thead className="text-sm text-slate-500">
                  <tr>
                    <th>Fecha</th>
                    <th>Qué pasó</th>
                    <th className="text-right">Cantidad</th>
                    <th className="text-right">Quedaron</th>
                    <th className="pl-3">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {historial.map((m) => (
                    <tr key={m.id} className="border-t">
                      <td className="py-2 text-sm">{new Date(m.creadoEn).toLocaleString('es')}</td>
                      <td>{TIPO_MOV[m.tipo] ?? m.tipo}</td>
                      <td className={`text-right font-mono ${Number(m.cantidad) < 0 ? 'text-red-600' : 'text-marca-700'}`}>
                        {Number(m.cantidad) > 0 ? '+' : ''}
                        {cant(m.cantidad)}
                      </td>
                      <td className="text-right font-mono font-bold">{cant(m.saldo)}</td>
                      <td className="pl-3 text-sm text-slate-500">{m.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {historial.length === 0 && <p className="text-center text-slate-500">Todavía no hay movimientos.</p>}
              <Boton className="h-14 w-full" onClick={() => setHistorial(null)}>
                Volver
              </Boton>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────── Turnos ─────────────────────────
export function Turnos() {
  const [turnos, setTurnos] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<Record<string, string>>({});
  const [detalle, setDetalle] = useState<any | null>(null);
  useEffect(() => {
    get('/turnos').then(setTurnos).catch((e) => toast.error(e.message));
    get('/usuarios').then((u: any[]) => setUsuarios(Object.fromEntries(u.map((x) => [x.id, x.nombre])))).catch(() => undefined);
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Turnos y arqueos</h1>
      <table className="w-full rounded-xl bg-white text-left shadow">
        <thead className="bg-slate-100 text-sm text-slate-600">
          <tr>
            <th className="p-3">Apertura</th>
            <th>Cajero</th>
            <th>Estado</th>
            <th className="text-right">Esperado</th>
            <th className="text-right">Contado</th>
            <th className="text-right">Diferencia</th>
          </tr>
        </thead>
        <tbody>
          {turnos.map((t) => (
            <tr key={t.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => get(`/turnos/${t.id}/resumen`).then(setDetalle)}>
              <td className="p-3">{new Date(t.abiertoEn).toLocaleString('es')}</td>
              <td>{usuarios[t.usuarioId] ?? '…'}</td>
              <td>{t.estado}</td>
              <td className="text-right">{t.montoCierreEsperado ? dinero(t.montoCierreEsperado) : '—'}</td>
              <td className="text-right">{t.montoCierreDeclarado ? dinero(t.montoCierreDeclarado) : '—'}</td>
              <td className={`text-right font-bold ${Number(t.diferencia ?? 0) < 0 ? 'text-red-600' : Number(t.diferencia ?? 0) > 0 ? 'text-amber-600' : ''}`}>
                {t.diferencia !== null && t.diferencia !== undefined ? dinero(t.diferencia) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detalle && (
        <Modal titulo="Resumen del turno" onCerrar={() => setDetalle(null)}>
          <div className="space-y-1 text-lg">
            <div>Ventas: {detalle.cantidadVentas} · {dinero(detalle.totalVentas)}</div>
            <div>Anuladas: {detalle.anuladas} · {dinero(detalle.totalAnulado)}</div>
            <div>Descuentos: {dinero(detalle.totalDescuentos)}</div>
            {Object.entries(detalle.porMetodo as Record<string, string>).map(([m, v]) => (
              <div key={m}>
                {m}: {dinero(v)}
              </div>
            ))}
            <div>Fondo inicial: {dinero(detalle.montoInicial)}</div>
            <div>Retiros: {dinero(detalle.retiros)} · Ingresos: {dinero(detalle.ingresos)}</div>
            <div className="font-bold">Efectivo esperado: {dinero(detalle.efectivoEsperado)}</div>
          </div>
        </Modal>
      )}
    </div>
  );
}
