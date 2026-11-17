import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { dinero } from '../lib/config';
import { Boton, Campo, inputCls, toast } from '../components/ui';

const hoy = () => new Date().toISOString().slice(0, 10);

function Tabla({ titulo, filas, columnas }: { titulo: string; filas: any[]; columnas: [string, string, ((v: any) => string)?][] }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <h2 className="mb-2 text-lg font-bold">{titulo}</h2>
      <table className="w-full text-left">
        <thead className="text-sm text-slate-500">
          <tr>
            {columnas.map(([k, t]) => (
              <th key={k} className="py-1">
                {t}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i} className="border-t">
              {columnas.map(([k, , fmt]) => (
                <td key={k} className="py-1">
                  {fmt ? fmt(f[k]) : String(f[k] ?? '')}
                </td>
              ))}
            </tr>
          ))}
          {!filas.length && (
            <tr>
              <td className="py-3 text-slate-400" colSpan={columnas.length}>
                Sin datos
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── Reportes ─────────────────────────
export function Reportes() {
  const [desde, setDesde] = useState(hoy());
  const [hasta, setHasta] = useState(hoy());
  const [sucursalId, setSucursalId] = useState('');
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [r, setR] = useState<any | null>(null);

  const cargar = () => get(`/reportes/resumen?desde=${desde}&hasta=${hasta}&sucursalId=${sucursalId}`).then(setR).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
    get('/sucursales').then(setSucursales).catch(() => undefined);
  }, []);

  const total = r?.diario.reduce((s: number, d: any) => s + Number(d.total), 0) ?? 0;
  const tickets = r?.diario.reduce((s: number, d: any) => s + Number(d.tickets), 0) ?? 0;
  const m = (v: any) => dinero(v ?? 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="flex-1 text-2xl font-bold">Reportes</h1>
        <Campo etiqueta="Desde">
          <input type="date" className={inputCls} value={desde} onChange={(e) => setDesde(e.target.value)} />
        </Campo>
        <Campo etiqueta="Hasta">
          <input type="date" className={inputCls} value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </Campo>
        <Campo etiqueta="Sucursal">
          <select className={inputCls} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)}>
            <option value="">Todas / la mía</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Boton variante="primario" onClick={cargar}>
          Consultar
        </Boton>
      </div>
      {r && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tarjeta t="Ventas" v={dinero(total)} />
            <Tarjeta t="Tickets" v={String(tickets)} />
            <Tarjeta t="Ticket promedio" v={dinero(tickets ? total / tickets : 0)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Tabla titulo="Ventas por día" filas={r.diario} columnas={[['dia', 'Día'], ['tickets', 'Tickets'], ['total', 'Total', m], ['descuento', 'Descuentos', m]]} />
            <Tabla titulo="Por forma de pago" filas={r.metodos} columnas={[['metodo', 'Método'], ['cantidad', 'Pagos'], ['total', 'Total', m]]} />
            <Tabla titulo="Por cajero" filas={r.cajeros} columnas={[['cajero', 'Cajero'], ['tickets', 'Tickets'], ['anuladas', 'Anuladas'], ['total', 'Total', m]]} />
            <Tabla titulo="Por caja" filas={r.cajas} columnas={[['sucursal', 'Sucursal'], ['caja', 'Caja'], ['tickets', 'Tickets'], ['total', 'Total', m]]} />
          </div>
          <Tabla
            titulo="Productos más vendidos y margen"
            filas={r.productos}
            columnas={[
              ['producto', 'Producto'],
              ['cantidad', 'Cantidad', (v) => Number(v).toLocaleString('es')],
              ['total', 'Venta', m],
              ['costo', 'Costo', m],
              ['margen', 'Margen', m],
              ['margenPorcentaje', 'Margen %', (v) => `${v}%`],
            ]}
          />
        </>
      )}
    </div>
  );
}

function Tarjeta({ t, v }: { t: string; v: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow">
      <div className="text-slate-500">{t}</div>
      <div className="text-3xl font-bold">{v}</div>
    </div>
  );
}

// ───────────────────────── Monitoreo de sucursales ─────────────────────────
export function Monitoreo() {
  const [items, setItems] = useState<any[]>([]);
  const cargar = () => get('/monitoreo/sucursales').then(setItems).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex">
        <h1 className="flex-1 text-2xl font-bold">Estado de sucursales</h1>
        <Boton onClick={cargar}>Actualizar</Boton>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {items.map((s) => (
          <div key={s.sucursal.id} className={`rounded-xl border-l-8 bg-white p-4 shadow ${s.alertas.length ? (s.online ? 'border-amber-500' : 'border-red-500') : 'border-marca-500'}`}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-bold">
                {s.sucursal.codigo} · {s.sucursal.nombre}
              </div>
              <span className={`rounded-full px-3 py-1 text-sm font-bold text-white ${s.online ? 'bg-marca-600' : 'bg-red-600'}`}>{s.online ? 'En línea' : 'Desconectada'}</span>
            </div>
            <div className="mt-2 text-sm text-slate-600">
              Último contacto: {s.ultimoHeartbeat ? new Date(s.ultimoHeartbeat).toLocaleString('es') : 'nunca'}
              {s.data && (
                <>
                  <br />
                  Versión {s.data.version} · Pendientes: {s.data.ventasPendientes} · Último backup: {s.data.ultimoBackup ? new Date(s.data.ultimoBackup).toLocaleString('es') : '—'}
                  <br />
                  Cajas: {s.data.cajas.map((c: any) => `${c.nombre} (${c.ultimaActividad ? new Date(c.ultimaActividad).toLocaleTimeString('es') : 'sin actividad'})`).join(', ')}
                </>
              )}
            </div>
            {s.alertas.map((a: string) => (
              <div key={a} className="mt-2 rounded bg-red-50 px-2 py-1 text-red-700">
                ⚠ {a}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── Backups ─────────────────────────
export function Backups() {
  const [estado, setEstado] = useState<any | null>(null);
  const [lista, setLista] = useState<any[]>([]);
  const [corriendo, setCorriendo] = useState(false);
  const cargar = () => {
    get('/backups/estado').then(setEstado).catch((e) => toast.error(e.message));
    get('/backups').then(setLista).catch(() => undefined);
  };
  useEffect(() => {
    cargar();
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex">
        <h1 className="flex-1 text-2xl font-bold">Copias de seguridad</h1>
        <Boton
          variante="primario"
          disabled={corriendo}
          onClick={async () => {
            setCorriendo(true);
            try {
              const r = await post('/backups');
              r.ok ? toast.ok('Backup realizado') : toast.error(`Falló: ${r.error}`);
            } catch (e: any) {
              toast.error(e.message);
            }
            setCorriendo(false);
            cargar();
          }}
        >
          {corriendo ? 'Ejecutando…' : 'Hacer backup ahora'}
        </Boton>
      </div>
      {estado && (
        <div className="rounded-xl bg-white p-4 shadow">
          <div>Carpeta: {estado.directorio}</div>
          <div>Copia externa: {estado.directorioExterno ?? <span className="text-red-600">no configurada</span>}</div>
          <div>Último backup exitoso: {estado.ultimoOk ? new Date(estado.ultimoOk.creadoEn).toLocaleString('es') : 'ninguno'}</div>
          {estado.alertas.map((a: string) => (
            <div key={a} className="mt-2 rounded bg-red-50 px-2 py-1 text-red-700">
              ⚠ {a}
            </div>
          ))}
          <div className="mt-2 text-sm text-slate-500">Para restaurar use scripts\restore-db.ps1 (detenga antes el servicio de la API).</div>
        </div>
      )}
      <table className="w-full rounded-xl bg-white text-left shadow">
        <thead className="bg-slate-100 text-sm text-slate-600">
          <tr>
            <th className="p-3">Fecha</th>
            <th>Tipo</th>
            <th>Resultado</th>
            <th>Tamaño</th>
            <th>Archivo</th>
          </tr>
        </thead>
        <tbody>
          {lista.map((b) => (
            <tr key={b.id} className="border-t">
              <td className="p-3">{new Date(b.creadoEn).toLocaleString('es')}</td>
              <td>{b.tipo}</td>
              <td className={b.ok ? 'text-marca-700' : 'text-red-600'}>{b.ok ? 'OK' : b.error}</td>
              <td>{b.tamano ? `${(b.tamano / 1048576).toFixed(1)} MB` : '—'}</td>
              <td className="font-mono text-xs">{b.archivo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ───────────────────────── Auditoría ─────────────────────────
export function Auditoria() {
  const [items, setItems] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<Record<string, string>>({});
  const [accion, setAccion] = useState('');
  const cargar = () => get(`/auditoria?accion=${encodeURIComponent(accion)}`).then(setItems).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
    get('/usuarios').then((u: any[]) => setUsuarios(Object.fromEntries(u.map((x) => [x.id, x.nombre])))).catch(() => undefined);
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold">Auditoría</h1>
        <select className={inputCls} value={accion} onChange={(e) => setAccion(e.target.value)}>
          <option value="">Todas las acciones</option>
          {['venta.anular', 'venta.descuento', 'venta.cambio_precio', 'venta.reimprimir', 'caja.retiro', 'caja.ingreso', 'turno.diferencia_arqueo', 'autorizacion:venta.anular_item', 'inventario.ajuste', 'inventario.merma', 'inventario.compra'].map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
        <Boton onClick={cargar}>Filtrar</Boton>
      </div>
      <table className="w-full rounded-xl bg-white text-left shadow">
        <thead className="bg-slate-100 text-sm text-slate-600">
          <tr>
            <th className="p-3">Fecha</th>
            <th>Acción</th>
            <th>Usuario</th>
            <th>Autorizó</th>
            <th>Motivo / detalle</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-t align-top">
              <td className="p-3 whitespace-nowrap">{new Date(a.creadoEn).toLocaleString('es')}</td>
              <td className="font-mono text-sm">{a.accion}</td>
              <td>{usuarios[a.usuarioId] ?? ''}</td>
              <td>{a.autorizadoPorId ? usuarios[a.autorizadoPorId] ?? '' : ''}</td>
              <td className="max-w-md text-sm text-slate-600">
                {a.motivo}
                {a.detalle && <div className="truncate font-mono text-xs text-slate-400">{JSON.stringify(a.detalle)}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
