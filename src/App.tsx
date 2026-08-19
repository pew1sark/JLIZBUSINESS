import { Suspense, lazy } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminLayout } from './components/layout/AdminLayout'
import { WorkerLayout } from './components/layout/WorkerLayout'
import { Login } from './pages/Login'
const Dashboard = lazy(() => import('./pages/admin/Dashboard').then((m) => ({ default: m.Dashboard })))
import { Entregas } from './pages/admin/Modules'
const Reportes = lazy(() => import('./pages/admin/Reportes').then((m) => ({ default: m.Reportes })))
const Finanzas = lazy(() => import('./pages/admin/Finanzas').then((m) => ({ default: m.Finanzas })))
const Auditoria = lazy(() => import('./pages/admin/Auditoria').then((m) => ({ default: m.Auditoria })))
const Trabajadores = lazy(() => import('./pages/admin/Trabajadores').then((m) => ({ default: m.Trabajadores })))
const Configuracion = lazy(() => import('./pages/admin/Configuracion').then((m) => ({ default: m.Configuracion })))
const Pedidos = lazy(() => import('./pages/admin/Pedidos').then((m) => ({ default: m.Pedidos })))
const Clientes = lazy(() => import('./pages/admin/Clientes').then((m) => ({ default: m.Clientes })))
const Ventas = lazy(() => import('./pages/admin/Ventas').then((m) => ({ default: m.Ventas })))
const Productos = lazy(() => import('./pages/admin/Productos').then((m) => ({ default: m.Productos })))
const Inventario = lazy(() => import('./pages/admin/Inventario').then((m) => ({ default: m.Inventario })))
const Compras = lazy(() => import('./pages/admin/Compras').then((m) => ({ default: m.Compras })))
const Proveedores = lazy(() => import('./pages/admin/Proveedores').then((m) => ({ default: m.Proveedores })))
const Levantamiento = lazy(() => import('./pages/admin/Levantamiento').then((m) => ({ default: m.Levantamiento })))
import { Survey } from './pages/Survey'
const Catalogo = lazy(() => import('./pages/Catalogo').then((m) => ({ default: m.Catalogo })))
import { WorkerHome } from './pages/worker/WorkerHome'
import { Avisos, Perfil } from './pages/worker/WorkerPages'
const WorkerPedidos = lazy(() => import('./pages/worker/WorkerPedidos').then((m) => ({ default: m.WorkerPedidos })))
const WorkerRuta = lazy(() => import('./pages/worker/WorkerRuta').then((m) => ({ default: m.WorkerRuta })))
const WorkerStock = lazy(() => import('./pages/worker/WorkerStock').then((m) => ({ default: m.WorkerStock })))
const WorkerReportes = lazy(() => import('./pages/worker/WorkerReportes').then((m) => ({ default: m.WorkerReportes })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
})

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <AuthProvider>
          <Suspense fallback={<PantallaCargando />}>
          <Routes>
            <Route path="/login" element={<Login />} />

            {/* Formularios públicos: el cliente entra con un enlace, sin cuenta */}
            <Route path="/levantamiento/:token" element={<Survey />} />
            <Route path="/catalogo/:token" element={<Catalogo />} />

            {/* INTERFAZ A · Administración (escritorio) */}
            <Route
              element={
                <ProtectedRoute area="admin">
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/pedidos" element={<Pedidos />} />
              <Route path="/pedidos/:id" element={<Pedidos />} />
              <Route path="/ventas" element={<Ventas />} />
              <Route path="/inventario" element={<Inventario />} />
              <Route path="/inventario/:id" element={<Inventario />} />
              <Route path="/productos" element={<Productos />} />
              <Route path="/compras" element={<Compras />} />
              <Route path="/proveedores" element={<Proveedores />} />
              <Route path="/proveedores/:id" element={<Proveedores />} />
              <Route path="/clientes" element={<Clientes />} />
              <Route path="/clientes/:id" element={<Clientes />} />
              <Route path="/entregas" element={<Entregas />} />
              <Route path="/finanzas" element={<Finanzas />} />
              <Route path="/reportes" element={<Reportes />} />
              <Route path="/trabajadores" element={<Trabajadores />} />
              <Route path="/levantamiento" element={<Levantamiento />} />
              <Route path="/auditoria" element={<Auditoria />} />
              <Route path="/configuracion" element={<Configuracion />} />
            </Route>

            {/* INTERFAZ B · Terreno (móvil) */}
            <Route
              element={
                <ProtectedRoute area="worker">
                  <WorkerLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/t" element={<WorkerHome />} />
              <Route path="/t/pedidos" element={<WorkerPedidos />} />
              <Route path="/t/ruta" element={<WorkerRuta />} />
              <Route path="/t/stock" element={<WorkerStock />} />
              <Route path="/t/reportes" element={<WorkerReportes />} />
              <Route path="/t/avisos" element={<Avisos />} />
              <Route path="/t/perfil" element={<Perfil />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </HashRouter>
    </QueryClientProvider>
  )
}

function PantallaCargando() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <Loader2 className="h-6 w-6 animate-spin text-navy-500" />
    </div>
  )
}
