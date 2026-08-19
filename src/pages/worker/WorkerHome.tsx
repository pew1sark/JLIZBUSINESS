import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, BarChart3, Boxes, ChevronRight, ClipboardList, Truck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useHojaRuta, usePedidosOperativos, useStockOperativo } from '../../lib/operativo'
import { ROLE_LABEL } from '../../lib/constants'
import { kg } from '../../lib/format'
import { Card, Skeleton } from '../../components/ui'

export function WorkerHome() {
  const { profile } = useAuth()
  const rol = profile?.role
  const esReparto = rol === 'reparto'

  const pedidos = usePedidosOperativos(['confirmado', 'en_preparacion', 'preparado'])
  const ruta = useHojaRuta(new Date().toISOString().slice(0, 10))
  const stock = useStockOperativo()

  const avisos = useQuery({
    queryKey: ['op-avisos'],
    queryFn: async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
      return count ?? 0
    },
  })

  const porPreparar = (pedidos.data ?? []).filter((p) => p.status === 'confirmado').length
  const enPreparacion = (pedidos.data ?? []).filter((p) => p.status === 'en_preparacion').length
  const listos = (pedidos.data ?? []).filter((p) => p.status === 'preparado').length
  const entregasPendientes = (ruta.data ?? []).filter(
    (p) => p.status !== 'entregada' && p.status !== 'fallida',
  )
  const bajos = (stock.data ?? []).filter((p) => p.bajo_minimo)

  const hoy = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
  const cargando = pedidos.isLoading || ruta.isLoading || stock.isLoading

  const accesos = [
    {
      ver: !esReparto,
      to: '/t/pedidos',
      icon: ClipboardList,
      titulo: 'Preparar pedidos',
      valor: porPreparar + enPreparacion,
      detalle: `${porPreparar} por preparar · ${enPreparacion} en curso · ${listos} listos`,
    },
    {
      ver: esReparto,
      to: '/t/ruta',
      icon: Truck,
      titulo: 'Mi hoja de ruta',
      valor: entregasPendientes.length,
      detalle: `${kg(entregasPendientes.reduce((n, p) => n + Number(p.total_kilos), 0))} por repartir`,
    },
    {
      ver: true,
      to: '/t/stock',
      icon: Boxes,
      titulo: 'Stock',
      valor: bajos.length,
      detalle: bajos.length ? `${bajos.length} producto(s) bajo el mínimo` : 'Todo sobre el mínimo',
    },
    {
      ver: true,
      to: '/t/reportes',
      icon: BarChart3,
      titulo: 'Reportes',
      valor: 0,
      detalle: 'Kilos recibidos, despachados y merma',
    },
  ].filter((a) => a.ver)

  return (
    <>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Mi jornada</h1>
        <p className="text-sm text-slate-500 first-letter:uppercase">{hoy}</p>
        <p className="mt-1 text-xs text-slate-400">{profile ? ROLE_LABEL[profile.role] : ''}</p>
      </div>

      {bajos.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="min-w-0 text-sm">
            <p className="font-medium text-amber-900">Stock bajo el mínimo</p>
            <p className="truncate text-xs text-amber-800">
              {bajos.slice(0, 3).map((p) => `${p.name} (${kg(p.available)})`).join(' · ')}
            </p>
          </div>
        </div>
      )}

      {cargando ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : (
        <div className="space-y-3">
          {accesos.map(({ to, icon: Icon, titulo, valor, detalle }) => (
            <Link key={to} to={to}>
              <Card className="flex items-center gap-4 p-4 active:bg-slate-50">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-white">
                  <Icon className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-slate-900">{titulo}</span>
                  <span className="block text-xs text-slate-500">{detalle}</span>
                </span>
                {valor > 0 && (
                  <span className="flex h-8 min-w-8 items-center justify-center rounded-full bg-sea-100 px-2 text-sm font-semibold text-sea-800">
                    {valor}
                  </span>
                )}
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
              </Card>
            </Link>
          ))}
        </div>
      )}

      {(avisos.data ?? 0) > 0 && (
        <Link to="/t/avisos" className="mt-3 block text-center text-sm font-medium text-navy-600">
          Tienes {avisos.data} aviso(s) sin leer
        </Link>
      )}
    </>
  )
}
