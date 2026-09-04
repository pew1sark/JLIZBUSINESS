import { useEffect, useMemo, useState } from 'react'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import {
  AlertTriangle, Boxes, ClipboardList, MapPin, Package, Receipt, RefreshCw, TrendingUp, Wallet,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import { Mapa, type PuntoMapa } from '../../components/Mapa'
import { CUSTOMER_TYPE_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE } from '../../lib/constants'
import type { CustomerType, DashboardKpis, PaymentStatus, ProductStock } from '../../lib/types'
import { dateShort, kg, money, moneyShort, pct, relative, relativeDia } from '../../lib/format'
import { Card, CardHeader, ErrorState, PageHeader, Skeleton, StatCard } from '../../components/ui'
import { ComportamientoPagos } from '../../components/ComportamientoPagos'
import { TableroKilos } from '../../components/TableroKilos'
import { FiltroPeriodo } from '../../components/Filtros'
import { rangoDe, type Periodo } from '../../lib/periodo'

/**
 * Cada cuánto se vuelve a preguntar. El panel es una pantalla que queda abierta
 * en el mostrador: si no se refresca sola, muestra lo de hace horas sin avisar.
 * Los números salen de qué tan rápido cambia cada cosa, no de un valor único:
 * una factura entra en cualquier momento, el mapa de clientes casi nunca.
 *
 * Con la pestaña en segundo plano el reloj se detiene solo (React Query no
 * consulta en background), y al volver el refresco por foco pone todo al día.
 *
 * De acá sale que todos los gráficos vayan con `isAnimationActive={false}`:
 * Recharts anima la barra creciendo y la línea dibujándose, y si el refresco
 * llega mientras esa animación corre, la deja congelada donde iba —barras de
 * dos píxeles, líneas convertidas en puntos sueltos— y el gráfico se ve vacío
 * o roto hasta la siguiente consulta. En un panel que se refresca solo cada
 * uno o dos minutos, eso pasa seguido.
 */
const REFRESCO = {
  /** Facturas y cobros: es lo que se mira de reojo durante el día. */
  vivo: 60_000,
  /** Series y rankings: se mueven con las mismas facturas, pero pesan más. */
  agregados: 120_000,
  /** Stock: cambia con recepciones y despachos, no minuto a minuto. */
  stock: 120_000,
  /** Fichas de clientes: cambian cuando alguien las edita. */
  lento: 300_000,
} as const

interface SeriePunto {
  dia: string
  ventas: number
  compras: number
  margen: number
  documentos: number
  venta_costeada: number
}

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
  // El dashboard es una pantalla de vistazo: un margen calculado sobre una
  // fracción de la venta se lee como el margen del negocio y engaña. Bajo
  // 80% de cobertura se muestra sin número; el detalle está en Finanzas.
  const cobertura = Number(k.cobertura_costo_pct)
  const margenFiable = cobertura >= 80
  const margenPct = Number(k.venta_costeada) > 0
    ? Math.round((k.margen_mes / Number(k.venta_costeada)) * 1000) / 10
    : 0

  return (
    <>
      {/* Cada tarjeta lleva a la pantalla donde ese número se desarma. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
        <StatCard label="Ventas hoy" value={money(k.ventas_hoy)} to="/ventas"
          hint={`Semana ${moneyShort(k.ventas_semana)}`} icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label="Facturado del mes" value={moneyShort(k.ventas_mes)} to="/ventas"
          hint={`${k.documentos_mes} documento${k.documentos_mes === 1 ? '' : 's'}`}
          icon={<Receipt className="h-4 w-4" />} />
        <StatCard label="Por cobrar" value={moneyShort(k.cuentas_por_cobrar)} to="/cobranza"
          hint={`${k.documentos_por_cobrar} doc. · ${k.clientes_con_deuda} clientes`}
          icon={<Wallet className="h-4 w-4" />} />
        <StatCard label="Vencido" value={moneyShort(k.cuentas_vencidas)} to="/cobranza"
          hint={k.vencido_grave > 0 ? `${moneyShort(k.vencido_grave)} con +30 días` : 'nada sobre 30 días'}
          tone={k.cuentas_vencidas > 0 ? 'danger' : 'positive'}
          icon={<AlertTriangle className="h-4 w-4" />} />

        <StatCard label="Stock disponible" value={kg(k.stock_total)} to="/inventario"
          hint={`Valorizado ${moneyShort(k.stock_valor)}`} icon={<Boxes className="h-4 w-4" />} />
        <StatCard label="Compras del mes" value={moneyShort(k.compras_mes)} to="/compras"
          hint="neto recibido, sin IVA" icon={<Package className="h-4 w-4" />} />
        <StatCard label="Margen del mes" to="/finanzas"
          value={margenFiable ? `${margenPct}%` : '—'}
          hint={margenFiable ? money(k.margen_mes)
                : cobertura === 0 ? 'falta cargar el costo'
                : `solo ${pct(cobertura)} tiene costo`}
          tone={margenFiable ? (margenPct >= 20 ? 'positive' : 'warning') : 'default'}
          icon={<TrendingUp className="h-4 w-4" />} />
        <StatCard label="Pedidos en curso" value={String(k.pedidos_pendientes)} to="/pedidos"
          hint={`${k.pedidos_en_reparto} en reparto · ${k.pedidos_entregados_hoy} entregados hoy`}
          icon={<ClipboardList className="h-4 w-4" />} />
      </div>

      {!margenFiable && k.ventas_mes > 0 && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {cobertura === 0
            ? 'El margen del mes no se puede calcular: las ventas facturadas todavía no tienen el costo cargado.'
            : `El margen del mes no es representativo: solo ${pct(cobertura)} de la venta tiene costo cargado (${moneyShort(k.venta_costeada)} de ${moneyShort(k.ventas_mes)}).`}
          {' '}El costo entra al registrar las compras del período en Compras.
        </p>
      )}
    </>
  )
}

export function Dashboard() {
  // El panel arranca en los últimos 30 días, que es la ventana con la que se
  // mira el día a día, pero se puede llevar a cualquier mes o a un cliente.
  const [periodo, setPeriodo] = useState<Periodo>(() => rangoDe('ultimos30'))
  const [cliente, setCliente] = useState('')

  const kpis = useQuery({
    queryKey: ['dashboard-kpis'],
    refetchInterval: REFRESCO.vivo,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('dashboard_kpis')
      if (error) throw error
      return data as DashboardKpis
    },
  })

  const serie = useQuery({
    queryKey: ['panel-serie', periodo.desde, periodo.hasta, cliente],
    refetchInterval: REFRESCO.agregados,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('panel_series', {
        _desde: periodo.desde, _hasta: periodo.hasta, _customer_id: cliente || null,
      })
      if (error) throw error
      return (data as SeriePunto[]).map((d) => ({
        ...d,
        fecha: d.dia,
        dia: dateShort(d.dia),
        ventas: Number(d.ventas),
        compras: Number(d.compras),
        margen: Number(d.margen),
        documentos: Number(d.documentos),
        venta_costeada: Number(d.venta_costeada),
      }))
    },
  })

  /**
   * Lo que el gráfico no dice solo: cuánto suma, cuánto es un día normal y
   * qué día se salió de la norma. Mirar una curva sin estos cuatro números
   * obliga a estimar a ojo.
   */
  const resumenSerie = useMemo(() => {
    const s = serie.data ?? []
    if (!s.length) return null
    const conVenta = s.filter((d) => d.ventas > 0)
    const ventas = s.reduce((a, d) => a + d.ventas, 0)
    const compras = s.reduce((a, d) => a + d.compras, 0)
    const docs = s.reduce((a, d) => a + d.documentos, 0)
    const mejor = s.reduce((a, d) => (d.ventas > a.ventas ? d : a), s[0])
    const peor = conVenta.length
      ? conVenta.reduce((a, d) => (d.ventas < a.ventas ? d : a), conVenta[0]) : null
    const costeada = s.reduce((a, d) => a + d.venta_costeada, 0)
    const margen = s.reduce((a, d) => a + d.margen, 0)
    return {
      ventas, compras, docs,
      promedio: conVenta.length ? ventas / conVenta.length : 0,
      diasConVenta: conVenta.length,
      dias: s.length,
      mejor, peor,
      margenPct: costeada > 0 ? Math.round((margen / costeada) * 1000) / 10 : null,
      ticket: docs > 0 ? ventas / docs : 0,
    }
  }, [serie.data])

  const clientesRanking = useQuery({
    queryKey: ['panel-clientes', periodo.desde, periodo.hasta],
    refetchInterval: REFRESCO.agregados,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('panel_clientes', {
        _desde: periodo.desde, _hasta: periodo.hasta, _limite: 8,
      })
      if (error) throw error
      return data as { customer_id: string; cliente: string; venta: number
        documentos: number; saldo: number; ultima_compra: string }[]
    },
  })

  const stock = useQuery({
    queryKey: ['stock-resumen'],
    refetchInterval: REFRESCO.stock,
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
    refetchInterval: REFRESCO.vivo,
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
    refetchInterval: REFRESCO.lento,
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
    queryKey: ['panel-productos', periodo.desde, periodo.hasta, cliente],
    refetchInterval: REFRESCO.agregados,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('panel_productos', {
        _desde: periodo.desde, _hasta: periodo.hasta,
        _customer_id: cliente || null, _limite: 8,
      })
      if (error) throw error
      return (data as { producto: string; kilos: number; venta: number
        documentos: number; clientes: number }[])
        .map((p) => ({ name: p.producto, kilos: Number(p.kilos), monto: Number(p.venta),
          documentos: p.documentos, clientes: p.clientes }))
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
        actions={<EstadoActualizacion />}
      />

      {kpis.isError && <ErrorState error={kpis.error} />}

      {kpis.isLoading
        ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        : k && <ResumenKpis k={k} />}

      {/* Filtros del panel: acotan el gráfico, el resumen y los productos. */}
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
        <span className="text-xs font-medium tracking-wide text-slate-500 uppercase">Analizar</span>
        <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
        <select className="input w-auto" value={cliente} onChange={(e) => setCliente(e.target.value)}>
          <option value="">Todos los clientes</option>
          {(clientesMapa.data ?? [])
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
            .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {(cliente || periodo.preset !== 'ultimos30') && (
          <button className="text-xs text-slate-500 hover:underline"
            onClick={() => { setCliente(''); setPeriodo(rangoDe('ultimos30')) }}>
            Limpiar
          </button>
        )}
        {cliente && (
          <Link to={`/clientes/${cliente}`} className="text-xs font-medium text-sea-600 hover:underline">
            Ver la ficha del cliente
          </Link>
        )}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title={cliente
              ? `Ventas de ${(clientesMapa.data ?? []).find((c) => c.id === cliente)?.name ?? 'el cliente'}`
              : 'Ventas vs. compras'}
            action={<span className="text-xs text-slate-400">
              {periodo.desde ? `${dateShort(periodo.desde)} a ${dateShort(periodo.hasta)}` : 'todo'}
            </span>}
          />

          {resumenSerie && (
            <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-4">
              <ResumenDato label="Venta del período" valor={money(resumenSerie.ventas)}
                nota={`${resumenSerie.docs} documentos`} />
              <ResumenDato label="Promedio por día" valor={money(resumenSerie.promedio)}
                nota={`${resumenSerie.diasConVenta} de ${resumenSerie.dias} días con venta`} />
              <ResumenDato label="Mejor día" valor={money(resumenSerie.mejor.ventas)}
                nota={resumenSerie.mejor.dia} />
              {cliente
                ? <ResumenDato label="Ticket promedio" valor={money(resumenSerie.ticket)}
                    nota="por documento emitido" />
                : <ResumenDato label="Compras del período" valor={money(resumenSerie.compras)}
                    nota={resumenSerie.ventas > 0
                      ? `${Math.round((resumenSerie.compras / resumenSerie.ventas) * 100)}% de la venta`
                      : '—'} />}
            </div>
          )}

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
                  <Area type="monotone" dataKey="ventas" name="Ventas" stroke="#1eafa7" fill="url(#gVentas)" strokeWidth={2} isAnimationActive={false} />
                  <Line type="monotone" dataKey="compras" name="Compras" stroke="#0b2545" strokeWidth={2} dot={false} isAnimationActive={false} />
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
                    {a.doc_type === 'nota_credito' ? 'NC' : 'Factura'} {a.doc_number} · {relativeDia(a.issued_at)}
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
          <CardHeader
            title="Clientes del período"
            action={<Link to="/cobranza" className="text-xs font-medium text-navy-600 hover:underline">
              Ver cobranza
            </Link>}
          />
          <div className="divide-y divide-slate-50">
            {clientesRanking.isLoading && <Skeleton className="m-4 h-40" />}
            {!clientesRanking.isLoading && (clientesRanking.data ?? []).length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">
                Sin ventas en el período elegido
              </p>
            )}
            {(clientesRanking.data ?? []).map((c, i) => (
              <button key={c.customer_id}
                onClick={() => setCliente(c.customer_id)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50">
                <span className="w-4 shrink-0 text-xs font-medium tabular-nums text-slate-300">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{c.cliente}</p>
                  <p className="text-xs text-slate-400">
                    {c.documentos} doc. · última {dateShort(c.ultima_compra)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums text-slate-700">{moneyShort(c.venta)}</p>
                  {Number(c.saldo) > 0 && (
                    <p className="text-xs text-amber-600">{moneyShort(c.saldo)} por cobrar</p>
                  )}
                </div>
              </button>
            ))}
          </div>
          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
            Toca un cliente para filtrar todo el panel por él.
          </p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {/* Qué se movió en kilos, que es otra pregunta que el ranking en pesos:
            el filete sube por precio, no por volumen. */}
        <TableroKilos periodo={periodo} cliente={cliente} />

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
          <CardHeader
            title="Productos con mayor facturación"
            action={<Link to="/reportes" className="text-xs font-medium text-navy-600 hover:underline">
              Informe por producto
            </Link>}
          />
          <div className="h-72 p-4">
            {topProductos.isLoading ? (
              <Skeleton className="h-full w-full" />
            ) : (topProductos.data ?? []).length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">
                Sin ventas con detalle de productos en este filtro
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topProductos.data} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => moneyShort(v as number)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} tickLine={false} axisLine={false} width={110} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    formatter={(v, _n, p) => [
                      `${money(v as number)} · ${kg(p.payload.kilos)} · ${p.payload.clientes} cliente(s)`,
                      'Facturado',
                    ]} />
                  <Bar dataKey="monto" name="Facturado" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                    {(topProductos.data ?? []).map((_, i) => (
                      <Cell key={i} fill={i === 0 ? '#0b2545' : '#5b88bd'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
          {!!topProductos.data?.length && (
            <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{topProductos.data[0].name}</span> encabeza con{' '}
              {money(topProductos.data[0].monto)} ({kg(topProductos.data[0].kilos)}) en{' '}
              {topProductos.data[0].clientes} cliente(s). Los {topProductos.data.length} productos del
              gráfico suman {money(topProductos.data.reduce((a, p) => a + p.monto, 0))}.
            </p>
          )}
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

      {/* Cómo se cobra y cómo se paga: el ciclo de caja, con su propio filtro
          de período y granularidad porque se lee en meses, no en días. */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <ComportamientoPagos />
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
                  <Line type="monotone" dataKey="margen" name="Margen" stroke="#158c88" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}

/** Un número del resumen que va sobre el gráfico. */
function ResumenDato({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-navy-900">{valor}</p>
      {nota && <p className="text-xs text-slate-400">{nota}</p>}
    </div>
  )
}

/**
 * Cuándo se actualizó el panel por última vez, y un botón para forzarlo.
 *
 * El panel se refresca solo, pero eso no se ve: sin este indicador uno no sabe
 * si está mirando lo de ahora o lo de hace una hora, y termina recargando la
 * página entera por las dudas. La hora sale de la consulta que más se mueve.
 */
function EstadoActualizacion() {
  const qc = useQueryClient()
  // Se engancha a la consulta que ya montó el panel, sin lanzar otra: por eso
  // va sin queryFn y deshabilitada. Depende de vivir dentro del panel; suelto,
  // no tendría de dónde leer la hora.
  const kpis = useQuery({ queryKey: ['dashboard-kpis'], enabled: false })
  const [, tick] = useState(0)

  // El texto es "hace 2 min": sin un reloj propio se quedaría congelado en
  // "hace instantes" hasta que llegue el siguiente dato.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const cuando = kpis.dataUpdatedAt
  // Los dos hooks se llaman siempre: dentro de un `||` el segundo quedaría
  // condicionado al primero y React exige el mismo orden en cada render.
  const bajandoKpis = useIsFetching({ queryKey: ['dashboard-kpis'] })
  const bajandoDocs = useIsFetching({ queryKey: ['actividad-reciente'] })
  const refrescando = bajandoKpis + bajandoDocs > 0

  return (
    <button
      onClick={() => qc.invalidateQueries()}
      title="Volver a consultar ahora"
      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-500 hover:border-slate-300 hover:text-slate-700"
    >
      <RefreshCw className={clsx('h-3.5 w-3.5', refrescando && 'animate-spin text-sea-600')} />
      {refrescando ? 'Actualizando…' : cuando ? `Actualizado ${relative(new Date(cuando).toISOString())}` : 'Actualizar'}
    </button>
  )
}
