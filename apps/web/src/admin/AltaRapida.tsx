import { useEffect, useRef, useState } from 'react';
import { PERMISOS } from '@pos/shared';
import { ApiError, del, get, post, put } from '../lib/api';
import { dinero } from '../lib/config';
import { useParametros } from '../store/parametros';
import { usePermiso } from '../store/sesion';
import { Boton, Campo, inputCls, toast } from '../components/ui';
import { useModoServidor } from './AdminLayout';

interface Cargado {
  id: string;
  codigo: string;
  nombre: string;
  precio: string;
  accion: 'creado' | 'actualizado';
}

/** Pitido corto: agudo = OK, grave = error (sin archivos de sonido) */
export function pitido(ok: boolean) {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 1200 : 300;
    g.gain.value = 0.15;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.3));
    o.onended = () => ctx.close();
  } catch {
    /* sin audio */
  }
}

const ULTIMO_KEY = 'pos.altaRapida.ultimo';

/**
 * Carga de productos escaneando en la tienda: lector USB/Bluetooth (modo teclado) o cámara del celular.
 * Enter = guardar y quedar listo para el siguiente código.
 */
export default function AltaRapida() {
  const modo = useModoServidor();
  const puede = usePermiso(PERMISOS.PRODUCTO_GESTIONAR) && modo === 'central';
  const p = useParametros((s) => s.p);
  const impuestos = p.regional.impuestos;

  const [codigo, setCodigo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [existente, setExistente] = useState<any | null>(null);
  const [nuevo, setNuevo] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<any[]>([]);
  const ultimo = (() => {
    try {
      return JSON.parse(localStorage.getItem(ULTIMO_KEY) ?? '{}');
    } catch {
      return {};
    }
  })();
  const [form, setForm] = useState({
    nombre: '',
    precio: '',
    categoriaId: (ultimo.categoriaId as string) ?? '',
    impuestoCodigo: (ultimo.impuestoCodigo as string) ?? p.regional.impuestoPorDefecto,
    pesable: false,
    favorito: false,
  });
  const [guardando, setGuardando] = useState(false);
  const [sesion, setSesion] = useState<Cargado[]>([]);
  const [camara, setCamara] = useState(false);

  const refCodigo = useRef<HTMLInputElement>(null);
  const refNombre = useRef<HTMLInputElement>(null);
  const refPrecio = useRef<HTMLInputElement>(null);

  useEffect(() => {
    get('/catalogo/categorias').then(setCategorias);
    refCodigo.current?.focus();
  }, []);

  const listo = () => {
    setExistente(null);
    setNuevo(null);
    setCodigo('');
    setTimeout(() => refCodigo.current?.focus(), 50);
  };

  // Escáner por puerto serie / USB-COM (Datalogic Magellan): el código llega por el puente de Electron
  const refProcesar = useRef<(cod: string) => void>(() => undefined);
  useEffect(
    () =>
      window.pos?.scanner?.onCode((c) => {
        setCodigo(c);
        refProcesar.current(c);
      }),
    [],
  );

  const procesar = async (cod: string) => {
    cod = cod.trim();
    if (!cod || buscando) return;
    setBuscando(true);
    setExistente(null);
    setNuevo(null);
    try {
      const r = await get<{ producto: { id: string } }>(`/catalogo/codigo/${encodeURIComponent(cod)}`);
      const prod = await get(`/catalogo/productos/${r.producto.id}`);
      setExistente(prod);
      setForm((f) => ({ ...f, nombre: prod.nombre, precio: String(Number(prod.precio)), categoriaId: prod.categoriaId ?? '', impuestoCodigo: prod.impuestoCodigo ?? f.impuestoCodigo, pesable: prod.pesable, favorito: prod.favorito }));
      pitido(true);
      setTimeout(() => refPrecio.current?.select(), 50);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        if (/^2\d{12}$/.test(cod)) toast.info('Parece una etiqueta de balanza: los productos pesados se registran con su PLU, no con este código.');
        setNuevo(cod);
        setForm((f) => ({ ...f, nombre: '', precio: '', pesable: false, favorito: false }));
        pitido(true);
        setTimeout(() => refNombre.current?.focus(), 50);
      } else {
        pitido(false);
        toast.error((e as Error).message);
      }
    } finally {
      setBuscando(false);
    }
  };
  refProcesar.current = procesar;

  const guardar = async () => {
    if (guardando) return;
    const precio = form.precio.replace(',', '.');
    if (!form.nombre.trim()) return toast.error('Escriba el nombre');
    if (!precio || isNaN(Number(precio)) || Number(precio) < 0) return toast.error('Precio inválido');
    const imp = impuestos.find((i) => i.codigo === form.impuestoCodigo) ?? impuestos[0];
    setGuardando(true);
    try {
      localStorage.setItem(ULTIMO_KEY, JSON.stringify({ categoriaId: form.categoriaId, impuestoCodigo: form.impuestoCodigo }));
      if (existente) {
        const r = await put(`/catalogo/productos/${existente.id}`, {
          ...existente,
          nombre: form.nombre.trim(),
          precio,
          categoriaId: form.categoriaId || null,
          impuestoCodigo: imp.codigo,
          tasaImpuesto: String(imp.tasa),
          favorito: form.favorito,
          codigos: existente.codigos.map((c: any) => c.codigo),
          preciosSucursal: existente.precios.map((x: any) => ({ sucursalId: x.sucursalId, precio: String(x.precio) })),
        });
        setSesion((s) => [{ id: r.id, codigo: existente.codigos[0]?.codigo ?? existente.sku, nombre: r.nombre, precio, accion: 'actualizado' as const }, ...s.filter((x) => x.id !== r.id)]);
      } else if (nuevo) {
        const r = await post('/catalogo/productos', {
          sku: nuevo,
          nombre: form.nombre.trim(),
          categoriaId: form.categoriaId || null,
          unidad: form.pesable ? 'KG' : 'UND',
          pesable: form.pesable,
          precio,
          tasaImpuesto: String(imp.tasa),
          impuestoCodigo: imp.codigo,
          favorito: form.favorito,
          codigos: [nuevo],
        });
        setSesion((s) => [{ id: r.id, codigo: nuevo, nombre: r.nombre, precio, accion: 'creado' as const }, ...s]);
      }
      pitido(true);
      toast.ok('Guardado');
      listo();
    } catch (e: any) {
      pitido(false);
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };

  const deshacer = async (c: Cargado) => {
    if (c.accion !== 'creado' || !confirm(`¿Eliminar "${c.nombre}"?`)) return;
    try {
      await del(`/catalogo/productos/${c.id}`);
      setSesion((s) => s.filter((x) => x.id !== c.id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const enter = (e: React.KeyboardEvent, fn: () => void) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fn();
    }
    if (e.key === 'Escape') listo();
  };

  if (modo === 'store') {
    return (
      <div className="rounded-xl bg-amber-50 p-6 text-lg text-amber-900">
        En la tienda, los productos nuevos se crean desde <b>Recibir mercancía</b>: escanee el código y, si no existe, el sistema le pide nombre y
        precio ahí mismo. Para editar precios o datos de productos existentes, abra esta pantalla conectada al servidor central.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Cargar productos escaneando</h1>
        <div className="rounded-full bg-marca-100 px-4 py-2 text-lg font-semibold text-marca-800">{sesion.length} en esta sesión</div>
      </div>
      {!puede && <div className="rounded-xl bg-amber-50 p-3 text-amber-800">Necesita el permiso «Crear/editar productos».</div>}

      <div className="rounded-2xl bg-white p-4 shadow">
        <div className="flex flex-wrap gap-2">
          <input
            ref={refCodigo}
            className="h-16 min-w-0 flex-1 rounded-xl border-4 border-marca-500 px-4 font-mono text-3xl focus:outline-none"
            placeholder="Escanee o escriba el código"
            inputMode="numeric"
            value={codigo}
            disabled={!puede}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => enter(e, () => procesar(codigo))}
          />
          <Boton variante="primario" className="h-16 w-32" disabled={!puede || !codigo || buscando} onClick={() => procesar(codigo)}>
            {buscando ? '…' : 'Buscar'}
          </Boton>
          <Boton className="h-16" disabled={!puede} onClick={() => setCamara(!camara)}>
            📷 Cámara
          </Boton>
        </div>
        {camara && (
          <Camara
            onCodigo={(c) => {
              setCamara(false);
              setCodigo(c);
              procesar(c);
            }}
          />
        )}
        <div className="mt-2 text-sm text-slate-500">
          Con lector USB o Bluetooth: escanee y el producto aparece solo. Enter guarda; Esc cancela.
        </div>
      </div>

      {(existente || nuevo) && (
        <div className={`rounded-2xl p-4 shadow ${existente ? 'bg-sky-50' : 'bg-marca-50'}`}>
          <div className="mb-3 text-xl font-bold">
            {existente ? `Ya existe · ${existente.sku}` : `Producto nuevo · código ${nuevo}`}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Campo etiqueta="Nombre">
              <input ref={refNombre} className={inputCls} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} onKeyDown={(e) => enter(e, () => refPrecio.current?.focus())} />
            </Campo>
            <Campo etiqueta={`Precio de venta con ${p.regional.nombreImpuesto}${form.pesable ? ' (por kg)' : ''}`}>
              <input
                ref={refPrecio}
                className={`${inputCls} text-2xl font-bold`}
                inputMode="decimal"
                value={form.precio}
                onChange={(e) => setForm({ ...form, precio: e.target.value })}
                onKeyDown={(e) => enter(e, guardar)}
              />
            </Campo>
            <Campo etiqueta="Categoría">
              <select className={inputCls} value={form.categoriaId} onChange={(e) => setForm({ ...form, categoriaId: e.target.value })}>
                <option value="">(Sin categoría)</option>
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo etiqueta="Impuesto">
              <select className={inputCls} value={form.impuestoCodigo} onChange={(e) => setForm({ ...form, impuestoCodigo: e.target.value })}>
                {impuestos.map((i) => (
                  <option key={i.codigo} value={i.codigo}>
                    {i.nombre}
                  </option>
                ))}
              </select>
            </Campo>
            {nuevo && (
              <label className="flex items-center gap-3 text-lg">
                <input type="checkbox" className="h-7 w-7" checked={form.pesable} onChange={(e) => setForm({ ...form, pesable: e.target.checked })} />
                Se vende por peso
              </label>
            )}
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" className="h-7 w-7" checked={form.favorito} onChange={(e) => setForm({ ...form, favorito: e.target.checked })} />
              Favorito en la caja
            </label>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Boton onClick={listo}>Cancelar (Esc)</Boton>
            <Boton variante="primario" className="w-56" disabled={guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : 'Guardar y siguiente (Enter)'}
            </Boton>
          </div>
        </div>
      )}

      {sesion.length > 0 && (
        <div className="rounded-2xl bg-white shadow">
          {sesion.map((c) => (
            <div key={c.id} className="flex items-center gap-3 border-b px-4 py-2">
              <span>{c.accion === 'creado' ? '🆕' : '✏️'}</span>
              <span className="w-40 truncate font-mono text-sm">{c.codigo}</span>
              <span className="flex-1 truncate text-lg">{c.nombre}</span>
              <span className="font-semibold">{dinero(c.precio)}</span>
              <Boton className="h-11 min-h-0" onClick={() => procesar(c.codigo)}>
                Editar
              </Boton>
              {c.accion === 'creado' && (
                <Boton variante="peligro" className="h-11 min-h-0" onClick={() => deshacer(c)}>
                  Deshacer
                </Boton>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lector con la cámara (Chrome/Edge en Android y Windows). Requiere HTTPS o localhost. */
export function Camara({ onCodigo }: { onCodigo: (c: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const BD = (window as any).BarcodeDetector;
    if (!window.isSecureContext) {
      setError('La cámara solo funciona con HTTPS. Configure el certificado (scripts\\crear-certificado.ps1) o use un lector Bluetooth.');
      return;
    }
    if (!BD) {
      setError('Este navegador no puede leer códigos con la cámara. Use Chrome o Edge actualizados, o un lector Bluetooth.');
      return;
    }
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval>;
    let activo = true;
    const detector = new BD({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'] });
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        if (!video.current || !activo) return;
        video.current.srcObject = s;
        video.current.play();
        timer = setInterval(async () => {
          if (!video.current || video.current.readyState < 2) return;
          try {
            const r = await detector.detect(video.current);
            if (r[0]?.rawValue && activo) {
              activo = false;
              onCodigo(r[0].rawValue);
            }
          } catch {
            /* seguir intentando */
          }
        }, 250);
      })
      .catch(() => setError('No se pudo abrir la cámara (permiso denegado o sin cámara).'));
    return () => {
      activo = false;
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  if (error) return <div className="mt-3 rounded-lg bg-amber-50 p-3 text-amber-800">{error}</div>;
  return <video ref={video} className="mt-3 max-h-72 w-full rounded-xl bg-black object-cover" muted playsInline />;
}
