import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  BarChart3, Bell, Boxes, ClipboardCheck, ClipboardList, Fish, LayoutDashboard, LogOut, Menu, Package,
  FileText, HandCoins, History, Receipt, TrendingDown, Search, Settings, ShieldCheck, ShoppingCart, Truck, Users, Wallet, Wrench, X,
} from 'lucide-react'
import clsx from 'clsx'
import { useAuth } from '../../context/AuthContext'
import { initials } from '../../lib/format'
import { ROLE_LABEL } from '../../lib/constants'
import { GlobalSearch } from '../GlobalSearch'
import { NotificationBell } from '../NotificationBell'
import { Logo } from '../ui'

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/pedidos', label: 'Pedidos', icon: ClipboardList },
  { to: '/ventas', label: 'Ventas', icon: Receipt },
  { to: '/inventario', label: 'Inventario', icon: Boxes },
  { to: '/productos', label: 'Productos', icon: Fish },
  { to: '/compras', label: 'Compras', icon: ShoppingCart },
  { to: '/gastos', label: 'Gastos', icon: TrendingDown },
  { to: '/proveedores', label: 'Proveedores', icon: Package },
  { to: '/clientes', label: 'Clientes', icon: Users },
  { to: '/entregas', label: 'Entregas', icon: Truck },
  { to: '/cobranza', label: 'Cobranza', icon: HandCoins },
  { to: '/finanzas', label: 'Finanzas', icon: Wallet },
  { to: '/reportes', label: 'Reportes', icon: BarChart3 },
  { to: '/historico', label: 'Histórico', icon: FileText },
  { to: '/trabajadores', label: 'Cuentas y accesos', icon: ShieldCheck },
  { to: '/levantamiento', label: 'Levantamiento', icon: ClipboardCheck },
  { to: '/auditoria', label: 'Auditoría', icon: History },
  { to: '/configuracion', label: 'Configuración', icon: Settings },
]

// Solo para quien mantiene el sistema. Va aparte y no dentro de NAV para que
// no haya forma de que se cuele en el menú de la empresa por descuido.
const NAV_SOPORTE = [{ to: '/soporte', label: 'Soporte', icon: Wrench }]

export function AdminLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  async function handleSignOut() {
    await signOut()
    navigate('/login')
  }

  const sidebar = (
    <div className="safe-top safe-bottom flex h-full flex-col bg-navy-900 text-navy-100">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <Logo className="h-10 w-10" ring />
        <div>
          <p className="text-sm font-semibold tracking-tight text-white">Pescadería Bilagay</p>
          <p className="text-[11px] text-navy-300">Pescado fresco</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                isActive
                  ? 'bg-navy-700 font-medium text-white'
                  : 'text-navy-200 hover:bg-navy-800 hover:text-white',
              )
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {label}
          </NavLink>
        ))}

        {profile?.role === 'soporte' && (
          <>
            <p className="mt-4 px-3 pb-1 text-[10px] font-semibold tracking-wider text-navy-400 uppercase">
              Solo soporte
            </p>
            {NAV_SOPORTE.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  clsx('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                    isActive
                      ? 'bg-navy-700 font-medium text-white'
                      : 'text-navy-200 hover:bg-navy-800 hover:text-white')}>
                <Icon className="h-[18px] w-[18px] shrink-0" />
                {label}
              </NavLink>
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-navy-800 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-700 text-xs font-semibold text-white">
            {initials(profile?.full_name || profile?.email || '?')}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-white">{profile?.full_name}</p>
            <p className="truncate text-[11px] text-navy-300">
              {profile ? ROLE_LABEL[profile.role] : ''}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            title="Cerrar sesión"
            className="rounded-lg p-2 text-navy-300 hover:bg-navy-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )

  // Con el menú abierto el fondo no debe moverse: en el teléfono el dedo
  // terminaba desplazando la página de atrás en vez del menú.
  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menuOpen])

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Sidebar escritorio */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 lg:block">{sidebar}</aside>

      {/* Sidebar móvil */}
      {menuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64">{sidebar}</aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="safe-top sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          >
            {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>

          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Buscar"
            className="flex flex-1 items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-400 hover:border-slate-300 sm:max-w-md"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">
              Buscar<span className="hidden sm:inline"> pedido, cliente, producto, lote</span>…
            </span>
          </button>

          <div className="ml-auto flex items-center gap-1">
            <NotificationBell />
            <button
              onClick={handleSignOut}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
              title="Salir"
            >
              <LogOut className="h-5 w-5" />
            </button>
            <span className="hidden items-center gap-2 rounded-lg px-2 py-1 text-sm lg:flex">
              <Bell className="hidden h-4 w-4" />
            </span>
          </div>
        </header>

        <main className="safe-bottom mx-auto max-w-[1600px] p-4 sm:p-6">
          <Outlet />
        </main>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
