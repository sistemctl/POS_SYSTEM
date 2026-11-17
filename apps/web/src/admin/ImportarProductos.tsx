import { useEffect, useState } from 'react';
import { descargar, get, post, subirArchivo } from '../lib/api';
import { dinero } from '../lib/config';
import { Boton, Modal, toast } from '../components/ui';

type Modo = 'TODO' | 'CREAR' | 'PRECIOS';

interface Problema {
  fila: number;
  columna?: string;
  tipo: 'error' | 'aviso';
  mensaje: string;
}

interface Resumen {
  loteId: string;
  archivo: string;
  modo: Modo;
  estado: 'VALIDADO' | 'APLICANDO' | 'TERMINADO' | 'ERROR';
  total: number;
  crear: number;
  actualizar: number;
  sinCambios: number;
  omitir: number;
  errores: number;
  avisos: number;
  problemas: Problema[];
  omitidos: { fila: number; motivo: string }[];
  muestra: { fila: number; accion: string; sku: string | null; codigos: string[]; nombre: string | null; precio: string | null }[];
  procesadas: number;
  resultado?: { creados: number; actualizados: number; sinCambios: number; omitidos: number; errores: Problema[] };
  error?: string;
}

const MODOS: { id: Modo; titulo: string; texto: string }[] = [
  { id: 'TODO', titulo: 'Crear y actualizar', texto: 'Crea los productos nuevos y actualiza los existentes (las celdas vacías no cambian nada).' },
  { id: 'CREAR', titulo: 'Solo crear nuevos', texto: 'Ignora los productos que ya existen.' },
  { id: 'PRECIOS', titulo: 'Solo precios y costos', texto: 'Actualiza precio/costo de productos existentes. Necesita sku o codigo_barras y precio.' },
];

function csvProblemas(problemas: Problema[]) {
  const filas = [['fila', 'columna', 'tipo', 'mensaje'], ...problemas.map((p) => [String(p.fila), p.columna ?? '', p.tipo, p.mensaje])];
  const csv = filas.map((f) => f.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'errores-importacion.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function ImportarProductos({ onCerrar, onTerminado }: { onCerrar: () => void; onTerminado: () => void }) {
  const [modo, setModo] = useState<Modo>('TODO');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [validando, setValidando] = useState(false);
  const [r, setR] = useState<Resumen | null>(null);
  const [filtro, setFiltro] = useState<'error' | 'aviso' | 'todos'>('error');

  // Seguimiento del progreso mientras se aplica
  useEffect(() => {
    if (r?.estado !== 'APLICANDO') return;
    const t = setInterval(async () => {
      try {
        const e = await get<Resumen>(`/catalogo/importacion/${r.loteId}`);
        setR(e);
        if (e.estado === 'TERMINADO') onTerminado();
      } catch (err: any) {
        toast.error(err.message);
      }
    }, 800);
    return () => clearInterval(t);
  }, [r?.estado, r?.loteId]);

  const validar = async () => {
    if (!archivo) return;
    setValidando(true);
    try {
      setR(await subirArchivo<Resumen>(`/catalogo/importacion/validar?modo=${modo}`, archivo));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setValidando(false);
    }
  };

  const aplicar = async () => {
    if (!r) return;
    try {
      setR(await post<Resumen>(`/catalogo/importacion/${r.loteId}/aplicar`));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const enCurso = r?.estado === 'APLICANDO';
  const aplicables = r ? r.crear + r.actualizar : 0;
  const problemas = r ? (filtro === 'todos' ? r.problemas : r.problemas.filter((p) => p.tipo === filtro)) : [];

  return (
    <Modal titulo="Importar productos desde Excel o CSV" onCerrar={enCurso ? undefined : onCerrar} ancho="max-w-5xl">
      {/* Paso 1: archivo */}
      {!r && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <Boton onClick={() => descargar('/catalogo/importacion/plantilla', 'plantilla-productos.xlsx').catch((e) => toast.error(e.message))}>
              ⬇ Descargar plantilla
            </Boton>
            <Boton
              onClick={() =>
                descargar('/catalogo/exportar', `productos-${new Date().toISOString().slice(0, 10)}.xlsx`).catch((e) => toast.error(e.message))
              }
            >
              ⬇ Exportar catálogo actual
            </Boton>
          </div>
          <div className="rounded-lg bg-sky-50 p-3 text-sky-900">
            Use la plantilla o su propio archivo: se reconocen columnas como <b>codigo_barras</b>, <b>nombre</b> (o descripción), <b>precio</b>,{' '}
            <b>categoria</b>, <b>impuesto</b> (o IVA). Para cambiar precios en masa: exporte el catálogo, edite en Excel y vuelva a importarlo.
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {MODOS.map((m) => (
              <button
                key={m.id}
                onClick={() => setModo(m.id)}
                className={`btn-touch rounded-xl border-2 p-4 text-left ${modo === m.id ? 'border-marca-600 bg-marca-50' : 'border-slate-200 bg-white'}`}
              >
                <div className="text-lg font-bold">{m.titulo}</div>
                <div className="text-sm font-normal text-slate-600">{m.texto}</div>
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-4 border-dashed border-slate-300 p-8 text-center hover:bg-slate-50">
            <span className="text-xl">{archivo ? `📄 ${archivo.name} (${Math.round(archivo.size / 1024)} KB)` : 'Toque para elegir el archivo .xlsx o .csv'}</span>
            <input type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          </label>
          <div className="flex justify-end">
            <Boton variante="primario" className="w-56" disabled={!archivo || validando} onClick={validar}>
              {validando ? 'Revisando archivo…' : 'Revisar (no guarda nada)'}
            </Boton>
          </div>
        </div>
      )}

      {/* Paso 2: vista previa */}
      {r && r.estado === 'VALIDADO' && (
        <div className="space-y-4">
          <div className="text-slate-600">
            {r.archivo} · {r.total} filas · modo «{MODOS.find((m) => m.id === r.modo)?.titulo}»
          </div>
          <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-5">
            {[
              ['Nuevos', r.crear, 'bg-marca-100 text-marca-800'],
              ['Se actualizan', r.actualizar, 'bg-sky-100 text-sky-800'],
              ['Sin cambios', r.sinCambios, 'bg-slate-100'],
              ['Omitidos', r.omitir, 'bg-amber-100 text-amber-800'],
              ['Con error', r.errores, 'bg-red-100 text-red-800'],
            ].map(([t, n, c]) => (
              <div key={t as string} className={`rounded-xl p-3 ${c}`}>
                <div className="text-3xl font-bold">{n as number}</div>
                <div className="text-sm">{t as string}</div>
              </div>
            ))}
          </div>

          {r.problemas.length > 0 && (
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-semibold">Revisión:</span>
                {(['error', 'aviso', 'todos'] as const).map((f) => (
                  <Boton key={f} className="h-11 min-h-0" variante={filtro === f ? 'primario' : 'secundario'} onClick={() => setFiltro(f)}>
                    {f === 'error' ? `Errores (${r.errores})` : f === 'aviso' ? `Avisos (${r.avisos})` : 'Todos'}
                  </Boton>
                ))}
                <div className="flex-1" />
                <Boton className="h-11 min-h-0" onClick={() => csvProblemas(r.problemas)}>
                  ⬇ Descargar lista
                </Boton>
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <table className="w-full text-left text-sm">
                  <tbody>
                    {problemas.slice(0, 500).map((p, i) => (
                      <tr key={i} className="border-b">
                        <td className="w-16 p-2 font-mono">Fila {p.fila}</td>
                        <td className="w-32">{p.columna}</td>
                        <td className={p.tipo === 'error' ? 'text-red-700' : 'text-amber-700'}>{p.mensaje}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {r.errores > 0 && <div className="mt-1 text-sm text-slate-500">Las filas con error no se importan; el resto sí. Corrija el archivo y vuelva a importarlo cuando quiera.</div>}
            </div>
          )}

          {r.muestra.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold">Ver ejemplo de los cambios ({Math.min(r.muestra.length, 50)})</summary>
              <table className="mt-2 w-full text-left text-sm">
                <tbody>
                  {r.muestra.map((m) => (
                    <tr key={m.fila} className="border-b">
                      <td className="p-1">{m.accion === 'crear' ? '🆕' : '✏️'}</td>
                      <td className="font-mono">{m.sku ?? m.codigos[0]}</td>
                      <td>{m.nombre ?? '(sin cambio de nombre)'}</td>
                      <td className="text-right">{m.precio ? dinero(m.precio) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          <div className="flex justify-between">
            <Boton onClick={() => setR(null)}>Elegir otro archivo</Boton>
            <Boton variante="primario" className="w-64" disabled={!aplicables} onClick={aplicar}>
              Importar {aplicables} productos
            </Boton>
          </div>
        </div>
      )}

      {/* Paso 3: progreso y resultado */}
      {r && (r.estado === 'APLICANDO' || r.estado === 'TERMINADO' || r.estado === 'ERROR') && (
        <div className="space-y-4">
          <div className="h-8 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full bg-marca-600 transition-all" style={{ width: `${Math.round((r.procesadas / Math.max(1, r.total)) * 100)}%` }} />
          </div>
          <div className="text-center text-lg">
            {r.estado === 'APLICANDO' && `Importando… ${r.procesadas} de ${r.total}`}
            {r.estado === 'ERROR' && <span className="text-red-700">Error: {r.error}</span>}
          </div>
          {r.resultado && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-4">
                {[
                  ['Creados', r.resultado.creados],
                  ['Actualizados', r.resultado.actualizados],
                  ['Sin cambios', r.resultado.sinCambios],
                  ['Con error', r.resultado.errores.length],
                ].map(([t, n]) => (
                  <div key={t as string} className="rounded-xl bg-slate-100 p-3">
                    <div className="text-3xl font-bold">{n as number}</div>
                    <div className="text-sm">{t as string}</div>
                  </div>
                ))}
              </div>
              {r.resultado.errores.length > 0 && (
                <Boton onClick={() => csvProblemas(r.resultado!.errores)}>⬇ Descargar filas que fallaron</Boton>
              )}
              <div className="rounded-lg bg-marca-50 p-3 text-marca-800">
                Listo. Las tiendas recibirán los productos en la próxima sincronización (menos de un minuto si hay conexión).
              </div>
              <div className="flex justify-end">
                <Boton variante="primario" className="w-40" onClick={onCerrar}>
                  Cerrar
                </Boton>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
