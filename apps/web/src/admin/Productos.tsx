import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PERMISOS } from '@pos/shared';
import { del, descargar, get, leerComoDataUrl, post, put, urlMedia } from '../lib/api';
import { dinero } from '../lib/config';
import { parametros, useParametros } from '../store/parametros';
import { usePermiso } from '../store/sesion';
import { Boton, Campo, inputCls, Modal, toast } from '../components/ui';
import ImportarProductos from './ImportarProductos';

interface Producto {
  id: string;
  sku: string;
  nombre: string;
  categoriaId: string | null;
  unidad: string;
  pesable: boolean;
  plu: string | null;
  precio: string;
  costo: string;
  tasaImpuesto: string;
  impuestoCodigo: string | null;
  stockMinimo: string;
  color: string | null;
  imagen: string | null;
  favorito: boolean;
  activo: boolean;
  codigos: { codigo: string }[];
  precios: { sucursalId: string; precio: string }[];
  categoria?: { nombre: string } | null;
}

const vacio = {
  sku: '',
  nombre: '',
  categoriaId: null as string | null,
  unidad: 'UND',
  pesable: false,
  plu: '',
  precio: '0',
  costo: '0',
  tasaImpuesto: '0',
  impuestoCodigo: null as string | null,
  stockMinimo: '0',
  color: '',
  imagen: null as string | null,
  favorito: false,
  activo: true,
  codigos: '',
  preciosSucursal: [] as { sucursalId: string; precio: string }[],
};

export default function Productos() {
  const gestionar = usePermiso(PERMISOS.PRODUCTO_GESTIONAR);
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const [datos, setDatos] = useState<{ items: Producto[]; total: number }>({ items: [], total: 0 });
  const [categorias, setCategorias] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [editando, setEditando] = useState<{ id: string | null; f: typeof vacio } | null>(null);
  const [nuevaCat, setNuevaCat] = useState('');
  const [importando, setImportando] = useState(false);
  const nav = useNavigate();
  const impuestos = useParametros((s) => s.p.regional.impuestos);

  const cargar = () =>
    get(`/catalogo/productos?buscar=${encodeURIComponent(buscar)}&pagina=${pagina}&porPagina=50&incluirInactivos=true`)
      .then(setDatos)
      .catch((e) => toast.error(e.message));

  useEffect(() => {
    cargar();
  }, [pagina]);
  useEffect(() => {
    get('/catalogo/categorias').then(setCategorias);
    get('/sucursales').then(setSucursales);
  }, []);

  const abrir = (p?: Producto) =>
    setEditando({
      id: p?.id ?? null,
      f: p
        ? {
            ...vacio,
            ...p,
            plu: p.plu ?? '',
            color: p.color ?? '',
            codigos: p.codigos.map((c) => c.codigo).join('\n'),
            preciosSucursal: p.precios.map((x) => ({ sucursalId: x.sucursalId, precio: String(x.precio) })),
            impuestoCodigo: p.impuestoCodigo ?? impuestos.find((i) => i.tasa === Number(p.tasaImpuesto))?.codigo ?? null,
          }
        : (() => {
            const r = parametros().regional;
            const def = r.impuestos.find((i) => i.codigo === r.impuestoPorDefecto) ?? r.impuestos[0];
            return { ...vacio, impuestoCodigo: def.codigo, tasaImpuesto: String(def.tasa) };
          })(),
    });

  const guardar = async () => {
    if (!editando) return;
    const f = editando.f;
    const body = {
      ...f,
      plu: f.plu || null,
      color: f.color || null,
      codigos: f.codigos.split(/[\n,]/).map((c) => c.trim()).filter(Boolean),
      unidad: f.pesable ? (f.unidad === 'LB' ? 'LB' : 'KG') : f.unidad === 'LB' ? 'UND' : f.unidad,
    };
    try {
      const r = editando.id ? await put(`/catalogo/productos/${editando.id}`, body) : await post('/catalogo/productos', body);
      toast.ok(!editando.id && !f.sku.trim() ? `Producto guardado con el código ${r.sku}` : 'Producto guardado');
      setEditando(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  /** La imagen se sube como archivo (se reduce a 256 px en el servidor) y el producto guarda solo su id */
  const imagen = async (file: File) => {
    if (file.size > 8_000_000) return toast.error('Imagen muy grande (máx. 8 MB)');
    try {
      const r = await post<{ id: string }>('/media', { dataUrl: await leerComoDataUrl(file), tipo: 'producto' });
      setEditando((e) => e && { ...e, f: { ...e.f, imagen: r.id } });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const f = editando?.f;
  const set = (k: keyof typeof vacio, v: any) => editando && setEditando({ ...editando, f: { ...editando.f, [k]: v } });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold">Productos ({datos.total})</h1>
        <input className={`${inputCls} w-80`} placeholder="Buscar nombre, SKU o código" value={buscar} onChange={(e) => setBuscar(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setPagina(1), cargar())} />
        <Boton onClick={() => { setPagina(1); cargar(); }}>Buscar</Boton>
        {gestionar && (
          <>
            <Boton onClick={() => nav('/admin/alta-rapida')}>📷 Escanear productos</Boton>
            <Boton onClick={() => setImportando(true)}>📄 Importar Excel/CSV</Boton>
            <Boton variante="primario" onClick={() => abrir()}>
              + Nuevo
            </Boton>
          </>
        )}
        {!gestionar && (
          <Boton onClick={() => descargar('/catalogo/exportar', 'productos.xlsx').catch((e) => toast.error(e.message))}>⬇ Exportar Excel</Boton>
        )}
      </div>
      {importando && (
        <ImportarProductos
          onCerrar={() => setImportando(false)}
          onTerminado={() => {
            get('/catalogo/categorias').then(setCategorias);
            cargar();
          }}
        />
      )}

      {gestionar && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white p-3">
          <span className="font-semibold">Categorías:</span>
          {categorias.map((c) => (
            <span key={c.id} className="rounded-full px-3 py-1 text-white" style={{ background: c.color ?? '#64748b' }}>
              {c.nombre}
            </span>
          ))}
          <input className={`${inputCls} h-10 w-48`} placeholder="Nueva categoría" value={nuevaCat} onChange={(e) => setNuevaCat(e.target.value)} />
          <Boton
            className="h-10 min-h-0"
            onClick={async () => {
              if (!nuevaCat.trim()) return;
              try {
                await post('/catalogo/categorias', { nombre: nuevaCat.trim(), color: '#475569', orden: categorias.length + 1 });
                setNuevaCat('');
                setCategorias(await get('/catalogo/categorias'));
              } catch (e: any) {
                toast.error(e.message);
              }
            }}
          >
            Agregar
          </Boton>
        </div>
      )}

      <table className="w-full overflow-hidden rounded-xl bg-white text-left shadow">
        <thead className="bg-slate-100 text-sm text-slate-600">
          <tr>
            <th className="p-3">SKU</th>
            <th>Nombre</th>
            <th>Categoría</th>
            <th>Códigos</th>
            <th className="text-right">Precio</th>
            <th className="text-right">Costo</th>
            <th className="text-center">Estado</th>
          </tr>
        </thead>
        <tbody>
          {datos.items.map((p) => (
            <tr key={p.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => abrir(p)}>
              <td className="p-3 font-mono">{p.sku}</td>
              <td>
                {p.nombre} {p.pesable && <span className="rounded bg-amber-100 px-1 text-xs">PESO · PLU {p.plu}</span>}
              </td>
              <td>{p.categoria?.nombre}</td>
              <td className="font-mono text-sm">{p.codigos.map((c) => c.codigo).join(', ')}</td>
              <td className="text-right">{dinero(p.precio)}</td>
              <td className="text-right text-slate-500">{dinero(p.costo)}</td>
              <td className="text-center">{p.activo ? '✔' : <span className="text-red-600">Inactivo</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex justify-center gap-2">
        <Boton disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
          ◀
        </Boton>
        <span className="self-center">Página {pagina}</span>
        <Boton disabled={pagina * 50 >= datos.total} onClick={() => setPagina(pagina + 1)}>
          ▶
        </Boton>
      </div>

      {editando && f && (
        <Modal titulo={editando.id ? 'Editar producto' : 'Nuevo producto'} onCerrar={() => setEditando(null)} ancho="max-w-4xl">
          <fieldset disabled={!gestionar} className="grid grid-cols-3 gap-4">
            <Campo etiqueta={editando.id ? 'Código interno' : 'Código interno (opcional)'}>
              <input
                className={inputCls}
                placeholder="Automático"
                value={f.sku}
                onChange={(e) => set('sku', e.target.value)}
              />
            </Campo>
            <div className="col-span-2">
              <Campo etiqueta="Nombre">
                <input className={inputCls} value={f.nombre} onChange={(e) => set('nombre', e.target.value)} />
              </Campo>
            </div>
            <Campo etiqueta="Categoría">
              <select className={inputCls} value={f.categoriaId ?? ''} onChange={(e) => set('categoriaId', e.target.value || null)}>
                <option value="">(Sin categoría)</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Precio de venta (con impuesto)">
              <input className={inputCls} type="number" step={parametros().regional.decimales === 0 ? '1' : '0.01'} value={f.precio} onChange={(e) => set('precio', e.target.value)} />
            </Campo>
            <Campo etiqueta="Costo">
              <input className={inputCls} type="number" step="0.0001" value={f.costo} onChange={(e) => set('costo', e.target.value)} />
            </Campo>
            <Campo etiqueta="Impuesto">
              <select
                className={inputCls}
                value={f.impuestoCodigo ?? ''}
                onChange={(e) => {
                  const imp = impuestos.find((i) => i.codigo === e.target.value);
                  if (imp) setEditando((ed) => ed && { ...ed, f: { ...ed.f, impuestoCodigo: imp.codigo, tasaImpuesto: String(imp.tasa) } });
                }}
              >
                {!f.impuestoCodigo && <option value="">{Number(f.tasaImpuesto)}% (sin configurar)</option>}
                {impuestos.map((i) => (
                  <option key={i.codigo} value={i.codigo}>
                    {i.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Stock mínimo">
              <input className={inputCls} type="number" value={f.stockMinimo} onChange={(e) => set('stockMinimo', e.target.value)} />
            </Campo>
            <Campo etiqueta={f.pesable ? 'Precio por (KG o LB)' : 'Unidad'}>
              <select className={inputCls} value={f.pesable ? (f.unidad === 'LB' ? 'LB' : 'KG') : f.unidad} onChange={(e) => set('unidad', e.target.value)}>
                {(f.pesable ? ['KG', 'LB'] : ['UND', 'KG', 'LT', 'PAQ', 'CJA']).map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </Campo>
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" className="h-7 w-7" checked={f.pesable} onChange={(e) => set('pesable', e.target.checked)} />
              Se vende por peso (balanza)
            </label>
            {f.pesable && (
              <Campo etiqueta="PLU de balanza etiquetadora">
                <input className={inputCls} value={f.plu} onChange={(e) => set('plu', e.target.value)} placeholder="ej. 00001" />
              </Campo>
            )}
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" className="h-7 w-7" checked={f.favorito} onChange={(e) => set('favorito', e.target.checked)} />
              Mostrar en Favoritos de la caja
            </label>
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" className="h-7 w-7" checked={f.activo} onChange={(e) => set('activo', e.target.checked)} />
              Activo
            </label>
            <Campo etiqueta="Color del botón">
              <input type="color" className="h-12 w-24" value={f.color || '#94a3b8'} onChange={(e) => set('color', e.target.value)} />
            </Campo>
            <div className="col-span-2">
              <Campo etiqueta="Códigos de barras (uno por línea)">
                <textarea className="h-28 rounded-lg border-2 border-slate-300 p-2 font-mono" value={f.codigos} onChange={(e) => set('codigos', e.target.value)} />
              </Campo>
            </div>
            <div>
              <Campo etiqueta="Imagen (opcional)">
                <input type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && imagen(e.target.files[0])} />
              </Campo>
              {f.imagen && (
                <div className="mt-2 flex items-center gap-2">
                  <img src={urlMedia(f.imagen)!} className="h-20 rounded" />
                  <Boton variante="peligro" className="h-10 min-h-0" onClick={() => set('imagen', null)}>
                    Quitar
                  </Boton>
                </div>
              )}
            </div>
            <div className="col-span-3">
              <div className="mb-1 text-sm font-semibold text-slate-600">Precio por sucursal (opcional, reemplaza el precio general)</div>
              <div className="grid grid-cols-3 gap-2">
                {sucursales.map((s) => {
                  const ps = f.preciosSucursal.find((x) => x.sucursalId === s.id);
                  return (
                    <Campo key={s.id} etiqueta={s.nombre}>
                      <input
                        className={inputCls}
                        type="number"
                        step="0.01"
                        placeholder="(precio general)"
                        value={ps?.precio ?? ''}
                        onChange={(e) => {
                          const otros = f.preciosSucursal.filter((x) => x.sucursalId !== s.id);
                          set('preciosSucursal', e.target.value ? [...otros, { sucursalId: s.id, precio: e.target.value }] : otros);
                        }}
                      />
                    </Campo>
                  );
                })}
              </div>
            </div>
          </fieldset>
          {gestionar && (
            <div className="mt-5 flex justify-between">
              {editando.id ? (
                <Boton
                  variante="peligro"
                  onClick={async () => {
                    if (!confirm('¿Eliminar el producto?')) return;
                    await del(`/catalogo/productos/${editando.id}`).catch((e) => toast.error(e.message));
                    setEditando(null);
                    cargar();
                  }}
                >
                  Eliminar
                </Boton>
              ) : (
                <span />
              )}
              <Boton variante="primario" className="w-48" onClick={guardar}>
                Guardar
              </Boton>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
