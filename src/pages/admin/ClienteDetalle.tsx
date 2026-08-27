import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft, Loader2, MapPin, MessageCircle, Navigation, Phone, Wallet,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Mapa } from '../../components/Mapa'
import { geocodificar, urlMapaNativo } from '../../lib/geo'
import type { ComportamientoPago, Customer, FacturaConPago, Order } from '../../lib/types'
import { nombreMes } from '../../lib/periodo'
import {
  CUSTOMER_TYPE_LABEL, ORDER_STATUS_LABEL, ORDER_STATUS_STYLE,
  PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE,
} from '../../lib/constants'
import { dateShort, dateTime, kg, money, moneyShort, relative } from '../../lib/format'
import { ContactosCliente } from '../../components/ContactosCliente'
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Pestanas, Skeleton, StatCard, TableWrap } from '../../components/ui'

type Pestana = 'pedidos' | 'productos' | 'facturas' | 'pagos'

export function ClienteDetalle() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [pestana, setPestana] = useState<Pestana>('pedidos')
  const [ubicando, setUbicando] = useState(false)
  const [avisoGeo, setAvisoGeo] = useState<string | null>(null)
  const [mesFactura, setMesFactura] = useState('')
  const [soloImpagas, setSoloImpagas] = useState(false)

  const cliente = useQuery({
    queryKey: ['cliente', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').eq('id', id).single()
      if (error) throw error
      return data as Customer
    },
  })

  const balance = useQuery({
    queryKey: ['cliente-balance', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_customer_balance').select('*').eq('customer_id', id).maybeSingle()
      if (error) throw error
      return data as {
        orders_count: number; total_invoiced: number; total_paid: number
        balance_due: number; overdue: number; last_order_at: string | null
      } | null
    },
  })

  // Todas las facturas del cliente, con la fecha en que se pagó cada una.
  const facturas = useQuery({
    queryKey: ['cliente-facturas', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_facturas_con_pago').select('*').eq('customer_id', id)
        .order('issued_at', { ascending: false })
        .order('doc_number', { ascending: false })
        .limit(2000)
      if (error) throw error
      return data as FacturaConPago[]
    },
  })

  const comportamiento = useQuery({
    queryKey: ['cliente-comportamiento', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_comportamiento_pago_cliente').select('*')
        .eq('customer_id', id).maybeSingle()
      if (error) throw error
      return data as ComportamientoPago | null
    },
  })

  const mesesFactura = useMemo(() => {
    const set = new Set((facturas.data ?? []).map((f) => f.mes_emision))
    return [...set].sort().reverse()
  }, [facturas.data])

  const facturasFiltradas = useMemo(() => (facturas.data ?? []).filter((f) => {
    if (mesFactura && f.mes_emision !== mesFactura) return false
    if (soloImpagas && f.payment_status === 'pagado') return false
    return true
  }), [facturas.data, mesFactura, soloImpagas])

  const pedidos = useQuery({
    queryKey: ['cliente-pedidos', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customers(id, name, customer_type, phone, address, comuna)')
        .eq('customer_id', id)
        .order('order_date', { ascending: false })
        .limit(60)
      if (error) throw error
      return data as Order[]
    },
  })

  const productos = useQuery({
    queryKey: ['cliente-productos', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('order_items')
        .select('quantity_ordered, quantity_prepared, line_total, unit_cost, products(name), orders!inner(customer_id, status)')
        .eq('orders.customer_id', id)
        .neq('orders.status', 'cancelado')
        .limit(1000)
      if (error) throw error
      const acc = new Map<string, { nombre: string; kilos: number; monto: number; costo: number }>()
      for (const it of data as unknown as {
        quantity_ordered: number; quantity_prepared: number | null; line_total: number
        unit_cost: number; products: { name: string } | null
      }[]) {
        const n = it.products?.name ?? 'Sin producto'
        const prev = acc.get(n) ?? { nombre: n, kilos: 0, monto: 0, costo: 0 }
        const q = Number(it.quantity_prepared ?? it.quantity_ordered)
        prev.kilos += q
        prev.monto += Number(it.line_total)
        prev.costo += q * Number(it.unit_cost)
        acc.set(n, prev)
      }
      return [...acc.values()].sort((a, b) => b.monto - a.monto)
    },
  })

  const pagos = useQuery({
    queryKey: ['cliente-pagos', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('code, amount, method, paid_at, reference, orders(code)')
        .eq('customer_id', id)
        .eq('direction', 'cobro')
        .order('paid_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data as unknown as {
        code: string; amount: number; method: keyof typeof PAYMENT_METHOD_LABEL
        paid_at: string; reference: string | null; orders: { code: string } | null
      }[]
    },
  })

  const guardarUbicacion = useMutation({
    mutationFn: async ({ lat, lng, fuente }: { lat: number; lng: number; fuente: string }) => {
      const { error } = await supabase.rpc('set_customer_location', {
        _customer_id: id, _lat: lat, _lng: lng, _source: fuente,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['cliente', id] }),
  })

  async function ubicar() {
    const c = cliente.data
    if (!c?.address) {
      setAvisoGeo('Este cliente no tiene dirección cargada.')
      return
    }
    setUbicando(true)
    setAvisoGeo(null)
    try {
      const r = await geocodificar(c.address, c.comuna)
      if (!r) {
        setAvisoGeo('No se encontró la dirección. Revisa que esté bien escrita o ubícala a mano.')
      } else {
        await guardarUbicacion.mutateAsync({ lat: r.lat, lng: r.lng, fuente: 'nominatim' })
        setAvisoGeo(`Ubicado en: ${r.etiqueta}`)
      }
    } catch (e) {
      setAvisoGeo(e instanceof Error ? e.message : 'Error al buscar la dirección')
    } finally {
      setUbicando(false)
    }
  }

  const c = cliente.data
  const b = balance.data

  const promedioMensual = useMemo(() => {
    if (!pedidos.data?.length || !b) return 0
    const fechas = pedidos.data.map((p) => new Date(p.order_date).getTime())
    const meses = Math.max(1, (Math.max(...fechas) - Math.min(...fechas)) / (30 * 86400000))
    return Number(b.total_invoiced) / meses
  }, [pedidos.data, b])

  const margen = useMemo(() => {
    const total = (productos.data ?? []).reduce((n, p) => n + p.monto, 0)
    const costo = (productos.data ?? []).reduce((n, p) => n + p.costo, 0)
    return total > 0 ? ((total - costo) / total) * 100 : 0
  }, [productos.data])

  if (cliente.isLoading) return <Skeleton className="h-96" />
  if (cliente.isError) return <ErrorState error={cliente.error} />
  if (!c) return <EmptyState title="Cliente no encontrado" />

  const coord = c.latitude != null && c.longitude != null ? { lat: Number(c.latitude), lng: Number(c.longitude) } : null
  const sobrepasado = c.credit_limit > 0 && Number(b?.balance_due ?? 0) > c.credit_limit

  return (
    <>
      <button onClick={() => navigate('/clientes')} className="mb-3 flex items-center gap-1 text-sm font-medium text-navy-600">
        <ChevronLeft className="h-4 w-4" /> Volver a clientes
      </button>

      <PageHeader
        title={c.name}
        subtitle={`${CUSTOMER_TYPE_LABEL[c.customer_type]} · ${c.comuna ?? 'sin comuna'} · ${c.code ?? ''}`}
        actions={
          <>
            {c.phone && (
              <a href={`tel:${c.phone}`} className="btn-secondary">
                <Phone className="h-4 w-4" /> Llamar
              </a>
            )}
            {c.whatsapp && (
              <a href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="btn-secondary">
                <MessageCircle className="h-4 w-4" /> WhatsApp
              </a>
            )}
            <a href={urlMapaNativo(coord, c.address, c.comuna)} target="_blank" rel="noreferrer" className="btn-secondary">
              <Navigation className="h-4 w-4" /> Cómo llegar
            </a>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <StatCard label="Comprado" value={moneyShort(b?.total_invoiced ?? 0)} hint={`${b?.orders_count ?? 0} pedidos`} />
        <StatCard label="Pagado" value={moneyShort(b?.total_paid ?? 0)} />
        <StatCard label="Saldo" value={moneyShort(b?.balance_due ?? 0)} tone={sobrepasado ? 'danger' : (b?.balance_due ?? 0) > 0 ? 'warning' : 'default'} />
        <StatCard label="Vencido" value={moneyShort(b?.overdue ?? 0)} tone={(b?.overdue ?? 0) > 0 ? 'danger' : 'default'} />
        <StatCard label="Promedio mensual" value={moneyShort(promedioMensual)} />
        <StatCard label="Margen" value={`${Math.round(margen * 10) / 10}%`} tone={margen >= 25 ? 'positive' : 'warning'} />
      </div>

      {sobrepasado && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Este cliente superó su límite de crédito de {money(c.credit_limit)}. Saldo actual: {money(b?.balance_due ?? 0)}.
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Ubicación"
            action={
              <button onClick={ubicar} disabled={ubicando} className="text-xs font-medium text-navy-600 hover:underline">
                {ubicando ? 'Buscando…' : coord ? 'Volver a ubicar' : 'Ubicar en el mapa'}
              </button>
            }
          />
          <div className="p-4">
            {coord ? (
              <Mapa
                alto={300}
                puntos={[{
                  id: c.id,
                  lat: coord.lat,
                  lng: coord.lng,
                  color: '#0b2545',
                  popup: (
                    <div className="text-sm">
                      <p className="font-semibold">{c.name}</p>
                      <p className="text-slate-500">{c.address}</p>
                    </div>
                  ),
                }]}
              />
            ) : (
              <EmptyState
                title="Sin ubicación en el mapa"
                hint="Aprieta «Ubicar en el mapa» y el sistema busca la dirección. Después el repartidor puede navegar directo."
                icon={<MapPin className="h-8 w-8" />}
              />
            )}
            {avisoGeo && <p className="mt-2 text-xs text-slate-500">{avisoGeo}</p>}
            {coord && (
              <p className="mt-2 text-xs text-slate-400">
                {c.address} · ubicado {relative(c.geocoded_at)}
              </p>
            )}
            {guardarUbicacion.isError && <ErrorState error={guardarUbicacion.error} />}
          </div>
        </Card>

        <Card>
          <CardHeader title="Ficha" />
          <div className="divide-y divide-slate-50">
            {([
              ['Empresa', c.company],
              ['RUT', c.rut],
              ['Teléfono', c.phone],
              ['Correo', c.email],
              ['Dirección', c.address],
              ['Comuna', c.comuna],
              ['Crédito', `${c.payment_terms_days} días`],
              ['Límite', money(c.credit_limit)],
              ['Última compra', relative(b?.last_order_at)],
            ] as [string, string | null][]).map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-3 px-4 py-2">
                <span className="text-xs text-slate-400">{k}</span>
                <span className="text-right text-sm text-slate-800">{v || '—'}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4">
        <ContactosCliente customerId={c.id} />
      </div>

      <div className="mt-4 mb-3">
        <Pestanas
          valor={pestana}
          onChange={setPestana}
          opciones={[
            { id: 'pedidos', label: 'Pedidos' },
            { id: 'productos', label: 'Qué compra' },
            { id: 'facturas', label: 'Facturas', badge: facturas.data?.length || '' },
            { id: 'pagos', label: 'Pagos' },
          ]}
        />
      </div>

      {pestana === 'pedidos' && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Pedido</th>
              <th className="th">Fecha</th>
              <th className="th">Estado</th>
              <th className="th">Total</th>
              <th className="th">Saldo</th>
              <th className="th">Pago</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pedidos.data?.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="td">
                  <Link to="/pedidos" className="font-mono text-xs text-navy-700 hover:underline">{o.code}</Link>
                </td>
                <td className="td text-slate-500">{dateShort(o.order_date)}</td>
                <td className="td"><span className={`badge ${ORDER_STATUS_STYLE[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span></td>
                <td className="td tabular-nums">{money(o.total)}</td>
                <td className="td tabular-nums">{money(Number(o.total) - Number(o.amount_paid))}</td>
                <td className="td"><span className={`badge ${PAYMENT_STATUS_STYLE[o.payment_status]}`}>{PAYMENT_STATUS_LABEL[o.payment_status]}</span></td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {pestana === 'productos' && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Producto</th>
              <th className="th">Kilos</th>
              <th className="th">Facturado</th>
              <th className="th">Margen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {productos.data?.map((p) => {
              const m = p.monto > 0 ? ((p.monto - p.costo) / p.monto) * 100 : 0
              return (
                <tr key={p.nombre} className="hover:bg-slate-50">
                  <td className="td font-medium text-slate-800">{p.nombre}</td>
                  <td className="td tabular-nums">{kg(p.kilos)}</td>
                  <td className="td tabular-nums">{money(p.monto)}</td>
                  <td className="td">
                    <span className={`badge ${m >= 25 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
                      {Math.round(m * 10) / 10}%
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {pestana === 'facturas' && (
        <>
          <ResumenComportamiento c={comportamiento.data ?? null} />

          <div className="mt-3 mb-3 flex flex-wrap items-center gap-3">
            <select className="input w-auto" value={mesFactura}
              onChange={(e) => setMesFactura(e.target.value)}>
              <option value="">Todos los meses</option>
              {mesesFactura.map((m) => <option key={m} value={m}>{nombreMes(m)}</option>)}
            </select>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={soloImpagas} className="rounded border-slate-300"
                onChange={(e) => setSoloImpagas(e.target.checked)} />
              Solo las que faltan por pagar
            </label>
            <span className="text-xs text-slate-500">
              {facturasFiltradas.length} factura(s) ·{' '}
              {money(facturasFiltradas.reduce((a, f) => a + Number(f.total), 0))}
            </span>
          </div>

          {facturas.isLoading && <Skeleton className="h-64" />}
          {!facturas.isLoading && facturasFiltradas.length === 0 && (
            <Card><EmptyState title="Sin facturas con este filtro" /></Card>
          )}

          {facturasFiltradas.length > 0 && (
            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Documento</th>
                  <th className="th">Emitida</th>
                  <th className="th">Vence</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Saldo</th>
                  <th className="th">Fecha de pago</th>
                  <th className="th text-right">Días</th>
                  <th className="th">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {facturasFiltradas.map((f) => (
                  <tr key={f.invoice_id} className="hover:bg-slate-50">
                    <td className="td font-medium text-navy-900">{f.doc_number}</td>
                    <td className="td text-slate-500">{dateShort(f.issued_at)}</td>
                    <td className="td text-slate-500">{dateShort(f.due_date)}</td>
                    <td className="td text-right tabular-nums">{money(f.total)}</td>
                    <td className={`td text-right tabular-nums ${
                      Number(f.saldo) > 0 ? 'font-medium text-amber-600' : 'text-slate-400'}`}>
                      {money(f.saldo)}
                    </td>
                    <td className="td">
                      {f.ultimo_pago
                        ? <span className="font-medium text-slate-700">{dateShort(f.ultimo_pago)}</span>
                        : <span className="text-slate-300">sin pago</span>}
                    </td>
                    <td className="td text-right tabular-nums">
                      {f.dias_en_pagar !== null
                        ? <span className={(f.dias_vs_plazo ?? 0) > 0 ? 'font-medium text-amber-600' : 'text-emerald-600'}>
                            {f.dias_en_pagar} d
                          </span>
                        : f.dias_esperando !== null
                          ? <span className={(f.dias_atraso ?? 0) > 0 ? 'text-red-600' : 'text-slate-400'}>
                              {f.dias_esperando} d
                            </span>
                          : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="td">
                      <span className={`badge ${PAYMENT_STATUS_STYLE[f.payment_status]}`}>
                        {PAYMENT_STATUS_LABEL[f.payment_status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </>
      )}

      {pestana === 'pagos' && (
        <>
          <ResumenComportamiento c={comportamiento.data ?? null} />
          <div className="mb-3" />
          {pagos.data?.length === 0 && <Card><EmptyState title="Sin pagos registrados" icon={<Wallet className="h-8 w-8" />} /></Card>}
          {!!pagos.data?.length && (
            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Fecha</th>
                  <th className="th">Pedido</th>
                  <th className="th">Monto</th>
                  <th className="th">Método</th>
                  <th className="th">Referencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagos.data.map((p) => (
                  <tr key={p.code} className="hover:bg-slate-50">
                    <td className="td text-slate-500">{dateTime(p.paid_at)}</td>
                    <td className="td font-mono text-xs">{p.orders?.code ?? '—'}</td>
                    <td className="td tabular-nums font-medium">{money(p.amount)}</td>
                    <td className="td text-slate-600">{PAYMENT_METHOD_LABEL[p.method]}</td>
                    <td className="td text-xs text-slate-400">{p.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </>
      )}

      {(pedidos.isLoading || productos.isLoading) && <Skeleton className="h-40" />}
      {guardarUbicacion.isPending && (
        <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3 w-3 animate-spin" /> Guardando ubicación…
        </p>
      )}
    </>
  )
}

/**
 * Cuánto se demora este cliente en pagar. El promedio solo no basta: importa
 * cuánto se desvía del plazo pactado y qué tan parejo es, porque un cliente
 * lento pero predecible se puede planificar y uno errático no.
 */
function ResumenComportamiento({ c }: { c: ComportamientoPago | null }) {
  if (!c || c.facturas_pagadas === 0) {
    return (
      <Card>
        <CardHeader title="Comportamiento de pago" />
        <p className="px-5 py-4 text-sm text-slate-500">
          Todavía no hay facturas pagadas de este cliente, así que no se puede
          calcular cuánto se demora.
        </p>
      </Card>
    )
  }

  const exceso = c.exceso_sobre_plazo
  const tendencia = c.dias_promedio_90d !== null && c.dias_promedio !== null
    ? c.dias_promedio_90d - c.dias_promedio : null

  return (
    <Card>
      <CardHeader title="Comportamiento de pago" />
      <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4 lg:grid-cols-6">
        <Metrica label="Días promedio" valor={`${c.dias_promedio} d`} destacado
          nota={`sobre ${c.facturas_pagadas} facturas pagadas`} />
        <Metrica label="Mediana"
          valor={c.dias_mediana === null ? '—' : `${Math.round(Number(c.dias_mediana))} d`}
          nota={c.dias_minimo === null ? undefined : `entre ${c.dias_minimo} y ${c.dias_maximo} d`} />
        <Metrica label="Plazo pactado" valor={`${c.plazo_pactado} d`}
          nota={exceso === null ? undefined
            : exceso > 0 ? `se demora ${exceso} d de más` : `paga ${-exceso} d antes`}
          tono={exceso === null ? undefined : exceso > 0 ? 'malo' : 'bueno'} />
        <Metrica label="Dentro del plazo"
          valor={c.pct_a_tiempo === null ? '—' : `${c.pct_a_tiempo}%`}
          nota={`${c.a_tiempo} a tiempo · ${c.fuera_de_plazo} tarde`}
          tono={c.pct_a_tiempo === null ? undefined
            : c.pct_a_tiempo >= 80 ? 'bueno' : c.pct_a_tiempo >= 50 ? undefined : 'malo'} />
        <Metrica label="Últimos 90 días"
          valor={c.dias_promedio_90d === null ? '—' : `${c.dias_promedio_90d} d`}
          nota={tendencia === null ? undefined
            : Math.abs(tendencia) < 3 ? 'sin cambios'
            : tendencia > 0 ? `${tendencia} d más lento` : `${-tendencia} d más rápido`}
          tono={tendencia === null || Math.abs(tendencia) < 3 ? undefined
            : tendencia > 0 ? 'malo' : 'bueno'} />
        <Metrica label="Pendiente"
          valor={c.facturas_abiertas === 0 ? '—' : moneyShort(c.saldo_abierto)}
          nota={c.facturas_abiertas === 0 ? 'está al día'
            : `${c.facturas_abiertas} doc. · ${c.espera_maxima} d la más vieja`}
          tono={c.facturas_abiertas === 0 ? 'bueno' : undefined} />
      </div>
    </Card>
  )
}

function Metrica({
  label, valor, nota, tono, destacado,
}: {
  label: string
  valor: string
  nota?: string
  tono?: 'bueno' | 'malo'
  destacado?: boolean
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`tabular-nums ${destacado ? 'text-xl font-semibold text-navy-900' : 'text-lg font-medium text-slate-800'}`}>
        {valor}
      </p>
      {nota && (
        <p className={`text-xs ${
          tono === 'bueno' ? 'text-emerald-600' : tono === 'malo' ? 'text-amber-600' : 'text-slate-400'}`}>
          {nota}
        </p>
      )}
    </div>
  )
}
