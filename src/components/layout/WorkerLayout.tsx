import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Bell, Boxes, ClipboardList, Home, LogOut, Truck, User } from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../../context/AuthContext'
import { ROLE_LABEL } from '../../lib/constants'
import { initials } from '../../lib/format'
import type { AppRole } from '../../lib/types'

/** Navegación de terreno: pocos destinos, botones grandes, pensada para el teléfono. */
const NAV: { to: string; label: string; icon: typeof Home; roles: AppRole[] }[] = [
  { to: '/t', label: 'Inicio', icon: Home, roles: ['ventas', 'compras', 'inventario', 'empaque', 'reparto'] },
  { to: '/t/tareas', label: 'Mis tareas', icon: ClipboardList, roles: ['ventas', 'compras', 'inventario', 'empaque', 'reparto'] },
  { to: '/t/preparacion', label: 'Preparar', icon: Boxes, roles: ['inventario', 'empaque'] },
  { to: '/t/entregas', label: 'Entregas', icon: Truck, roles: ['reparto'] },
  { to: '/t/notificaciones', label: 'Avisos', icon: Bell, roles: ['ventas', 'compras', 'inventario', 'empaque', 'reparto'] },
  { to: '/t/perfil', label: 'Perfil', icon: User, roles: ['ventas', 'compras', 'inventario', 'empaque', 'reparto'] },
]

export function WorkerLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const items = NAV.filter((n) => (profile ? n.roles.includes(profile.role) : false))

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      <header className="safe-top sticky top-0 z-30 flex items-center gap-3 border-b border-navy-800 bg-navy-900 px-4 py-3 text-white">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-sea-500 text-xs font-semibold">
          {initials(profile?.full_name || '?')}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{profile?.full_name}</p>
          <p className="text-[11px] text-navy-300">{profile ? ROLE_LABEL[profile.role] : ''}</p>
        </div>
        <button onClick={handleSignOut} className="rounded-lg p-2 text-navy-200 hover:bg-navy-800">
          <LogOut className="h-5 w-5" />
        </button>
      </header>

      <main className="flex-1 p-4 pb-24">
        <Outlet />
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-lg">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/t'}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
                  isActive ? 'text-navy-900' : 'text-slate-400',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
