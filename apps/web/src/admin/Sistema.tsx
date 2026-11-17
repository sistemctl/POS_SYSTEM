import { useEffect, useMemo, useState } from 'react';
import {
  aplicarPreset,
  formatearDinero,
  normalizarParametros,
  PERMISOS,
  PRESETS_PAIS,
  type MetodoPago,
  type Parametros,
  type TicketData,
} from '@pos/shared';
import { get, leerComoDataUrl, post, put, urlMedia } from '../lib/api';
import { ticketCuerpoHtml } from '../lib/hardware';
import { useParametros } from '../store/parametros';
import { usePermiso, useSesion } from '../store/sesion';
import { guardarConfig, leerConfig } from '../lib/config';
import { Boton, Campo, inputCls, Modal, toast } from '../components/ui';
import { useModoServidor } from './AdminLayout';

const PESTANAS = ['Regional e impuestos', 'Marca', 'Ticket', 'Caja', 'Pantalla de caja'] as const;
type Pestana = (typeof PESTANAS)[number];

const FORMAS_PAGO: { id: MetodoPago; nombre: string }[] = [
  { id: 'EFECTIVO', nombre: 'Efectivo' },
  { id: 'TARJETA', nombre: 'Tarjeta' },
  { id: 'BILLETERA', nombre: 'Billetera digital (Nequi, Yape, Daviplata…)' },
  { id: 'TRANSFERENCIA', nombre: 'Transferencia' },
  { id: 'OTRO', nombre: 'Otro' },
];

/** Ticket de ejemplo para la vista previa */
function ticketEjemplo(p: Parametros): TicketData {
  const r = p.regional;
  const cop = r.decimales === 0;
  const v = (n: number) => n.toFixed(r.decimales);
  const imp = r.impuestos.find((i) => i.codigo === r.impuestoPorDefecto) ?? r.impuestos[0];
  const total = cop ? 12900 : 12.9;
  const base = total / (1 + imp.tasa / 100);
  return {
    empresa: p.marca.nombreComercial,
    sucursal: 'Sucursal Principal',
    direccion: 'Calle 10 # 20-30',
    telefono: '601 555 1234',
    ruc: p.ticket.mostrarDatosFiscales ? (cop ? '900123456-7' : '20123456789') : null,
    etiquetaFiscal: r.etiquetaFiscal,
    nombreImpuesto: r.nombreImpuesto,
    encabezado: p.ticket.encabezado.filter((l) => l.trim()),
    logo: p.ticket.mostrarLogo && p.marca.logoId ? { anchoBytes: 0, alto: 0, bits: '', url: `/api/media/${p.marca.logoId}` } : null,
    qr: p.ticket.qr || null,
    mostrarAhorro: p.ticket.mostrarAhorro,
    formato: r,
    impuestos: [{ nombre: imp.nombre, base: v(base), impuesto: v(total - base) }],
    caja: 'Caja 1',
    cajero: 'Carlos',
    numero: 'S01C01-000123',
    fecha: new Date().toISOString(),
    items: [
      { nombre: 'Arroz 500 g', cantidad: '2', unidad: 'UND', precioUnitario: v(cop ? 2400 : 2.4), total: v(cop ? 4800 : 4.8), descuento: v(0) },
      { nombre: 'Tomate', cantidad: '1.250', unidad: 'KG', precioUnitario: v(cop ? 4800 : 4.8), total: v(cop ? 6000 : 6), descuento: v(0) },
      { nombre: 'Agua 625 ml (2x1)', cantidad: '2', unidad: 'UND', precioUnitario: v(cop ? 2100 : 2.1), total: v(cop ? 2100 : 2.1), descuento: v(cop ? 2100 : 2.1) },
    ],
    subtotal: v(base),
    impuesto: v(total - base),
    descuento: v(cop ? 2100 : 2.1),
    total: v(total),
    pagos: [{ metodo: 'Efectivo', monto: v(cop ? 20000 : 20) }],
    vuelto: v(cop ? 7100 : 7.1),
    pie: p.ticket.pie,
  };
}

export function VistaPreviaTicket({ p }: { p: Parametros }) {
  const html = useMemo(() => ticketCuerpoHtml(ticketEjemplo(p), p.ticket.ancho), [p]);
  return (
    <div className="flex justify-center rounded-xl bg-slate-300 p-4">
      <div className="shadow-lg" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

async function subirLogo(f: File): Promise<string> {
  if (f.size > 8_000_000) throw new Error('Imagen muy grande (máx. 8 MB)');
  const r = await post<{ id: string }>('/media', { dataUrl: await leerComoDataUrl(f), tipo: 'logo' });
  return r.id;
}

/** Cambia la conexión de este equipo al servidor central (pide iniciar sesión de nuevo). */
function IrAlCentral() {
  const actual = leerConfig().servidor;
  const sugerido = actual.replace(/:3001$/, ':3000');
  const [abierto, setAbierto] = useState(false);
  const [url, setUrl] = useState(sugerido !== actual ? sugerido : '');
  const [probando, setProbando] = useState(false);
  const cerrarSesion = useSesion((s) => s.cerrarSesion);

  const conectar = async () => {
    const destino = url.trim().replace(/\/$/, '');
    if (!destino) return;
    setProbando(true);
    try {
      const h = await fetch(`${destino}/api/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
      if (h.modo !== 'central') throw new Error('Esa dirección no es el servidor central');
      guardarConfig({ servidor: destino, cajaId: null, cajaNombre: null, sucursalId: null });
      cerrarSesion('Conectado al servidor central. Inicie sesión para modificar la configuración.');
      window.location.href = '/admin-login';
    } catch (e: any) {
      toast.error(e.message?.includes('central') ? e.message : 'No se pudo conectar con el servidor central');
    } finally {
      setProbando(false);
    }
  };

  return (
    <>
      <Boton variante="primario" onClick={() => setAbierto(true)}>
        Conectarse al servidor central
      </Boton>
      {abierto && (
        <Modal titulo="Conectarse al servidor central" onCerrar={() => setAbierto(false)}>
          <div className="space-y-3">
            <Campo etiqueta="Dirección del servidor central">
              <input className={inputCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://192.168.1.5:3000" />
            </Campo>
            <p className="text-sm text-slate-600">Este equipo quedará como equipo de administración (sin caja asignada).</p>
            <div className="flex justify-end gap-2">
              <Boton onClick={() => setAbierto(false)}>Cancelar</Boton>
              <Boton variante="primario" disabled={probando || !url.trim()} onClick={conectar}>
                {probando ? 'Conectando…' : 'Conectar'}
              </Boton>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function Sistema() {
  const modo = useModoServidor();
  const puedeEditar = usePermiso(PERMISOS.CONFIG_GESTIONAR) && modo === 'central';
  const aplicarGlobal = useParametros((s) => s.aplicar);
  const [p, setP] = useState<Parametros | null>(null);
  const [original, setOriginal] = useState('');
  const [pestana, setPestana] = useState<Pestana>('Regional e impuestos');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    get('/parametros').then((r) => {
      const n = normalizarParametros(r);
      setP(n);
      setOriginal(JSON.stringify(n));
    });
  }, []);

  if (!p) return <div className="p-6">Cargando…</div>;
  const cambios = JSON.stringify(p) !== original;
  const set = <K extends keyof Parametros>(k: K, v: Partial<Parametros[K]>) => setP({ ...p, [k]: { ...p[k], ...v } });

  const guardar = async () => {
    setGuardando(true);
    try {
      const r = await put<Parametros & { productosAjustados?: number }>('/parametros', p);
      const n = normalizarParametros(r);
      setP(n);
      setOriginal(JSON.stringify(n));
      aplicarGlobal(n, true);
      const ajustados = r.productosAjustados ?? 0;
      toast.ok(
        'Configuración guardada.' +
          (ajustados > 0 ? ` Se actualizó el impuesto de ${ajustados} producto(s).` : '') +
          ' Las tiendas la recibirán en la próxima sincronización.',
      );
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">Configuración del sistema</h1>
        {puedeEditar && (
          <>
            <Boton disabled={!cambios || guardando} onClick={() => setP(JSON.parse(original))}>
              Descartar
            </Boton>
            <Boton variante="primario" className="w-48" disabled={!cambios || guardando} onClick={guardar}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </Boton>
          </>
        )}
      </div>
      {!puedeEditar && (
        <div className="rounded-xl bg-amber-50 p-3 text-amber-800">
          {modo === 'store' ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1">
                Solo lectura: este equipo está conectado al <b>servidor de la tienda</b>. La configuración se cambia en el{' '}
                <b>servidor central</b> y llega a las tiendas por sincronización.
              </span>
              <IrAlCentral />
            </div>
          ) : (
            'Solo lectura: necesita el permiso «Configuración del sistema».'
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {PESTANAS.map((t) => (
          <Boton key={t} variante={pestana === t ? 'primario' : 'secundario'} onClick={() => setPestana(t)}>
            {t}
          </Boton>
        ))}
      </div>

      <fieldset disabled={!puedeEditar} className="rounded-xl bg-white p-5 shadow">
        {pestana === 'Regional e impuestos' && <Regional p={p} setP={setP} set={set} />}
        {pestana === 'Marca' && <Marca p={p} set={set} />}
        {pestana === 'Ticket' && <Ticket p={p} set={set} />}
        {pestana === 'Caja' && <Caja p={p} set={set} />}
        {pestana === 'Pantalla de caja' && <PantallaCaja editable={puedeEditar} />}
      </fieldset>
    </div>
  );
}

type Setter = <K extends keyof Parametros>(k: K, v: Partial<Parametros[K]>) => void;

function Regional({ p, setP, set }: { p: Parametros; setP: (p: Parametros) => void; set: Setter }) {
  const r = p.regional;
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 font-semibold">Elegir país (rellena moneda, impuestos y billetes; luego puede ajustar cada valor)</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESETS_PAIS).map(([codigo, x]) => (
            <Boton key={codigo} variante={r.monedaCodigo === x.monedaCodigo && r.pais === x.pais ? 'primario' : 'secundario'} onClick={() => setP(aplicarPreset(p, codigo))}>
              {x.pais} ({x.monedaCodigo})
            </Boton>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Campo etiqueta="País">
          <input className={inputCls} value={r.pais} onChange={(e) => set('regional', { pais: e.target.value })} />
        </Campo>
        <Campo etiqueta="Símbolo de moneda">
          <input className={inputCls} value={r.monedaSimbolo} maxLength={5} onChange={(e) => set('regional', { monedaSimbolo: e.target.value })} />
        </Campo>
        <Campo etiqueta="Código de moneda (ISO)">
          <input className={inputCls} value={r.monedaCodigo} maxLength={3} onChange={(e) => set('regional', { monedaCodigo: e.target.value.toUpperCase() })} />
        </Campo>
        <Campo etiqueta="Decimales">
          <select className={inputCls} value={r.decimales} onChange={(e) => set('regional', { decimales: Number(e.target.value) as 0 | 2 })}>
            <option value={0}>Sin decimales (ej. pesos)</option>
            <option value={2}>2 decimales</option>
          </select>
        </Campo>
        <Campo etiqueta="Separador de miles">
          <select className={inputCls} value={r.separadorMiles} onChange={(e) => set('regional', { separadorMiles: e.target.value as any })}>
            <option value=".">Punto (1.000)</option>
            <option value=",">Coma (1,000)</option>
            <option value=" ">Espacio (1 000)</option>
            <option value="">Ninguno (1000)</option>
          </select>
        </Campo>
        <Campo etiqueta="Separador decimal">
          <select className={inputCls} value={r.separadorDecimal} onChange={(e) => set('regional', { separadorDecimal: e.target.value as any })}>
            <option value=",">Coma (0,50)</option>
            <option value=".">Punto (0.50)</option>
          </select>
        </Campo>
        <Campo etiqueta="Identificación fiscal">
          <input className={inputCls} value={r.etiquetaFiscal} placeholder="NIT, RUC, RFC…" onChange={(e) => set('regional', { etiquetaFiscal: e.target.value })} />
        </Campo>
        <Campo etiqueta="Nombre del impuesto">
          <input className={inputCls} value={r.nombreImpuesto} placeholder="IVA, IGV…" onChange={(e) => set('regional', { nombreImpuesto: e.target.value })} />
        </Campo>
      </div>
      <div className="rounded-lg bg-slate-100 p-3 text-lg">
        Ejemplo: <b>{formatearDinero(1234567.5, r)}</b>
      </div>
      {r.decimales === 0 && (
        <div className="rounded-lg bg-amber-50 p-3 text-amber-800">
          Sin decimales: los totales se redondean a pesos enteros. Revise que los precios de los productos no tengan centavos.
        </div>
      )}

      <div>
        <div className="font-semibold">Impuestos</div>
        <div className="mb-2 text-sm text-slate-500">
          Al guardar, los productos se ajustan solos: si cambia una tasa, se aplica a todos sus productos; si elimina un impuesto, sus productos pasan al
          impuesto por defecto. Para no cobrar {r.nombreImpuesto || 'impuesto'}, deje un solo impuesto con tasa 0.
        </div>
        <table className="w-full text-left">
          <thead className="text-sm text-slate-500">
            <tr>
              <th className="p-1">Código</th>
              <th>Nombre en el ticket</th>
              <th>Tasa %</th>
              <th>Por defecto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {r.impuestos.map((imp, i) => {
              const cambiar = (v: Partial<typeof imp>) => set('regional', { impuestos: r.impuestos.map((x, j) => (j === i ? { ...x, ...v } : x)) });
              return (
                <tr key={i}>
                  <td className="p-1">
                    <input className={`${inputCls} w-32`} value={imp.codigo} onChange={(e) => cambiar({ codigo: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} />
                  </td>
                  <td className="p-1">
                    <input className={`${inputCls} w-full`} value={imp.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} />
                  </td>
                  <td className="p-1">
                    <input className={`${inputCls} w-24`} type="number" min={0} max={100} step="0.01" value={imp.tasa} onChange={(e) => cambiar({ tasa: Number(e.target.value) })} />
                  </td>
                  <td className="p-1 text-center">
                    <input type="radio" className="h-7 w-7" checked={r.impuestoPorDefecto === imp.codigo} onChange={() => set('regional', { impuestoPorDefecto: imp.codigo })} />
                  </td>
                  <td className="p-1">
                    <Boton variante="peligro" className="h-12 min-h-0" disabled={r.impuestos.length <= 1} onClick={() => {
                        const resto = r.impuestos.filter((_, j) => j !== i);
                        // Si se elimina el impuesto por defecto, pasa a ser el primero que queda (si no, el guardado falla)
                        const porDefecto = resto.some((x) => x.codigo === r.impuestoPorDefecto) ? r.impuestoPorDefecto : resto[0].codigo;
                        set('regional', { impuestos: resto, impuestoPorDefecto: porDefecto });
                      }}>
                      Quitar
                    </Boton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Boton className="mt-2" onClick={() => set('regional', { impuestos: [...r.impuestos, { codigo: `IMP${r.impuestos.length + 1}`, nombre: 'Nuevo', tasa: 0 }] })}>
          + Agregar impuesto
        </Boton>
      </div>
    </div>
  );
}

function Marca({ p, set }: { p: Parametros; set: Setter }) {
  const m = p.marca;
  const [subiendo, setSubiendo] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <Campo etiqueta="Nombre comercial (aparece en el ticket y en la caja)">
          <input className={inputCls} value={m.nombreComercial} onChange={(e) => set('marca', { nombreComercial: e.target.value })} />
        </Campo>
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Color principal">
            <input type="color" className="h-14 w-full" value={m.colorPrimario} onChange={(e) => set('marca', { colorPrimario: e.target.value })} />
          </Campo>
          <Campo etiqueta="Color de acento">
            <input type="color" className="h-14 w-full" value={m.colorAcento} onChange={(e) => set('marca', { colorAcento: e.target.value })} />
          </Campo>
        </div>
        <Campo etiqueta="Logo (PNG o JPG; para el ticket se convierte a blanco y negro)">
          <input
            type="file"
            accept="image/*"
            disabled={subiendo}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setSubiendo(true);
              try {
                set('marca', { logoId: await subirLogo(f) });
              } catch (err: any) {
                toast.error(err.message);
              } finally {
                setSubiendo(false);
              }
            }}
          />
        </Campo>
        {m.logoId && (
          <div className="flex items-center gap-4">
            <img src={urlMedia(m.logoId)!} className="h-24 rounded border bg-white object-contain p-1" />
            <Boton variante="peligro" onClick={() => set('marca', { logoId: null })}>
              Quitar logo
            </Boton>
          </div>
        )}
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-600">Vista previa de la caja</div>
        <div className="overflow-hidden rounded-xl border shadow" style={{ ['--marca' as any]: m.colorPrimario, ['--acento' as any]: m.colorAcento }}>
          <div className="flex items-center gap-3 px-4 py-3 text-white" style={{ background: `color-mix(in srgb, ${m.colorPrimario} 65%, black)` }}>
            {m.logoId && <img src={urlMedia(m.logoId)!} className="h-10 rounded bg-white object-contain p-0.5" />}
            <b className="text-lg">Caja 1</b> · Carlos
          </div>
          <div className="grid grid-cols-3 gap-2 bg-slate-100 p-3">
            {['Arroz', 'Leche', 'Pan'].map((x) => (
              <div key={x} className="rounded-lg border-b-4 bg-white p-3 text-center" style={{ borderColor: m.colorPrimario }}>
                {x}
              </div>
            ))}
          </div>
          <div className="p-3">
            <div className="rounded-xl p-4 text-center text-2xl font-bold text-white" style={{ background: m.colorPrimario, boxShadow: `0 0 0 4px ${m.colorAcento}` }}>
              COBRAR
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Ticket({ p, set }: { p: Parametros; set: Setter }) {
  const t = p.ticket;
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
      <div className="space-y-4">
        <Campo etiqueta="Líneas adicionales del encabezado (una por línea, máx. 6). Ej.: régimen, resolución, horario">
          <textarea
            className="h-28 rounded-lg border-2 border-slate-300 p-2 text-lg"
            value={t.encabezado.join('\n')}
            onChange={(e) => set('ticket', { encabezado: e.target.value.split('\n').slice(0, 6) })}
          />
        </Campo>
        <Campo etiqueta="Mensaje al pie (cada sucursal puede tener el suyo en Sucursales)">
          <textarea className="h-20 rounded-lg border-2 border-slate-300 p-2 text-lg" value={t.pie} onChange={(e) => set('ticket', { pie: e.target.value })} />
        </Campo>
        <Campo etiqueta="Código QR al final (página web, encuesta, WhatsApp… vacío = sin QR)">
          <input className={inputCls} value={t.qr} placeholder="https://…" onChange={(e) => set('ticket', { qr: e.target.value })} />
        </Campo>
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Ancho de papel para la vista previa">
            <select className={inputCls} value={t.ancho} onChange={(e) => set('ticket', { ancho: Number(e.target.value) as 58 | 80 })}>
              <option value={80}>80 mm</option>
              <option value={58}>58 mm</option>
            </select>
          </Campo>
          <Campo etiqueta="Copias por venta">
            <select className={inputCls} value={t.copias} onChange={(e) => set('ticket', { copias: Number(e.target.value) })}>
              {[1, 2, 3].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Campo>
        </div>
        {(
          [
            ['mostrarLogo', 'Imprimir el logo'],
            ['mostrarDatosFiscales', `Imprimir ${p.regional.etiquetaFiscal} de la sucursal`],
            ['mostrarAhorro', 'Mostrar «Usted ahorró» cuando hay descuentos'],
          ] as const
        ).map(([k, texto]) => (
          <label key={k} className="flex items-center gap-3 text-lg">
            <input type="checkbox" className="h-7 w-7" checked={t[k]} onChange={(e) => set('ticket', { [k]: e.target.checked })} />
            {texto}
          </label>
        ))}
        <div className="text-sm text-slate-500">
          El ancho real del papel de cada caja se elige en la propia caja (Configuración → Impresora). La dirección, teléfono y {p.regional.etiquetaFiscal} se toman
          de cada sucursal.
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-600">Vista previa</div>
        <VistaPreviaTicket p={p} />
      </div>
    </div>
  );
}

function Caja({ p, set }: { p: Parametros; set: Setter }) {
  const c = p.caja;
  const [billetes, setBilletes] = useState(c.billetesRapidos.join(', '));
  useEffect(() => setBilletes(c.billetesRapidos.join(', ')), [c.billetesRapidos.join(',')]);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-4">
        <Campo etiqueta="Billetes de cobro rápido (separados por coma)">
          <input
            className={inputCls}
            value={billetes}
            onChange={(e) => setBilletes(e.target.value)}
            onBlur={() =>
              set('caja', {
                billetesRapidos: billetes
                  .split(/[,;\s]+/)
                  .map((x) => Number(x.replace(/[^\d]/g, '')))
                  .filter((n) => n > 0)
                  .slice(0, 8),
              })
            }
          />
        </Campo>
        <div>
          <div className="mb-1 text-sm font-semibold text-slate-600">Formas de pago habilitadas</div>
          {FORMAS_PAGO.map((f) => (
            <label key={f.id} className="flex items-center gap-3 py-1 text-lg">
              <input
                type="checkbox"
                className="h-7 w-7"
                checked={c.formasPago.includes(f.id)}
                onChange={(e) => {
                  const nuevas = e.target.checked ? [...c.formasPago, f.id] : c.formasPago.filter((x) => x !== f.id);
                  if (nuevas.length) set('caja', { formasPago: FORMAS_PAGO.map((x) => x.id).filter((x) => nuevas.includes(x)) });
                }}
              />
              {f.nombre}
            </label>
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <Campo etiqueta="Cerrar sesión de caja tras minutos sin uso (solo con el carrito vacío)">
          <input className={inputCls} type="number" min={1} max={240} value={c.inactividadMin} onChange={(e) => set('caja', { inactividadMin: Number(e.target.value) || 10 })} />
        </Campo>
        <label className="flex items-center gap-3 text-lg">
          <input type="checkbox" className="h-7 w-7" checked={c.venderSinStock} onChange={(e) => set('caja', { venderSinStock: e.target.checked })} />
          Permitir vender productos sin stock registrado
        </label>
        {!c.venderSinStock && (
          <div className="rounded-lg bg-amber-50 p-3 text-amber-800">
            La caja rechazará ventas de productos sin existencias. Cargue primero el inventario inicial (Recibir mercancía, o Inventario → Contar y corregir).
          </div>
        )}
      </div>
    </div>
  );
}

/** Orden y colores de categorías, aspecto de la grilla y favoritos */
function PantallaCaja({ editable }: { editable: boolean }) {
  const params = useParametros((s) => s.p);
  const [p, setLocal] = useState(params);
  const [categorias, setCategorias] = useState<any[]>([]);
  const [buscar, setBuscar] = useState('');
  const [productos, setProductos] = useState<any[]>([]);

  const cargarCats = () => get('/catalogo/categorias').then(setCategorias);
  const cargarProd = () =>
    get(`/catalogo/productos?porPagina=40&buscar=${encodeURIComponent(buscar)}`).then((r) =>
      setProductos(buscar ? r.items : r.items.sort((a: any, b: any) => Number(b.favorito) - Number(a.favorito))),
    );
  useEffect(() => {
    cargarCats();
    cargarProd();
  }, []);
  useEffect(() => setLocal(params), [params]);

  const mover = async (i: number, d: -1 | 1) => {
    const lista = [...categorias];
    const j = i + d;
    if (j < 0 || j >= lista.length) return;
    [lista[i], lista[j]] = [lista[j], lista[i]];
    setCategorias(lista);
    try {
      await Promise.all(lista.map((c, k) => (c.orden !== k + 1 ? put(`/catalogo/categorias/${c.id}`, { nombre: c.nombre, color: c.color, orden: k + 1 }) : null)));
      cargarCats();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const favorito = async (prod: any, fav: boolean) => {
    try {
      await put(`/catalogo/productos/${prod.id}`, {
        ...prod,
        favorito: fav,
        codigos: prod.codigos.map((c: any) => c.codigo),
        preciosSucursal: prod.precios.map((x: any) => ({ sucursalId: x.sucursalId, precio: String(x.precio) })),
      });
      setProductos(productos.map((x) => (x.id === prod.id ? { ...x, favorito: fav } : x)));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const guardarAspecto = async (cambio: Partial<Parametros['caja']>) => {
    const nuevo = { ...p, caja: { ...p.caja, ...cambio } };
    setLocal(nuevo);
    try {
      useParametros.getState().aplicar(normalizarParametros(await put('/parametros', nuevo)), true);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="font-semibold">Aspecto de la grilla de productos (se guarda al cambiar)</div>
        <div className="grid grid-cols-2 gap-4">
          <Campo etiqueta="Columnas">
            <select className={inputCls} value={p.caja.columnasGrilla} onChange={(e) => guardarAspecto({ columnasGrilla: Number(e.target.value) })}>
              {[3, 4, 5, 6, 7, 8].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </Campo>
          <Campo etiqueta="Tamaño de botones">
            <select className={inputCls} value={p.caja.tamanoBotones} onChange={(e) => guardarAspecto({ tamanoBotones: e.target.value as any })}>
              <option value="NORMAL">Normal</option>
              <option value="GRANDE">Grande</option>
            </select>
          </Campo>
        </div>
        <label className="flex items-center gap-3 text-lg">
          <input type="checkbox" className="h-7 w-7" checked={p.caja.mostrarImagenes} onChange={(e) => guardarAspecto({ mostrarImagenes: e.target.checked })} />
          Mostrar imágenes de productos
        </label>

        <div className="pt-2 font-semibold">Orden y color de categorías</div>
        {categorias.map((c, i) => (
          <div key={c.id} className="flex items-center gap-2">
            <input
              type="color"
              className="h-12 w-14"
              value={c.color ?? '#475569'}
              onChange={(e) => setCategorias(categorias.map((x) => (x.id === c.id ? { ...x, color: e.target.value } : x)))}
              onBlur={(e) => put(`/catalogo/categorias/${c.id}`, { nombre: c.nombre, color: e.target.value, orden: c.orden }).catch((err) => toast.error(err.message))}
            />
            <span className="flex-1 rounded-lg px-3 py-2 text-lg text-white" style={{ background: c.color ?? '#475569' }}>
              {c.nombre}
            </span>
            <Boton className="h-12 min-h-0 w-14" disabled={!editable || i === 0} onClick={() => mover(i, -1)}>
              ▲
            </Boton>
            <Boton className="h-12 min-h-0 w-14" disabled={!editable || i === categorias.length - 1} onClick={() => mover(i, 1)}>
              ▼
            </Boton>
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <div className="font-semibold">Favoritos (botones de la primera pantalla de la caja)</div>
        <div className="flex gap-2">
          <input className={`${inputCls} flex-1`} placeholder="Buscar producto" value={buscar} onChange={(e) => setBuscar(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && cargarProd()} />
          <Boton onClick={cargarProd}>Buscar</Boton>
        </div>
        <div className="max-h-[480px] overflow-y-auto rounded-lg border">
          {productos.map((x) => (
            <label key={x.id} className="flex items-center gap-3 border-b px-3 py-2 text-lg">
              <input type="checkbox" className="h-7 w-7" checked={x.favorito} onChange={(e) => favorito(x, e.target.checked)} />
              <span className="flex-1">{x.nombre}</span>
              <span className="font-mono text-sm text-slate-500">{x.sku}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Asistente de primer uso: aparece en el central mientras el sistema no está configurado */
export function AsistenteInicial({ onTerminar }: { onTerminar: () => void }) {
  const [paso, setPaso] = useState(1);
  const actual = useParametros((s) => s.p);
  const [p, setP] = useState<Parametros>(actual);
  const [guardando, setGuardando] = useState(false);

  const terminar = async () => {
    setGuardando(true);
    try {
      const r = await put('/parametros', p);
      useParametros.getState().aplicar(normalizarParametros(r), true);
      toast.ok('¡Listo! Ahora revise los datos de su sucursal (dirección y ' + p.regional.etiquetaFiscal + ').');
      onTerminar();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal titulo={`Configuración inicial (${paso} de 3)`} ancho="max-w-3xl">
      {paso === 1 && (
        <div className="space-y-4">
          <div className="text-lg">¿En qué país opera el negocio? Define moneda, decimales e impuestos.</div>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(PRESETS_PAIS).map(([codigo, x]) => (
              <Boton key={codigo} className="h-20 text-xl" variante={p.regional.pais === x.pais ? 'primario' : 'secundario'} onClick={() => setP(aplicarPreset(p, codigo))}>
                {x.pais}
                <span className="text-sm font-normal">
                  {x.monedaSimbolo} {x.monedaCodigo} · {x.nombreImpuesto} {x.impuestos[0].tasa}%
                </span>
              </Boton>
            ))}
          </div>
        </div>
      )}
      {paso === 2 && (
        <div className="space-y-4">
          <Campo etiqueta="Nombre del negocio">
            <input className={inputCls} value={p.marca.nombreComercial} onChange={(e) => setP({ ...p, marca: { ...p.marca, nombreComercial: e.target.value } })} />
          </Campo>
          <div className="grid grid-cols-2 gap-4">
            <Campo etiqueta="Color principal">
              <input type="color" className="h-14 w-full" value={p.marca.colorPrimario} onChange={(e) => setP({ ...p, marca: { ...p.marca, colorPrimario: e.target.value } })} />
            </Campo>
            <Campo etiqueta="Logo (opcional)">
              <input
                type="file"
                accept="image/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    try {
                      const id = await subirLogo(f);
                      setP({ ...p, marca: { ...p.marca, logoId: id } });
                    } catch (err: any) {
                      toast.error(err.message);
                    }
                  }
                }}
              />
            </Campo>
          </div>
          {p.marca.logoId && <img src={urlMedia(p.marca.logoId)!} className="h-20 rounded border object-contain p-1" />}
        </div>
      )}
      {paso === 3 && (
        <div className="space-y-3">
          <div className="text-lg">Así se verá el ticket. Puede cambiar todo esto después en Administración → Configuración del sistema.</div>
          <VistaPreviaTicket p={p} />
        </div>
      )}
      <div className="mt-6 flex justify-between">
        <Boton disabled={paso === 1} onClick={() => setPaso(paso - 1)}>
          Atrás
        </Boton>
        {paso < 3 ? (
          <Boton variante="primario" className="w-40" disabled={paso === 2 && !p.marca.nombreComercial.trim()} onClick={() => setPaso(paso + 1)}>
            Siguiente
          </Boton>
        ) : (
          <Boton variante="primario" className="w-40" disabled={guardando} onClick={terminar}>
            {guardando ? 'Guardando…' : 'Terminar'}
          </Boton>
        )}
      </div>
    </Modal>
  );
}
