import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './context/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminLayout } from './components/layout/AdminLayout'
import { WorkerLayout } from './components/layout/WorkerLayout'
import { Login } from './pages/Login'
import { Dashboard } from './pages/admin/Dashboard'
import {
  Auditoria, Clientes, Compras, Configuracion, Entregas, Finanzas, Inventario,
  Pedidos, Productos, Proveedores, Reportes, Trabajadores, Ventas,
} from './pages/admin/Modules'
import { WorkerHome } from './pages/worker/WorkerHome'
import { Avisos, MisEntregas, MisTareas, Perfil, Preparacion } from './pages/worker/WorkerPages'

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
          <Routes>
            <Route path="/login" element={<Login />} />

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
              <Route path="/t/tareas" element={<MisTareas />} />
              <Route path="/t/preparacion" element={<Preparacion />} />
              <Route path="/t/entregas" element={<MisEntregas />} />
              <Route path="/t/notificaciones" element={<Avisos />} />
              <Route path="/t/perfil" element={<Perfil />} />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </HashRouter>
    </QueryClientProvider>
  )
}
