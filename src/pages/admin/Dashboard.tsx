import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  AlertTriangle, Boxes, ClipboardList, MapPin, Package, Receipt, TrendingUp, Wallet,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { Mapa, type PuntoMapa } from '../../components/Mapa'
import { CUSTOMER_TYPE_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE } from '../../lib/constants'
import type { CustomerType, DashboardKpis, PaymentStatus, ProductStock } from '../../lib/types'
import { dateShort, kg, money, moneyShort, relative } from '../../lib/format'
import { Card, CardHeader, ErrorState, PageHeader, Skeleton, StatCard } from '../../components/ui'

interface SeriePunto { dia: string; ventas: number; compras: number; margen: number }

interface ClienteMapa {
  id: string
  name: string
  customer_type: CustomerType
  address: string | null
  comuna: string | null
  latitude: number | null
  longitude: number | null
  status: string
  orders_count: number
  total_invoiced: number
  balance_due: number
  overdue: number
  last_order_at: string | null
}

interface ActividadItem {
  id: string
  doc_type: string
  doc_number: string
  total: number
  issued_at: string
  due_date: string | null
  amount_paid: number
  payment_status: PaymentStatus
  customers: { name: string } | null
}

/** El estado del negocio en ocho números. */
export function ResumenKpis({ k }: { k: DashboardKpis }) {
  // Sin costo cargado no hay margen que mostrar: se marca como no calculable.
  const sinCosto = Number(k.cobertura_costo_pct) === 0
  const margenPct = Number(k.venta_costeada) > 0
    ? Math.round((k.margen_mes / Number(k.venta_costeada)) * 1000) / 10
    : 0

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
        <StatCard label="Ventas hoy" value={money(k.ventas_hoy)}
          hint={`Semana ${moneyShort(k.ventas_semana)}`} icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label="Facturado del mes" value={moneyShort(k.ventas_mes)}
          hint={`${k.documentos_mes} documento${k.documentos_mes === 1 ? '' : 's'}`}
          icon={<Receipt className="h-4 w-4" />} />
        <StatCard label="Por cobrar" value={moneyShort(k.cuentas_por_cobrar)}
          hint={`${k.documentos_por_cobrar} doc. · ${k.clientes_con_deuda} clientes`}
          icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Vencido" value={moneyShort(k.cuentas_vencidas)}
          hint={k.vencido_grave > 0 ? `${moneyShort(k.vencido_grave)} con +30 días` : 'nada sobre 30 días'}
          tone={k.cuentas_vencidas > 0 ? 'danger' : 'positive'}
          icon={<AlertTriangle className="h-4 w-4" />} />

        <StatCard label="Stock disponible" value={kg(k.stock_total)}
          hint={`Valorizado ${moneyShort(k.stock_valor)}`} icon={<Boxes className="h-4 w-4" />} />
        <StatCard label="Compras del mes" value={moneyShort(k.compras_mes)}
          hint="recibidas" icon={<Package className="h-4 w-4" />} />
        <StatCard label="Margen del mes"
          value={sinCosto ? '—' : `${margenPct}%`}
          hint={sinCosto ? 'falta cargar el costo' : money(k.margen_mes)}
          tone={sinCosto ? 'default' : margenPct >= 20 ? 'positive' : 'warning'}
          icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label="Pedidos en curso" value={String(k.pedidos_pendientes)}
          hint={`${k.pedidos_en_reparto} en reparto · ${k.pedidos_entregados_hoy} entregados hoy`}
          icon={<ClipboardList className="h-4 w-4" />} />
      </div>

      {sinCosto && k.ventas_mes > 0 && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          El margen del mes no se puede calcular: las ventas facturadas todavía no tienen el
          costo cargado. Entra al registrar las compras del período en Compras.
        </p>
      )}
    </>
  )
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
        .from('invoices')
        .select('id, doc_type, doc_number, total, issued_at, due_date, amount_paid, payment_status, customers(name)')
        .order('issued_at', { ascending: false })
        .order('doc_number', { ascending: false })
        .limit(8)
      if (error) throw error
      return data as unknown as ActividadItem[]
    },
  })

  const clientesMapa = useQuery({
    queryKey: ['clientes-mapa'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_clientes_mapa')
        .select('*')
        .eq('status', 'activo')
      if (error) throw error
      return data as ClienteMapa[]
    },
  })

  const empresa = useQuery({
    queryKey: ['settings', 'empresa'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings').select('value').eq('key', 'empresa').maybeSingle()
      if (error) throw error
      return (data?.value ?? {}) as Record<string, string | number>
    },
  })

  const topProductos = useQuery({
    queryKey: ['top-productos'],
    queryFn: async () => {
      // Se leen las líneas de los documentos emitidos en los últimos 60 días.
      const desde = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('invoice_items')
        .select('description, quantity, net_total, invoices!inner(issued_at)')
        .gte('invoices.issued_at', desde)
        .limit(3000)
      if (error) throw error
      const acc = new Map<string, { name: string; kilos: number; monto: number }>()
      for (const it of data as unknown as {
        description: string; quantity: number; net_total: number
      }[]) {
        const name = it.description || 'Sin producto'
        const prev = acc.get(name) ?? { name, kilos: 0, monto: 0 }
        prev.kilos += Number(it.quantity)
        prev.monto += Number(it.net_total)
        acc.set(name, prev)
      }
      return [...acc.values()].sort((a, b) => b.monto - a.monto).slice(0, 7)
    },
  })

  const ubicados = useMemo(
    () => (clientesMapa.data ?? []).filter((c) => c.latitude != null && c.longitude != null),
    [clientesMapa.data],
  )

  const puntosClientes = useMemo<PuntoMapa[]>(
    () =>
      ubicados.map((c) => ({
        id: c.id,
        lat: Number(c.latitude),
        lng: Number(c.longitude),
        color: Number(c.overdue) > 0 ? '#dc2626' : Number(c.balance_due) > 0 ? '#f59e0b' : '#10b981',
        popup: (
          <div className="min-w-44 text-sm">
            <p className="font-semibold text-slate-900">{c.name}</p>
            <p className="text-xs text-slate-500">{c.address}</p>
            <p className="mt-1 text-xs text-slate-600">
              {c.orders_count} pedidos · {moneyShort(c.total_invoiced)}
            </p>
            {Number(c.balance_due) > 0 && (
              <p className="text-xs font-medium text-amber-600">
                {moneyShort(c.balance_due)} por cobrar
              </p>
            )}
            <a href={`#/clientes/${c.id}`} className="mt-1 block text-xs font-medium text-navy-700 underline">
              Ver ficha completa
            </a>
          </div>
        ),
      })),
    [ubicados],
  )

  const porTipo = useMemo(() => {
    const acc = new Map<string, { n: number; monto: number; deuda: number }>()
    for (const c of clientesMapa.data ?? []) {
      const prev = acc.get(c.customer_type) ?? { n: 0, monto: 0, deuda: 0 }
      prev.n += 1
      prev.monto += Number(c.total_invoiced ?? 0)
      prev.deuda += Number(c.balance_due ?? 0)
      acc.set(c.customer_type, prev)
    }
    return [...acc.entries()].sort((a, b) => b[1].monto - a[1].monto)
  }, [clientesMapa.data])

  const k = kpis.data
  const bajos = (stock.data ?? []).filter((p) => p.min_stock > 0 && p.available < p.min_stock)

  return (
    <>
      <PageHeader
        title="Panel de control"
        subtitle={`Estado del negocio · ${new Date().toLocaleDateString('es-CL', {
          weekday: 'long', day: 'numeric', month: 'long',
        })}`}
      />

      {kpis.isError && <ErrorState error={kpis.error} />}

      {kpis.isLoading
        ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        : k && <ResumenKpis k={k} />}

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
          <CardHeader title="Últimos documentos emitidos" action={<Link to="/ventas" className="text-xs font-medium text-navy-600 hover:underline">Ver ventas</Link>} />
          <div className="divide-y divide-slate-50">
            {actividad.isLoading && <Skeleton className="m-4 h-40" />}
            {actividad.data?.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Todavía no hay documentos emitidos
              </p>
            )}
            {actividad.data?.map((a) => (
              <Link key={a.id} to="/ventas" className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{a.customers?.name ?? 'Cliente'}</p>
                  <p className="text-xs text-slate-400">
                    {a.doc_type === 'nota_credito' ? 'NC' : 'Factura'} {a.doc_number} · {relative(a.issued_at)}
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-medium tabular-nums ${
                    a.doc_type === 'nota_credito' ? 'text-emerald-600' : 'text-slate-700'}`}>
                    {moneyShort(a.total)}
                  </p>
                  <span className={`badge ${PAYMENT_STATUS_STYLE[a.payment_status]} mt-0.5`}>
                    {PAYMENT_STATUS_LABEL[a.payment_status]}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Dónde están los clientes"
            action={
              <Link to="/clientes" className="text-xs font-medium text-navy-600 hover:underline">
                Ver cartera
              </Link>
            }
          />
          <div className="p-4">
            {clientesMapa.isLoading ? (
              <Skeleton className="h-[380px] w-full" />
            ) : ubicados.length === 0 ? (
              <div className="flex h-[380px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 text-center">
                <MapPin className="mb-2 h-8 w-8 text-slate-300" />
                <p className="text-sm font-medium text-slate-600">Ningún cliente tiene ubicación todavía</p>
                <p className="mt-1 max-w-xs text-xs text-slate-400">
                  En Clientes, el botón «Ubicar en el mapa» busca la dirección de cada uno y guarda su
                  posición. Después el repartidor navega directo desde su hoja de ruta.
                </p>
                <Link to="/clientes" className="btn-secondary mt-3">Ir a clientes</Link>
              </div>
            ) : (
              <>
                <Mapa
                  puntos={puntosClientes}
                  alto={380}
                  origen={
                    empresa.data?.bodega_lat
                      ? {
                          lat: Number(empresa.data.bodega_lat),
                          lng: Number(empresa.data.bodega_lng),
                          etiqueta: String(empresa.data.nombre ?? 'Bodega'),
                        }
                      : undefined
                  }
                />
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span><strong className="text-slate-800">{ubicados.length}</strong> de {(clientesMapa.data ?? []).length} clientes ubicados</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> al día</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> con saldo</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> vencido</span>
                  <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sea-500" /> bodega</span>
                </div>
              </>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Cartera por tipo" />
          <div className="divide-y divide-slate-50">
            {porTipo.map(([tipo, datos]) => (
              <div key={tipo} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {CUSTOMER_TYPE_LABEL[tipo as CustomerType] ?? tipo}
                  </p>
                  <p className="text-xs text-slate-400">{datos.n} cliente(s)</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums text-slate-700">{moneyShort(datos.monto)}</p>
                  {datos.deuda > 0 && (
                    <p className="text-xs text-amber-600">{moneyShort(datos.deuda)} por cobrar</p>
                  )}
                </div>
              </div>
            ))}
            {porTipo.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">Sin clientes activos</p>
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Productos con mayor facturación" action={<span className="text-xs text-slate-400">últimos 60 días</span>} />
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
