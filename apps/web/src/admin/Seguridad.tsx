import { useEffect, useState } from 'react';
import { PERMISO_DESCRIPCION, TODOS_LOS_PERMISOS, type Permiso } from '@pos/shared';
import { get, post, put, del } from '../lib/api';
import { Boton, Campo, inputCls, Modal, toast } from '../components/ui';
import { HardwareCampos } from '../components/HardwareCampos';
import { extraerHardware, HARDWARE_DEFECTO } from '../lib/hardware';

// ───────────────────────── Usuarios ─────────────────────────
export function Usuarios() {
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [ed, setEd] = useState<any | null>(null);

  const cargar = () => get('/usuarios').then(setUsuarios).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
    get('/roles').then(setRoles).catch(() => undefined);
    get('/sucursales').then(setSucursales).catch(() => undefined);
  }, []);

  const abrir = (u?: any) =>
    setEd(
      u
        ? { ...u, password: '', pin: '', roles: u.roles.map((r: any) => ({ rolId: r.rolId, sucursalId: r.sucursalId })) }
        : { usuario: '', nombre: '', password: '', pin: '', codigoTarjeta: '', activo: true, roles: [] },
    );

  const guardar = async () => {
    const body = {
      usuario: ed.usuario,
      nombre: ed.nombre,
      password: ed.password || undefined,
      pin: ed.pin || undefined,
      codigoTarjeta: ed.codigoTarjeta || null,
      foto: ed.foto ?? null,
      activo: ed.activo,
      roles: ed.roles,
    };
    try {
      ed.id ? await put(`/usuarios/${ed.id}`, body) : await post('/usuarios', body);
      toast.ok('Usuario guardado');
      setEd(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const nombreSuc = (id: string | null) => (id ? sucursales.find((s) => s.id === id)?.nombre ?? '?' : 'Todas');

  return (
    <div className="space-y-4">
      <div className="flex">
        <h1 className="flex-1 text-2xl font-bold">Usuarios</h1>
        <Boton variante="primario" onClick={() => abrir()}>
          + Nuevo usuario
        </Boton>
      </div>
      <table className="w-full rounded-xl bg-white text-left shadow">
        <thead className="bg-slate-100 text-sm text-slate-600">
          <tr>
            <th className="p-3">Nombre</th>
            <th>Usuario</th>
            <th>Roles</th>
            <th>PIN</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {usuarios.map((u) => (
            <tr key={u.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => abrir(u)}>
              <td className="p-3 font-semibold">{u.nombre}</td>
              <td className="font-mono">{u.usuario}</td>
              <td>{u.roles.map((r: any) => `${r.rol.nombre} (${nombreSuc(r.sucursalId)})`).join(', ')}</td>
              <td>{u.tienePin ? '✔' : '—'}</td>
              <td>{u.activo ? 'Activo' : <span className="text-red-600">Inactivo</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {ed && (
        <Modal titulo={ed.id ? 'Editar usuario' : 'Nuevo usuario'} onCerrar={() => setEd(null)} ancho="max-w-3xl">
          <div className="grid grid-cols-2 gap-4">
            <Campo etiqueta="Nombre completo">
              <input className={inputCls} value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="Usuario (login web)">
              <input className={inputCls} value={ed.usuario} onChange={(e) => setEd({ ...ed, usuario: e.target.value })} />
            </Campo>
            <Campo etiqueta={ed.id ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña'}>
              <input className={inputCls} type="password" value={ed.password} onChange={(e) => setEd({ ...ed, password: e.target.value })} />
            </Campo>
            <Campo etiqueta={ed.id ? 'Nuevo PIN de caja (vacío = no cambiar)' : 'PIN de caja (4-6 dígitos)'}>
              <input className={inputCls} inputMode="numeric" maxLength={6} value={ed.pin} onChange={(e) => setEd({ ...ed, pin: e.target.value.replace(/\D/g, '') })} />
            </Campo>
            <Campo etiqueta="Código de tarjeta de supervisor (opcional)">
              <input className={inputCls} value={ed.codigoTarjeta ?? ''} onChange={(e) => setEd({ ...ed, codigoTarjeta: e.target.value })} />
            </Campo>
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" className="h-7 w-7" checked={ed.activo} onChange={(e) => setEd({ ...ed, activo: e.target.checked })} />
              Activo
            </label>
          </div>
          <h3 className="mb-2 mt-5 text-lg font-bold">Roles</h3>
          {ed.roles.map((r: any, i: number) => (
            <div key={i} className="mb-2 flex gap-2">
              <select className={`${inputCls} flex-1`} value={r.rolId} onChange={(e) => setEd({ ...ed, roles: ed.roles.map((x: any, j: number) => (j === i ? { ...x, rolId: e.target.value } : x)) })}>
                <option value="">Rol…</option>
                {roles.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </select>
              <select className={`${inputCls} flex-1`} value={r.sucursalId ?? ''} onChange={(e) => setEd({ ...ed, roles: ed.roles.map((x: any, j: number) => (j === i ? { ...x, sucursalId: e.target.value || null } : x)) })}>
                <option value="">Todas las sucursales</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
              <Boton variante="peligro" onClick={() => setEd({ ...ed, roles: ed.roles.filter((_: any, j: number) => j !== i) })}>
                ✕
              </Boton>
            </div>
          ))}
          <Boton onClick={() => setEd({ ...ed, roles: [...ed.roles, { rolId: '', sucursalId: sucursales[0]?.id ?? null }] })}>+ Agregar rol</Boton>
          <div className="mt-5 flex justify-between">
            {ed.id ? (
              <Boton variante="peligro" onClick={async () => { if (confirm('¿Eliminar usuario?')) { await del(`/usuarios/${ed.id}`).catch((e) => toast.error(e.message)); setEd(null); cargar(); } }}>
                Eliminar
              </Boton>
            ) : <span />}
            <Boton variante="primario" className="w-48" onClick={guardar} disabled={ed.roles.some((r: any) => !r.rolId)}>
              Guardar
            </Boton>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ───────────────────────── Roles ─────────────────────────
const GRUPOS: { titulo: string; prefijos: string[] }[] = [
  { titulo: 'Caja', prefijos: ['turno.', 'venta.', 'precio.', 'caja.retiro', 'caja.ingreso', 'caja.abrir_cajon'] },
  { titulo: 'Catálogo', prefijos: ['producto.', 'promocion.'] },
  { titulo: 'Inventario', prefijos: ['inventario.', 'compra.'] },
  { titulo: 'Administración', prefijos: ['usuario.', 'rol.', 'sucursal.', 'caja.gestionar', 'reporte.', 'monitoreo.', 'backup.', 'kiosco.'] },
];

export function Roles() {
  const [roles, setRoles] = useState<any[]>([]);
  const [ed, setEd] = useState<any | null>(null);
  const cargar = () => get('/roles').then(setRoles).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
  }, []);

  const toggle = (p: Permiso) =>
    setEd({ ...ed, permisos: ed.permisos.includes(p) ? ed.permisos.filter((x: string) => x !== p) : [...ed.permisos, p] });

  const guardar = async () => {
    const body = { codigo: ed.codigo, nombre: ed.nombre, permisos: ed.permisos, descuentoMaximo: String(ed.descuentoMaximo), retiroMaximo: String(ed.retiroMaximo) };
    try {
      ed.id ? await put(`/roles/${ed.id}`, body) : await post('/roles', body);
      toast.ok('Rol guardado. Los usuarios verán los cambios al volver a iniciar sesión.');
      setEd(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex">
        <h1 className="flex-1 text-2xl font-bold">Roles y permisos</h1>
        <Boton variante="primario" onClick={() => setEd({ codigo: '', nombre: '', permisos: [], descuentoMaximo: 0, retiroMaximo: 0 })}>
          + Nuevo rol
        </Boton>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {roles.map((r) => (
          <button key={r.id} onClick={() => setEd({ ...r })} className="rounded-xl bg-white p-4 text-left shadow hover:ring-2 hover:ring-marca-500">
            <div className="text-lg font-bold">{r.nombre}</div>
            <div className="text-sm text-slate-500">
              {r.codigo} · {r.permisos.length} permisos · desc. máx {r.descuentoMaximo}% · retiro máx {r.retiroMaximo}
            </div>
          </button>
        ))}
      </div>
      {ed && (
        <Modal titulo={ed.id ? `Rol: ${ed.nombre}` : 'Nuevo rol'} onCerrar={() => setEd(null)} ancho="max-w-4xl">
          <div className="grid grid-cols-4 gap-3">
            <Campo etiqueta="Código">
              <input className={inputCls} value={ed.codigo} onChange={(e) => setEd({ ...ed, codigo: e.target.value.toUpperCase() })} />
            </Campo>
            <Campo etiqueta="Nombre">
              <input className={inputCls} value={ed.nombre} onChange={(e) => setEd({ ...ed, nombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="Descuento máximo %">
              <input className={inputCls} type="number" value={ed.descuentoMaximo} onChange={(e) => setEd({ ...ed, descuentoMaximo: e.target.value })} />
            </Campo>
            <Campo etiqueta="Retiro máximo">
              <input className={inputCls} type="number" value={ed.retiroMaximo} onChange={(e) => setEd({ ...ed, retiroMaximo: e.target.value })} />
            </Campo>
          </div>
          {GRUPOS.map((g) => (
            <div key={g.titulo} className="mt-4">
              <h3 className="mb-2 font-bold">{g.titulo}</h3>
              <div className="grid grid-cols-2 gap-2">
                {TODOS_LOS_PERMISOS.filter((p) => g.prefijos.some((x) => p.startsWith(x))).map((p) => (
                  <label key={p} className="flex min-h-[48px] items-center gap-3 rounded-lg border p-2">
                    <input type="checkbox" className="h-6 w-6" checked={ed.permisos.includes(p)} onChange={() => toggle(p)} />
                    {PERMISO_DESCRIPCION[p]}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="mt-5 flex justify-between">
            {ed.id ? (
              <Boton variante="peligro" onClick={async () => { try { await del(`/roles/${ed.id}`); setEd(null); cargar(); } catch (e: any) { toast.error(e.message); } }}>
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

// ───────────────────────── Sucursales y cajas ─────────────────────────
export function Sucursales() {
  const [sucursales, setSucursales] = useState<any[]>([]);
  const [ed, setEd] = useState<any | null>(null);
  const [caja, setCaja] = useState<any | null>(null);
  const [token, setToken] = useState<{ sucursalId: string; token: string } | null>(null);
  const cargar = () => get('/sucursales').then(setSucursales).catch((e) => toast.error(e.message));
  useEffect(() => {
    cargar();
  }, []);

  const guardar = async () => {
    const { id, cajas, tieneTokenSync, createdAt, updatedAt, deletedAt, ...body } = ed;
    try {
      id ? await put(`/sucursales/${id}`, body) : await post('/sucursales', body);
      setEd(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const guardarCaja = async () => {
    const { id, createdAt, updatedAt, deletedAt, ...body } = caja;
    try {
      id ? await put(`/cajas/${id}`, body) : await post('/cajas', body);
      setCaja(null);
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const generarToken = async (s: any) => {
    if (s.tieneTokenSync && !confirm('Ya existe un token. Al generar uno nuevo, la tienda dejará de sincronizar hasta actualizar su .env. ¿Continuar?')) return;
    try {
      setToken(await post(`/sucursales/${s.id}/token-sync`));
      cargar();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex">
        <h1 className="flex-1 text-2xl font-bold">Sucursales y cajas</h1>
        <Boton variante="primario" onClick={() => setEd({ codigo: '', nombre: '', direccion: '', ruc: '', telefono: '', pieTicket: '', activa: true })}>
          + Nueva sucursal
        </Boton>
      </div>
      {sucursales.map((s) => (
        <div key={s.id} className="rounded-xl bg-white p-4 shadow">
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="text-lg font-bold">
                {s.codigo} · {s.nombre}
              </div>
              <div className="font-mono text-xs text-slate-500">ID: {s.id}</div>
            </div>
            <Boton onClick={() => setEd({ ...s })}>Editar</Boton>
            <Boton variante="info" onClick={() => generarToken(s)}>
              {s.tieneTokenSync ? 'Regenerar token sync' : 'Generar token sync'}
            </Boton>
            <Boton onClick={() => setCaja({ sucursalId: s.id, codigo: '', nombre: '', serie: '', activa: true })}>+ Caja</Boton>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {s.cajas.map((c: any) => (
              <button key={c.id} onClick={() => setCaja({ ...c })} className="rounded-lg border-2 px-4 py-2 hover:border-marca-500">
                {c.nombre} <span className="font-mono text-sm text-slate-500">serie {c.serie}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {token && (
        <Modal titulo="Token de sincronización" onCerrar={() => setToken(null)}>
          <p className="mb-3">
            Copie estos valores en el archivo <code>.env.store</code> del servidor de la tienda. <b>El token no se volverá a mostrar.</b>
          </p>
          <pre className="select-text whitespace-pre-wrap rounded-lg bg-slate-900 p-4 text-green-300">
            {`SUCURSAL_ID=${token.sucursalId}\nSYNC_TOKEN=${token.token}`}
          </pre>
        </Modal>
      )}

      {ed && (
        <Modal titulo={ed.id ? 'Editar sucursal' : 'Nueva sucursal'} onCerrar={() => setEd(null)}>
          <div className="grid grid-cols-2 gap-3">
            {[
              ['codigo', 'Código'],
              ['nombre', 'Nombre'],
              ['direccion', 'Dirección'],
              ['ruc', 'RUC / NIT'],
              ['telefono', 'Teléfono'],
            ].map(([k, t]) => (
              <Campo key={k} etiqueta={t}>
                <input className={inputCls} value={ed[k] ?? ''} onChange={(e) => setEd({ ...ed, [k]: e.target.value })} />
              </Campo>
            ))}
            <div className="col-span-2">
              <Campo etiqueta="Pie del ticket">
                <textarea className="h-20 rounded-lg border-2 p-2" value={ed.pieTicket ?? ''} onChange={(e) => setEd({ ...ed, pieTicket: e.target.value })} />
              </Campo>
            </div>
            <div className="col-span-2 rounded-lg bg-slate-50 p-3">
              <div className="mb-2 font-semibold">Etiquetas de balanza (EAN-13 con prefijo 20-29)</div>
              <div className="grid grid-cols-3 gap-2">
                <Campo etiqueta="Valor embebido">
                  <select
                    className={inputCls}
                    value={ed.configBalanza?.tipoValor ?? 'PESO'}
                    onChange={(e) => setEd({ ...ed, configBalanza: { prefijos: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'], longitudCodigo: 5, decimales: e.target.value === 'PESO' ? 3 : 2, validarDigito: true, ...ed.configBalanza, tipoValor: e.target.value } })}
                  >
                    <option value="PESO">Peso (kg, 3 decimales)</option>
                    <option value="PRECIO">Precio (2 decimales)</option>
                  </select>
                </Campo>
                <Campo etiqueta="Dígitos del PLU">
                  <input className={inputCls} type="number" value={ed.configBalanza?.longitudCodigo ?? 5} onChange={(e) => setEd({ ...ed, configBalanza: { prefijos: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'], tipoValor: 'PESO', decimales: 3, validarDigito: true, ...ed.configBalanza, longitudCodigo: Number(e.target.value) } })} />
                </Campo>
              </div>
            </div>
          </div>
          <Boton variante="primario" className="mt-4 w-full" onClick={guardar}>
            Guardar
          </Boton>
        </Modal>
      )}

      {caja && (
        <Modal titulo={caja.id ? 'Editar caja' : 'Nueva caja'} onCerrar={() => setCaja(null)} ancho={caja.hardware ? 'max-w-3xl' : 'max-w-lg'}>
          <div className="space-y-3">
            <Campo etiqueta="Código">
              <input className={inputCls} value={caja.codigo} onChange={(e) => setCaja({ ...caja, codigo: e.target.value })} />
            </Campo>
            <Campo etiqueta="Nombre">
              <input className={inputCls} value={caja.nombre} onChange={(e) => setCaja({ ...caja, nombre: e.target.value })} />
            </Campo>
            <Campo etiqueta="Serie de tickets (única en todo el sistema, ej. S02C01)">
              <input className={inputCls} value={caja.serie} onChange={(e) => setCaja({ ...caja, serie: e.target.value.toUpperCase() })} />
            </Campo>
            <label className="flex items-center gap-3 text-lg">
              <input type="checkbox" className="h-7 w-7" checked={caja.activa} onChange={(e) => setCaja({ ...caja, activa: e.target.checked })} />
              Activa
            </label>
            <div className="space-y-3 rounded-xl bg-slate-50 p-3">
              <label className="flex items-center gap-3 text-lg font-semibold">
                <input
                  type="checkbox"
                  className="h-7 w-7"
                  checked={!!caja.hardware}
                  onChange={(e) => setCaja({ ...caja, hardware: e.target.checked ? { ...HARDWARE_DEFECTO } : null })}
                />
                Configurar impresora, balanza y escáner desde aquí
              </label>
              {caja.hardware ? (
                <>
                  <HardwareCampos hw={extraerHardware(caja.hardware)} onChange={(h) => setCaja({ ...caja, hardware: h })} />
                  <p className="text-sm text-slate-600">
                    La caja aplica estos cambios sola en unos 2 minutos (o al reiniciarla). En la caja, estos campos quedan
                    bloqueados. El servidor y el modo kiosco se siguen configurando en cada equipo.
                  </p>
                </>
              ) : (
                <p className="text-sm text-slate-600">Desactivado: cada caja configura su hardware en su propia pantalla de Configuración.</p>
              )}
            </div>
            <Boton variante="primario" className="w-full" onClick={guardarCaja}>
              Guardar
            </Boton>
          </div>
        </Modal>
      )}
    </div>
  );
}
