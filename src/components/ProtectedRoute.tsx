import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { isAdminRole } from '../lib/permissions'

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <Loader2 className="h-6 w-6 animate-spin text-navy-500" />
    </div>
  )
}

/** Exige sesión activa. `area` decide qué interfaz corresponde al rol. */
export function ProtectedRoute({
  children, area,
}: { children: ReactNode; area: 'admin' | 'worker' }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullScreenLoader />
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />
  if (!profile) return <FullScreenLoader />

  if (area === 'admin' && !isAdminRole(profile.role)) return <Navigate to="/t" replace />
  if (area === 'worker' && isAdminRole(profile.role)) return <Navigate to="/" replace />

  return <>{children}</>
}
