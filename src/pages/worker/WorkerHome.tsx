import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Bell, Boxes, ChevronRight, ClipboardList, Package, Truck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { ROLE_LABEL } from '../../lib/constants'
import { Card, Skeleton } from '../../components/ui'

export function WorkerHome() {
  const { profile } = useAuth()

  const resumen = useQuery({
    queryKey: ['worker-resumen', profile?.id, profile?.role],
    enabled: !!profile,
    refetchInterval: 60_000,
    queryFn: async () => {
      const [porPreparar, enPreparacion, misEntregas, avisos] = await Promise.all([
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'confirmado'),
        supabase.from('orders').select('id', { count: 'exact', head: true }).eq('status', 'en_preparacion'),
        supabase
          .from('deliveries')
          .select('id', { count: 'exact', head: true })
          .eq('driver_id', profile!.id)
          .in('status', ['asignada', 'en_camino']),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null),
      ])
      return {
        porPreparar: porPreparar.count ?? 0,
        enPreparacion: enPreparacion.count ?? 0,
        misEntregas: misEntregas.count ?? 0,
        avisos: avisos.count ?? 0,
      }
    },
  })

  const hoy = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
  const role = profile?.role

  const accesos = [
    {
      show: role === 'empaque' || role === 'inventario',
      to: '/t/preparacion',
      icon: Boxes,
      title: 'Preparar pedidos',
      value: resumen.data?.porPreparar ?? 0,
      hint: 'pedidos confirmados esperando preparación',
    },
    {
      show: role === 'reparto',
      to: '/t/entregas',
      icon: Truck,
      title: 'Mis entregas de hoy',
      value: resumen.data?.misEntregas ?? 0,
      hint: 'asignadas o en camino',
    },
    {
      show: role === 'compras',
      to: '/t/tareas',
      icon: Package,
      title: 'Registrar compra',
      value: 0,
      hint: 'nueva recepción de mercadería',
    },
    {
      show: true,
      to: '/t/tareas',
      icon: ClipboardList,
      title: 'Mis tareas',
      value: 0,
      hint: 'pendientes asignadas a ti',
    },
    {
      show: true,
      to: '/t/notificaciones',
      icon: Bell,
      title: 'Avisos',
      value: resumen.data?.avisos ?? 0,
      hint: 'sin leer',
    },
  ].filter((a) => a.show)

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Mi jornada</h1>
        <p className="text-sm text-slate-500 first-letter:uppercase">{hoy}</p>
        <p className="mt-1 text-xs text-slate-400">{profile ? ROLE_LABEL[profile.role] : ''}</p>
      </div>

      {resumen.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {accesos.map(({ to, icon: Icon, title, value, hint }) => (
            <Link key={title} to={to}>
              <Card className="flex items-center gap-4 p-4 active:bg-slate-50">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-white">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-slate-900">{title}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </span>
                {value > 0 && (
                  <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-sea-100 px-2 text-sm font-semibold text-sea-800">
                    {value}
                  </span>
                )}
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
