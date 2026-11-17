import { Campo, inputCls } from './ui';
import type { HardwareCaja } from '../lib/hardware';

interface Props {
  hw: HardwareCaja;
  onChange: (hw: HardwareCaja) => void;
  /** Impresoras de Windows detectadas en el equipo (solo en la caja). Sin lista: se escribe el nombre. */
  impresoras?: string[];
  /** Puertos COM detectados en el equipo (solo en la caja). Sin lista: COM1…COM20. */
  puertos?: { path: string; manufacturer?: string }[];
  deshabilitado?: boolean;
}

const COM_GENERICOS = Array.from({ length: 20 }, (_, i) => ({ path: `COM${i + 1}` }));

/** Campos de impresora, balanza, escáner y visor: los usa la caja (local) y Administración → Sucursales y cajas. */
export function HardwareCampos({ hw, onChange, impresoras, puertos, deshabilitado }: Props) {
  const listaPuertos: { path: string; manufacturer?: string }[] = puertos ?? COM_GENERICOS;
  const set = <K extends keyof HardwareCaja>(k: K, v: Partial<HardwareCaja[K]>) =>
    onChange({ ...hw, [k]: typeof hw[k] === 'object' ? { ...(hw[k] as object), ...(v as object) } : v });

  const opcionesPuerto = (actual?: string) => {
    const lista = [...listaPuertos];
    // Mantener visible un puerto guardado que no esté en la lista (cable desconectado, otro equipo…)
    if (actual && actual !== 'auto' && !lista.some((p) => p.path === actual)) lista.unshift({ path: actual });
    return lista.map((p) => (
      <option key={p.path} value={p.path}>
        {p.path} {p.manufacturer ? `(${p.manufacturer})` : ''}
      </option>
    ));
  };

  return (
    <fieldset disabled={deshabilitado} className="grid grid-cols-2 gap-4 disabled:opacity-60">
      <Campo etiqueta="Impresora térmica">
        <select className={inputCls} value={hw.impresora.tipo} onChange={(e) => set('impresora', { tipo: e.target.value as any })}>
          <option value="windows">Impresora de Windows (USB)</option>
          <option value="red">Impresora de red (IP)</option>
          <option value="serie">Puerto serie / USB-COM</option>
          <option value="ninguna">Sin impresora</option>
        </select>
      </Campo>
      {hw.impresora.tipo === 'serie' && (
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Puerto COM">
            <select className={inputCls} value={hw.impresora.com ?? ''} onChange={(e) => set('impresora', { com: e.target.value })}>
              <option value="">Seleccione…</option>
              {opcionesPuerto(hw.impresora.com)}
            </select>
          </Campo>
          <Campo etiqueta="Baudios">
            <select className={inputCls} value={hw.impresora.baudios ?? 9600} onChange={(e) => set('impresora', { baudios: Number(e.target.value) })}>
              {[9600, 19200, 38400, 115200].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Campo>
        </div>
      )}
      {hw.impresora.tipo === 'windows' && (
        <Campo etiqueta="Nombre de la impresora">
          {impresoras ? (
            <select className={inputCls} value={hw.impresora.nombre ?? ''} onChange={(e) => set('impresora', { nombre: e.target.value })}>
              <option value="">(Predeterminada)</option>
              {hw.impresora.nombre && !impresoras.includes(hw.impresora.nombre) && <option>{hw.impresora.nombre}</option>}
              {impresoras.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          ) : (
            <input
              className={inputCls}
              placeholder="Vacío = predeterminada de Windows"
              value={hw.impresora.nombre ?? ''}
              onChange={(e) => set('impresora', { nombre: e.target.value })}
            />
          )}
        </Campo>
      )}
      {hw.impresora.tipo === 'red' && (
        <Campo etiqueta="IP de la impresora (puerto 9100)">
          <input className={inputCls} value={hw.impresora.host ?? ''} onChange={(e) => set('impresora', { host: e.target.value, puerto: 9100 })} />
        </Campo>
      )}
      <Campo etiqueta="Ancho de papel">
        <select className={inputCls} value={hw.impresora.ancho} onChange={(e) => set('impresora', { ancho: Number(e.target.value) as 58 | 80 })}>
          <option value={80}>80 mm</option>
          <option value={58}>58 mm</option>
        </select>
      </Campo>
      <label className="flex items-center gap-3 text-lg">
        <input type="checkbox" className="h-7 w-7" checked={hw.impresora.abrirCajon} onChange={(e) => set('impresora', { abrirCajon: e.target.checked })} />
        Abrir cajón al cobrar en efectivo
      </label>

      <Campo etiqueta="Balanza">
        <select className={inputCls} value={hw.balanza.driver} onChange={(e) => set('balanza', { driver: e.target.value as any })}>
          <option value="ninguna">Sin balanza (peso manual o etiquetas)</option>
          <option value="generico">Genérica (lectura continua)</option>
          <option value="toledo">Toledo / Mettler (protocolo 8217)</option>
          <option value="cas">CAS</option>
          <option value="datalogic">Datalogic Magellan (escáner-balanza)</option>
          <option value="simulada">Simulada (pruebas)</option>
        </select>
      </Campo>
      {hw.balanza.driver !== 'ninguna' && hw.balanza.driver !== 'simulada' ? (
        <div className="grid grid-cols-2 gap-2">
          <Campo etiqueta="Puerto COM">
            <select className={inputCls} value={hw.balanza.puerto ?? ''} onChange={(e) => set('balanza', { puerto: e.target.value })}>
              <option value="">Seleccione…</option>
              {hw.balanza.driver === 'datalogic' && <option value="escaner">Mismo cable del escáner (USB-COM)</option>}
              {opcionesPuerto(hw.balanza.puerto === 'escaner' ? undefined : hw.balanza.puerto)}
            </select>
          </Campo>
          <Campo etiqueta="Baudios">
            <select className={inputCls} value={hw.balanza.baudios ?? 9600} onChange={(e) => set('balanza', { baudios: Number(e.target.value) })}>
              {[2400, 4800, 9600, 19200].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </Campo>
        </div>
      ) : (
        <div />
      )}

      <Campo etiqueta="Escáner de códigos">
        <select className={inputCls} value={hw.escaner.driver} onChange={(e) => set('escaner', { driver: e.target.value as any, puerto: hw.escaner.puerto ?? 'auto' })}>
          <option value="ninguno">Tipo teclado (USB/Bluetooth, no requiere configuración)</option>
          <option value="datalogic">Datalogic Magellan (USB COM / RS-232)</option>
          <option value="serie">Otro escáner por puerto serie</option>
        </select>
      </Campo>
      {hw.escaner.driver !== 'ninguno' ? (
        <Campo etiqueta="Puerto del escáner">
          <select className={inputCls} value={hw.escaner.puerto ?? 'auto'} onChange={(e) => set('escaner', { puerto: e.target.value })}>
            {hw.escaner.driver === 'datalogic' ? <option value="auto">Automático (detecta el Datalogic aunque cambie el COM)</option> : <option value="auto">Seleccione…</option>}
            {opcionesPuerto(hw.escaner.puerto)}
          </select>
        </Campo>
      ) : (
        <div />
      )}

      <label className="flex items-center gap-3 text-lg">
        <input type="checkbox" className="h-7 w-7" checked={hw.visorCliente} onChange={(e) => onChange({ ...hw, visorCliente: e.target.checked })} />
        Visor de cliente en segundo monitor
      </label>
    </fieldset>
  );
}
