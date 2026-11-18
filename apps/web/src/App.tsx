import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { configurado, leerConfig } from './lib/config';
import { useSesion } from './store/sesion';
import { Toasts } from './components/ui';
import { AutorizacionModal } from './components/Autorizacion';
import Configuracion from './pages/Configuracion';
import LoginCaja from './pages/LoginCaja';
import LoginAdmin from './pages/LoginAdmin';
import VisorCliente from './pages/VisorCliente';
import Venta from './pos/Venta';
import AdminLayout from './admin/AdminLayout';
import Productos from './admin/Productos';
import { Roles, Sucursales, Usuarios } from './admin/Seguridad';
import { Inventario, Promociones, Turnos } from './admin/Operacion';
import { Auditoria, Backups, Monitoreo, Reportes } from './admin/Supervision';
import Sistema from './admin/Sistema';
import AltaRapida from './admin/AltaRapida';
import RecibirMercancia from './admin/RecibirMercancia';
import ErroresCaja from './admin/ErroresCaja';
import { useEffect } from 'react';
import { useParametros } from './store/parametros';
import { iniciarHardwareRemoto } from './lib/hardwareRemoto';

function Inicio() {
  const usuario = useSesion((s) => s.usuario);
  if (!configurado()) return <Navigate to="/config" replace />;
  const cfg = leerConfig();
  if (!usuario) return <Navigate to={cfg.cajaId ? '/login' : '/admin-login'} replace />;
  return <Navigate to={cfg.cajaId && usuario.permisos.includes('venta.crear') ? '/venta' : '/admin'} replace />;
}

function RequiereSesion({ children }: { children: JSX.Element }) {
  const usuario = useSesion((s) => s.usuario);
  return usuario ? children : <Navigate to="/" replace />;
}

export default function App() {
  // Moneda, colores y logo del sistema (con copia local para arrancar sin servidor)
  useEffect(() => {
    // Si el servidor aún está arrancando, reintentar hasta obtenerlos
    let t: number | undefined;
    const cargarParametros = () =>
      useParametros
        .getState()
        .cargar()
        .catch(() => {
          t = window.setTimeout(cargarParametros, 5_000);
        });
    if (configurado()) cargarParametros();
    // Impresora, balanza y escáner configurados desde Administración → Sucursales y cajas
    if (configurado()) iniciarHardwareRemoto();
    return () => window.clearTimeout(t);
  }, []);
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Inicio />} />
        <Route path="/config" element={<Configuracion />} />
        <Route path="/login" element={<LoginCaja />} />
        <Route path="/admin-login" element={<LoginAdmin />} />
        <Route path="/visor" element={<VisorCliente />} />
        <Route
          path="/venta"
          element={
            <RequiereSesion>
              <Venta />
            </RequiereSesion>
          }
        />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="reportes" replace />} />
          <Route path="reportes" element={<Reportes />} />
          <Route path="productos" element={<Productos />} />
          <Route path="promociones" element={<Promociones />} />
          <Route path="inventario" element={<Inventario />} />
          <Route path="recibir" element={<RecibirMercancia />} />
          <Route path="turnos" element={<Turnos />} />
          <Route path="usuarios" element={<Usuarios />} />
          <Route path="roles" element={<Roles />} />
          <Route path="sucursales" element={<Sucursales />} />
          <Route path="monitoreo" element={<Monitoreo />} />
          <Route path="backups" element={<Backups />} />
          <Route path="auditoria" element={<Auditoria />} />
          <Route path="sistema" element={<Sistema />} />
          <Route path="alta-rapida" element={<AltaRapida />} />
          <Route path="errores" element={<ErroresCaja />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <AutorizacionModal />
      <Toasts />
    </HashRouter>
  );
}
