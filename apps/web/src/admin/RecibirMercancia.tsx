import { useEffect, useRef, useState } from 'react';
import { PERMISOS } from '@pos/shared';
import { ApiError, get, post } from '../lib/api';
import { dinero } from '../lib/config';
import { useParametros } from '../store/parametros';
import { usePermiso } from '../store/sesion';
import { Boton, Campo, inputCls, Modal, NumPad, toast } from '../components/ui';
import { useModoServidor } from './AdminLayout';
import { Camara, pitido } from './AltaRapida';

interface Linea {
  productoId: string;
  nombre: string;
  unidad: string;
  pesable: boolean;
  stock: string;
  cantidad: string;
  costo: string;
}
interface Borrador {
  lineas: Linea[];
  proveedor: string;
  factura: string;
}
interface Nuevo {
  codigo: string;
  nombre: string;
  precio: string;
  costo: string;
  cantidad: string;
  pesable: boolean;
  categoriaId: string;
  impuestoCodigo: string;
  masDatos: boolean;
}

const BORRADOR_KEY = 'pos.compra.borrador';
const PROVEEDORES_KEY = 'pos.compra.proveedores';
const ULTIMO_KEY = 'pos.altaRapida.ultimo';

function leer<T>(key: string, def: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') ?? def;
  } catch {
    return def;
  }
}
function escribir(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* sin almacenamiento local */
  }
}
const num = (v: string) => v.replace(',', '.').replace(/[^0-9.]/g, '');
const cant = (v: string | number) => Number(v || 0).toLocaleString('es', { maximumFractionDigits: 3 });

/**
 * Recibir mercancía: se escanea cada producto de la factura, se ajustan cantidades y se guarda todo junto.
 * Si un código no existe, se crea el producto ahí mismo (nombre + precio) sin salir de la pantalla.
 */
export default function RecibirMercancia() {
  const modo = useModoServidor();
  const puedeCrear = usePermiso(PERMISOS.PRODUCTO_GESTIONAR);
  const p = useParametros((s) => s.p);
  const impuestos = p.regional.impuestos;

  const [b, setB] = useState<Borrador>(() => leer(BORRADOR_KEY, { lineas: [], proveedor: '', factura: '' }));
  const [codigo, setCodigo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<any[] | null>(null);
  const [nuevo, setNuevo] = useState<Nuevo | null>(null);
  const [editar, setEditar] = useState<{ i: number; campo: 'cantidad' | 'costo'; valor: string } | null>(null);
  const [camara, setCamara] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [categorias, setCategorias] = useState<any[]>([]);
  const proveedores = leer<string[]>(PROVEEDORES_KEY, []);
  const refCodigo = useRef<HTMLInputElement>(null);

  // El borrador se guarda en este equipo: si se cierra la pantalla a mitad de factura no se pierde
  useEffect(() => escribir(BORRADOR_KEY, b), [b]);
  useEffect(() => {
    get('/catalogo/categorias').then(setCategorias).catch(() => undefined);
  }, []);

  const foco = () => setTimeout(() => refCodigo.current?.focus(), 50);

  /** Agrega el producto arriba de la lista; si ya estaba, suma (o pide los kilos si es por peso). */
  const agregar = (prod: any, cantidad?: string) => {
    const previa = b.lineas.find((l) => l.productoId === prod.id);
    const resto = b.lineas.filter((l) => l.productoId !== prod.id);
    let linea: Linea;
    if (previa) {
      linea = prod.pesable && !cantidad ? previa : { ...previa, cantidad: String(Number(previa.cantidad || 0) + Number(cantidad ?? 1)) };
    } else {
      linea = {
        productoId: prod.id,
        nombre: prod.nombre,
        unidad: prod.unidad,
        pesable: prod.pesable,
        stock: prod.stock ?? '0',
        cantidad: cantidad ?? (prod.pesable ? '' : '1'),
        costo: Number(prod.costo) > 0 ? String(Number(prod.costo)) : '',
      };
    }
    setB({ ...b, lineas: [linea, ...resto] });
    // Los productos por peso necesitan que se escriban los kilos
    if (prod.pesable && !cantidad) setEditar({ i: 0, campo: 'cantidad', valor: linea.cantidad });
  };

  const abrirNuevo = (cod: string) => {
    const ultimo = leer<any>(ULTIMO_KEY, {});
    setNuevo({
      codigo: cod,
      nombre: '',
      precio: '',
      costo: '',
      cantidad: '1',
      pesable: false,
      categoriaId: ultimo.categoriaId ?? '',
      impuestoCodigo: ultimo.impuestoCodigo ?? p.regional.impuestoPorDefecto,
      masDatos: false,
    });
  };

  const procesar = async (texto: string) => {
    const t = texto.trim();
    if (!t || buscando) return;
    setBuscando(true);
    setResultados(null);
    try {
      const prod = await get(`/inventario/producto/${encodeURIComponent(t)}`);
      agregar(prod);
      pitido(true);
      setCodigo('');
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) {
        pitido(false);
        toast.error((e as Error).message);
      } else if (/^\d{4,}$/.test(t)) {
        // Código de barras que no existe → producto nuevo
        pitido(false);
        setCodigo('');
        if (puedeCrear) abrirNuevo(t);
        else toast.error(`El código ${t} no existe. Pida a un supervisor que cree el producto.`);
      } else {
        // Texto → buscar por nombre
        const r = await get(`/inventario/stock?buscar=${encodeURIComponent(t)}`).catch(() => []);
        if (r.length === 1) {
          agregar(r[0]);
          setCodigo('');
        } else if (r.length) setResultados(r.slice(0, 30));
        else toast.error('No se encontró ningún producto con ese nombre');
      }
    } finally {
      setBuscando(false);
      foco();
    }
  };

  // Escáner por puerto serie (puente de Electron)
  const refProcesar = useRef(procesar);
  refProcesar.current = procesar;
  useEffect(() => window.pos?.scanner?.onCode((c) => refProcesar.current(c)), []);

  const crearProducto = async () => {
    if (!nuevo) return;
    if (!nuevo.nombre.trim()) return toast.error('Escriba el nombre del producto');
    if (!nuevo.precio || Number(nuevo.precio) <= 0) return toast.error('Escriba el precio de venta');
    if (!nuevo.cantidad || Number(nuevo.cantidad) <= 0) return toast.error('Escriba cuántas llegaron');
    const imp = impuestos.find((i) => i.codigo === nuevo.impuestoCodigo) ?? impuestos[0];
    const codigoBarras = nuevo.codigo.trim();
    setGuardando(true);
    try {
      escribir(ULTIMO_KEY, { categoriaId: nuevo.categoriaId, impuestoCodigo: imp.codigo });
      const prod = await post('/catalogo/productos/rapido', {
        sku: codigoBarras, // sin código de barras → el servidor asigna P00001…
        nombre: nuevo.nombre.trim(),
        categoriaId: nuevo.categoriaId || null,
        unidad: nuevo.pesable ? 'KG' : 'UND',
        pesable: nuevo.pesable,
        precio: nuevo.precio,
        costo: nuevo.costo || undefined,
        tasaImpuesto: String(imp.tasa),
        impuestoCodigo: imp.codigo,
        codigos: codigoBarras ? [codigoBarras] : [],
      });
      agregar({ ...prod, stock: '0', costo: nuevo.costo || '0' }, nuevo.cantidad);
      pitido(true);
      toast.ok(`Producto "${prod.nombre}" creado`);
      setNuevo(null);
      foco();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const cambiar = (i: number, cambios: Partial<Linea>) => setB((x) => ({ ...x, lineas: x.lineas.map((l, j) => (j === i ? { ...l, ...cambios } : l)) }));
  const quitar = (i: number) => setB((x) => ({ ...x, lineas: x.lineas.filter((_, j) => j !== i) }));
  const sumar = (i: number, d: number) => {
    const l = b.lineas[i];
    const v = Math.max(0, Number(l.cantidad || 0) + d);
    cambiar(i, { cantidad: String(v) });
  };

  const total = b.lineas.reduce((s, l) => s + Number(l.cantidad || 0) * Number(l.costo || 0), 0);
  const unidades = b.lineas.reduce((s, l) => s + (l.pesable ? 0 : Number(l.cantidad || 0)), 0);
  const incompletas = b.lineas.filter((l) => !(Number(l.cantidad) > 0));

  const guardar = async () => {
    if (!b.lineas.length) return toast.error('Escanee al menos un producto');
    if (incompletas.length) return toast.error(`Falta la cantidad de: ${incompletas.map((l) => l.nombre).join(', ')}`);
    setGuardando(true);
    try {
      await post('/inventario/compras', {
        proveedor: b.proveedor.trim() || null,
        documento: b.factura.trim() ? `Factura ${b.factura.trim()}` : null,
        items: b.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad, costoUnitario: l.costo || undefined })),
      });
      if (b.proveedor.trim()) escribir(PROVEEDORES_KEY, [b.proveedor.trim(), ...proveedores.filter((x) => x !== b.proveedor.trim())].slice(0, 30));
      toast.ok(`Mercancía recibida: ${b.lineas.length} productos sumados al inventario`);
      setB({ lineas: [], proveedor: '', factura: '' });
      foco();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const descartar = () => {
    if (confirm('¿Descartar esta recepción? Se borran todos los productos escaneados.')) {
      setB({ lineas: [], proveedor: '', factura: '' });
      foco();
    }
  };

  if (modo === 'central') {
    return (
      <div className="rounded-xl bg-amber-50 p-6 text-lg text-amber-900">
        La mercancía se recibe en la <b>tienda</b>: abra esta pantalla conectada al servidor de la tienda donde llegó el pedido, para que se sume a
        su inventario.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 pb-40">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Recibir mercancía</h1>
        {b.lineas.length > 0 && (
          <Boton variante="peligro" className="h-12 min-h-0" onClick={descartar}>
            Descartar
          </Boton>
        )}
      </div>

      {/* Paso 1: escanear */}
      <div className="rounded-2xl bg-white p-4 shadow">
        <div className="flex flex-wrap gap-2">
          <input
            ref={refCodigo}
            autoFocus
            className="h-16 min-w-0 flex-1 rounded-xl border-4 border-marca-500 px-4 text-2xl focus:outline-none"
            placeholder="Escanee el producto o escriba su nombre"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && procesar(codigo)}
          />
          <Boton variante="primario" className="h-16 w-28" disabled={!codigo || buscando} onClick={() => procesar(codigo)}>
            {buscando ? '…' : 'Agregar'}
          </Boton>
          <Boton className="h-16" onClick={() => setCamara(!camara)}>
            📷
          </Boton>
          {puedeCrear && (
            <Boton className="h-16" onClick={() => abrirNuevo('')}>
              ➕ Producto sin código
            </Boton>
          )}
        </div>
        {camara && (
          <Camara
            onCodigo={(c) => {
              setCamara(false);
              procesar(c);
            }}
          />
        )}
        <p className="mt-2 text-sm text-slate-500">
          Escanee cada producto de la factura. Si escanea el mismo dos veces, se suma 1. Si el código no existe, podrá crearlo aquí mismo.
        </p>

        {resultados && (
          <div className="mt-3 divide-y rounded-xl border">
            {resultados.map((r) => (
              <button
                key={r.id}
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-slate-100"
                onClick={() => {
                  agregar(r);
                  setResultados(null);
                  setCodigo('');
                  foco();
                }}
              >
                <span className="flex-1 text-lg">{r.nombre}</span>
                <span className="text-sm text-slate-500">hay {cant(r.stock)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Paso 2: revisar cantidades */}
      {b.lineas.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 p-10 text-center text-xl text-slate-400">Todavía no hay productos. Empiece escaneando.</div>
      ) : (
        <div className="divide-y rounded-2xl bg-white shadow">
          {b.lineas.map((l, i) => (
            <div key={l.productoId} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${!(Number(l.cantidad) > 0) ? 'bg-amber-50' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-lg font-medium">{l.nombre}</div>
                <div className="text-sm text-slate-500">
                  Había {cant(l.stock)} · quedarán <b>{cant(Number(l.stock) + Number(l.cantidad || 0))}</b>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {!l.pesable && (
                  <button type="button" className="btn-touch h-14 w-14 bg-slate-200 text-2xl" onClick={() => sumar(i, -1)}>
                    −
                  </button>
                )}
                <button type="button" className="btn-touch h-14 min-w-[6rem] border-2 border-slate-300 bg-white px-3 text-2xl font-bold" onClick={() => setEditar({ i, campo: 'cantidad', valor: l.cantidad })}>
                  {l.cantidad ? cant(l.cantidad) : '?'}
                  {l.pesable && <span className="ml-1 text-sm font-normal">kg</span>}
                </button>
                {!l.pesable && (
                  <button type="button" className="btn-touch h-14 w-14 bg-slate-200 text-2xl" onClick={() => sumar(i, 1)}>
                    +
                  </button>
                )}
              </div>
              <button type="button" className="btn-touch h-14 w-32 border-2 border-slate-200 bg-white text-right text-base" onClick={() => setEditar({ i, campo: 'costo', valor: l.costo })}>
                <span className="block text-xs text-slate-500">costo c/u</span>
                {l.costo ? dinero(l.costo) : '—'}
              </button>
              <div className="w-28 text-right font-semibold">{l.costo ? dinero(Number(l.cantidad || 0) * Number(l.costo)) : ''}</div>
              <button type="button" className="btn-touch h-14 w-12 text-2xl text-red-600" aria-label="Quitar" onClick={() => quitar(i)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Paso 3: guardar */}
      {b.lineas.length > 0 && (
        <div className="fixed bottom-0 left-64 right-0 z-30 border-t bg-white p-4 shadow-2xl">
          <div className="mx-auto flex max-w-5xl flex-wrap items-end gap-3">
            <Campo etiqueta="Proveedor (opcional)">
              <input className={`${inputCls} w-56`} list="proveedores" value={b.proveedor} onChange={(e) => setB({ ...b, proveedor: e.target.value })} />
              <datalist id="proveedores">
                {proveedores.map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </Campo>
            <Campo etiqueta="N.º factura (opcional)">
              <input className={`${inputCls} w-40`} value={b.factura} onChange={(e) => setB({ ...b, factura: e.target.value })} />
            </Campo>
            <div className="flex-1 text-right">
              <div className="text-sm text-slate-500">
                {b.lineas.length} productos{unidades ? ` · ${cant(unidades)} unidades` : ''}
              </div>
              {total > 0 && <div className="text-2xl font-bold">{dinero(total)}</div>}
            </div>
            <Boton variante="primario" className="h-16 w-64 text-xl" disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : '✔ Guardar recepción'}
            </Boton>
          </div>
        </div>
      )}

      {/* Teclado para cantidad / costo */}
      {editar && (
        <Modal titulo={`${editar.campo === 'cantidad' ? 'Cantidad' : 'Costo por unidad'} · ${b.lineas[editar.i]?.nombre ?? ''}`} onCerrar={() => setEditar(null)} ancho="max-w-sm">
          <div className="space-y-3">
            <input
              className={`${inputCls} w-full text-center text-3xl`}
              inputMode="decimal"
              autoFocus
              value={editar.valor}
              onChange={(e) => setEditar({ ...editar, valor: num(e.target.value) })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  cambiar(editar.i, { [editar.campo]: editar.valor });
                  setEditar(null);
                  foco();
                }
              }}
            />
            <NumPad
              valor={editar.valor}
              onChange={(v) => setEditar({ ...editar, valor: v })}
              decimales={editar.campo === 'costo' || !!b.lineas[editar.i]?.pesable || b.lineas[editar.i]?.unidad !== 'UND'}
              onEnter={() => {
                cambiar(editar.i, { [editar.campo]: editar.valor });
                setEditar(null);
                foco();
              }}
            />
          </div>
        </Modal>
      )}

      {/* Producto nuevo */}
      {nuevo && (
        <Modal titulo="Producto nuevo" onCerrar={() => (setNuevo(null), foco())} ancho="max-w-xl">
          <div className="space-y-3">
            {nuevo.codigo ? (
              <div className="rounded-lg bg-marca-50 p-3 text-marca-800">
                El código <b className="font-mono">{nuevo.codigo}</b> no está registrado. Complete estos datos y se crea al instante.
              </div>
            ) : (
              <Campo etiqueta="Código de barras (si tiene)">
                <input className={`${inputCls} w-full font-mono`} value={nuevo.codigo} onChange={(e) => setNuevo({ ...nuevo, codigo: e.target.value })} />
              </Campo>
            )}
            <Campo etiqueta="Nombre del producto">
              <input className={`${inputCls} w-full`} autoFocus value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} />
            </Campo>
            <div className="grid grid-cols-3 gap-3">
              <Campo etiqueta={`Precio de venta${nuevo.pesable ? ' (kg)' : ''}`}>
                <input className={`${inputCls} w-full text-xl font-bold`} inputMode="decimal" value={nuevo.precio} onChange={(e) => setNuevo({ ...nuevo, precio: num(e.target.value) })} />
              </Campo>
              <Campo etiqueta="Costo (opcional)">
                <input className={`${inputCls} w-full`} inputMode="decimal" value={nuevo.costo} onChange={(e) => setNuevo({ ...nuevo, costo: num(e.target.value) })} />
              </Campo>
              <Campo etiqueta={`Llegaron${nuevo.pesable ? ' (kg)' : ''}`}>
                <input className={`${inputCls} w-full text-xl font-bold`} inputMode="decimal" value={nuevo.cantidad} onChange={(e) => setNuevo({ ...nuevo, cantidad: num(e.target.value) })} />
              </Campo>
            </div>
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" className="h-7 w-7" checked={nuevo.pesable} onChange={(e) => setNuevo({ ...nuevo, pesable: e.target.checked })} />
              Se vende por peso (kg)
            </label>
            {!nuevo.masDatos ? (
              <button type="button" className="text-marca-700 underline" onClick={() => setNuevo({ ...nuevo, masDatos: true })}>
                Más datos (categoría, impuesto)
              </button>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Categoría">
                  <select className={`${inputCls} w-full`} value={nuevo.categoriaId} onChange={(e) => setNuevo({ ...nuevo, categoriaId: e.target.value })}>
                    <option value="">(Sin categoría)</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
                <Campo etiqueta="Impuesto">
                  <select className={`${inputCls} w-full`} value={nuevo.impuestoCodigo} onChange={(e) => setNuevo({ ...nuevo, impuestoCodigo: e.target.value })}>
                    {impuestos.map((i) => (
                      <option key={i.codigo} value={i.codigo}>
                        {i.nombre}
                      </option>
                    ))}
                  </select>
                </Campo>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 pt-2">
              <Boton className="h-14" onClick={() => (setNuevo(null), foco())}>
                Cancelar
              </Boton>
              <Boton variante="primario" className="h-14 text-lg" disabled={guardando} onClick={crearProducto}>
                {guardando ? 'Creando…' : 'Crear y agregar'}
              </Boton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
