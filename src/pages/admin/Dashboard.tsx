import { useQuery } from '@tanstack/react-query'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  AlertTriangle, Boxes, ClipboardList, Package, TrendingUp, Truck, Wallet,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { DashboardKpis, OrderStatus, ProductStock } from '../../lib/types'
import { dateShort, kg, money, moneyShort, relative } from '../../lib/format'
import { ORDER_STATUS_LABEL, ORDER_STATUS_STYLE } from '../../lib/constants'
import { Card, CardHeader, ErrorState, PageHeader, Skeleton, StatCard } from '../../components/ui'

interface SeriePunto { dia: string; ventas: number; compras: number; margen: number }

interface ActividadItem {
  id: string
  code: string
  status: OrderStatus
  total: number
  order_date: string
  customers: { name: string } | null
}

export function Dashboard() {
  const kpis = useQuery({
    queryKey: ['dashboard-kpis'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_kpis')
      if (error) throw error
      return data as DashboardKpis
    },
  })

  const serie = useQuery({
    queryKey: ['sales-series'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sales_series', { _days: 30 })
      if (error) throw error
      return (data as SeriePunto[]).map((d) => ({
        ...d,
        dia: dateShort(d.dia),
        ventas: Number(d.ventas),
        compras: Number(d.compras),
        margen: Number(d.margen),
      }))
    },
  })

  const stock = useQuery({
    queryKey: ['stock-resumen'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_product_stock')
        .select('*')
        .eq('status', 'activo')
        .order('available', { ascending: false })
      if (error) throw error
      return data as ProductStock[]
    },
  })

  const actividad = useQuery({
    queryKey: ['actividad-reciente'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, code, status, total, order_date, customers(name)')
        .order('order_date', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as unknown as ActividadItem[]
    },
  })

  const topProductos = useQuery({
    queryKey: ['top-productos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select('quantity_ordered, quantity_prepared, line_total, products(name)')
        .limit(500)
      if (error) throw error
      const acc = new Map<string, { name: string; kilos: number; monto: number }>()
      for (const it of data as unknown as {
        quantity_ordered: number; quantity_prepared: number | null; line_total: number
        products: { name: string } | null
      }[]) {
        const name = it.products?.name ?? 'Sin producto'
        const prev = acc.get(name) ?? { name, kilos: 0, monto: 0 }
        prev.kilos += Number(it.quantity_prepared ?? it.quantity_ordered)
        prev.monto += Number(it.line_total)
        acc.set(name, prev)
      }
      return [...acc.values()].sort((a, b) => b.monto - a.monto).slice(0, 7)
    },
  })

  const k = kpis.data
  const bajos = (stock.data ?? []).filter((p) => p.min_stock > 0 && p.available < p.min_stock)
  const margenPct = k && k.ventas_mes > 0 ? Math.round((k.margen_mes / k.ventas_mes) * 1000) / 10 : 0

  return (
    <>
      <PageHeader
        title="Panel de control"
        subtitle={`Estado del negocio · ${new Date().toLocaleDateString('es-CL', {
          weekday: 'long', day: 'numeric', month: 'long',
        })}`}
      />

      {kpis.isError && <ErrorState error={kpis.error} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.isLoading
          ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          : k && (
              <>
                <StatCard label="Ventas hoy" value={money(k.ventas_hoy)} hint={`Semana ${moneyShort(k.ventas_semana)}`} icon={<TrendingUp className="h-4 w-4" />} />
                <StatCard label="Pedidos activos" value={String(k.pedidos_pendientes)} hint={`${k.pedidos_en_reparto} en reparto`} icon={<ClipboardList className="h-4 w-4" />} />
                <StatCard label="Entregas hoy" value={String(k.pedidos_entregados_hoy)} hint="completadas" icon={<Truck className="h-4 w-4" />} />
                <StatCard label="Stock disponible" value={kg(k.stock_total)} hint={`Valorizado ${moneyShort(k.stock_valor)}`} icon={<Boxes className="h-4 w-4" />} />
                <StatCard label="Por cobrar" value={moneyShort(k.cuentas_por_cobrar)} hint={`${moneyShort(k.cuentas_vencidas)} vencido`} tone={k.cuentas_vencidas > 0 ? 'danger' : 'default'} icon={<Wallet className="h-4 w-4" />} />
                <StatCard label="Margen del mes" value={`${margenPct}%`} hint={money(k.margen_mes)} tone={margenPct >= 20 ? 'positive' : 'warning'} icon={<Package className="h-4 w-4" />} />
              </>
            )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Ventas vs. compras · últimos 30 días" />
          <div className="h-72 p-4">
            {serie.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={serie.data}>
                  <defs>
                    <linearGradient id="gVentas" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#1eafa7" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#1eafa7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => moneyShort(v as number)} width={55} />
                  <Tooltip formatter={(v) => money(v as number)} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="ventas" name="Ventas" stroke="#1eafa7" fill="url(#gVentas)" strokeWidth={2} />
                  <Line type="monotone" dataKey="compras" name="Compras" stroke="#0b2545" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Qué está pasando ahora" action={<Link to="/pedidos" className="text-xs font-medium text-navy-600 hover:underline">Ver pedidos</Link>} />
          <div className="divide-y divide-slate-50">
            {actividad.isLoading && <Skeleton className="m-4 h-40" />}
            {actividad.data?.map((a) => (
              <Link key={a.id} to={`/pedidos/${a.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{a.customers?.name ?? 'Cliente'}</p>
                  <p className="text-xs text-slate-400">
                    {a.code} · {relative(a.order_date)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums text-slate-700">{moneyShort(a.total)}</p>
                  <span className={`badge ${ORDER_STATUS_STYLE[a.status]} mt-0.5`}>
                    {ORDER_STATUS_LABEL[a.status]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Productos con mayor facturación" />
          <div className="h-72 p-4">
            {topProductos.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProductos.data} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => moneyShort(v as number)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={110} />
                  <Tooltip formatter={(v) => money(v as number)} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Bar dataKey="monto" name="Facturado" radius={[0, 4, 4, 0]}>
                    {(topProductos.data ?? []).map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#0b2545' : '#5b88bd'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Stock bajo mínimo"
            action={<span className="badge bg-amber-100 text-amber-800">{bajos.length}</span>}
          />
          <div className="divide-y divide-slate-50">
            {stock.isLoading && <Skeleton className="m-4 h-40" />}
            {!stock.isLoading && bajos.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">Todo el stock está sobre el mínimo</p>
            )}
            {bajos.slice(0, 8).map((p) => (
              <Link key={p.product_id} to={`/inventario/${p.product_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{p.name}</p>
                  <p className="text-xs text-slate-400">mínimo {kg(p.min_stock)}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-amber-600">{kg(p.available)}</p>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-3">
          <CardHeader title="Margen diario estimado" />
          <div className="h-56 p-4">
            {serie.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serie.data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => moneyShort(v as number)} width={55} />
                  <Tooltip formatter={(v) => money(v as number)} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Line type="monotone" dataKey="margen" name="Margen" stroke="#158c88" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}
