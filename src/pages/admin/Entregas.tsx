import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowUp, Check, MapPin, Package, Truck, UserRound,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { DeliveryStatus, Order, Profile } from '../../lib/types'
import { DELIVERY_STATUS_LABEL } from '../../lib/constants'
import { dateShort, kg, timeOnly } from '../../lib/format'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, StatCard } from '../../components/ui'

interface Entrega {
  id: string
  code: string
  order_id: string
  driver_id: string | null
  status: DeliveryStatus
  sequence: number | null
  scheduled_date: string | null
  started_at: string | null
  delivered_at: string | null
  received_by_name: string | null
  failure_reason: string | null
  orders: {
    code: string
    delivery_window: string | null
    customers: { name: string; address: string | null; comuna: string | null } | null
    order_items: { quantity_ordered: number; quantity_prepared: number | null }[]
  } | null
}

const ESTILO: Record<DeliveryStatus, string> = {
  pendiente: 'bg-slate-100 text-slate-600',
  asignada: 'bg-blue-100 text-blue-700',
  en_camino: 'bg-sea-100 text-sea-800',
  entregada: 'bg-emerald-100 text-emerald-700',
  fallida: 'bg-red-100 text-red-700',
}

export function Entregas() {
  const qc = useQueryClient()
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))

  const repartidores = useQuery({
    queryKey: ['drivers-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, avatar_url, role, is_active, created_at')
        .in('role', ['reparto', 'admin'])
        .eq('is_active', true)
        .order('full_name')
      if (error) throw error
      return data as Profile[]
    },
  })

  const entregas = useQuery({
    queryKey: ['entregas-dia', fecha],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deliveries')
        .select('*, orders(code, delivery_window, customers(name, address, comuna), order_items(quantity_ordered, quantity_prepared))')
        .eq('scheduled_date', fecha)
        .order('sequence', { nullsFirst: false })
      if (error) throw error
      return data as unknown as Entrega[]
    },
  })

  const preparados = useQuery({
    queryKey: ['pedidos-preparados', fecha],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customers(id, name, customer_type, phone, address, comuna)')
        .eq('status', 'preparado')
        .order('delivery_date')
      if (error) throw error
      return data as Order[]
    },
  })

  const despachar = useMutation({
    mutationFn: async ({ orderId, driverId }: { orderId: string; driverId: string }) => {
      const { error } = await supabase.rpc('dispatch_order', {
        _order_id: orderId,
        _driver_id: driverId,
      })
      if (error) throw error
    },
    onSuccess: refrescar,
  })

  const actualizar = useMutation({
    mutationFn: async ({ id, cambios }: { id: string; cambios: Record<string, unknown> }) => {
      const { error } = await supabase.from('deliveries').update(cambios).eq('id', id)
      if (error) throw error
    },
    onSuccess: refrescar,
  })

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['entregas-dia'] })
    qc.invalidateQueries({ queryKey: ['pedidos-preparados'] })
    qc.invalidateQueries({ queryKey: ['orders-board'] })
  }

  const porRepartidor = useMemo(() => {
    const map = new Map<string, Entrega[]>()
    for (const e of entregas.data ?? []) {
      const k = e.driver_id ?? 'sin_asignar'
      map.set(k, [...(map.get(k) ?? []), e])
    }
    for (const [, lista] of map) {
      lista.sort((a, b) => (a.sequence ?? 999) - (b.sequence ?? 999))
    }
    return map
  }, [entregas.data])

  const kilos = (e: Entrega) =>
    (e.orders?.order_items ?? []).reduce(
      (n, i) => n + Number(i.quantity_prepared ?? i.quantity_ordered), 0,
    )

  const total = entregas.data ?? []
  const entregadas = total.filter((e) => e.status === 'entregada').length
  const enCamino = total.filter((e) => e.status === 'en_camino').length
  const fallidas = total.filter((e) => e.status === 'fallida').length

  function mover(lista: Entrega[], idx: number, dir: -1 | 1) {
    const otro = idx + dir
    if (otro < 0 || otro >= lista.length) return
    const a = lista[idx]
    const b = lista[otro]
    actualizar.mutate({ id: a.id, cambios: { sequence: otro + 1 } })
    actualizar.mutate({ id: b.id, cambios: { sequence: idx + 1 } })
  }

  return (
    <>
      <PageHeader
        title="Entregas"
        subtitle="Reparto del día: asignación de repartidor y orden de las paradas"
        actions={
          <input type="date" className="input w-auto" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Entregas del día" value={String(total.length)} icon={<Truck className="h-4 w-4" />} />
        <StatCard label="En camino" value={String(enCamino)} tone={enCamino ? 'warning' : 'default'} />
        <StatCard label="Entregadas" value={String(entregadas)} tone="positive" />
        <StatCard label="Fallidas" value={String(fallidas)} tone={fallidas ? 'danger' : 'default'} />
        <StatCard label="Kilos a repartir" value={kg(total.reduce((n, e) => n + kilos(e), 0))} />
      </div>

      {entregas.isError && <ErrorState error={entregas.error} />}
      {despachar.isError && <div className="mt-3"><ErrorState error={despachar.error} /></div>}

      {!!preparados.data?.length && (
        <Card className="mt-4">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3.5">
            <Package className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-800">
              Preparados esperando despacho ({preparados.data.length})
            </h2>
          </div>
          <div className="divide-y divide-slate-50">
            {preparados.data.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{o.customers?.name}</p>
                  <p className="text-xs text-slate-500">
                    {o.code} · entrega {dateShort(o.delivery_date)} {o.delivery_window ?? ''}
                    {o.customers?.comuna && ` · ${o.customers.comuna}`}
                  </p>
                </div>
                <select
                  className="input w-auto text-sm"
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) despachar.mutate({ orderId: o.id, driverId: e.target.value })
                  }}
                >
                  <option value="">Asignar repartidor…</option>
                  {repartidores.data?.map((r) => (
                    <option key={r.id} value={r.id}>{r.full_name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </Card>
      )}

      {entregas.isLoading && <Skeleton className="mt-4 h-64" />}
      {!entregas.isLoading && total.length === 0 && (
        <Card className="mt-4">
          <EmptyState
            title="Sin entregas programadas para este día"
            hint="Al despachar un pedido preparado se crea su entrega y aparece acá."
            icon={<Truck className="h-8 w-8" />}
          />
        </Card>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {[...porRepartidor.entries()].map(([driverId, lista]) => {
          const repartidor = repartidores.data?.find((r) => r.id === driverId)
          const kilosRuta = lista.reduce((n, e) => n + kilos(e), 0)
          const listas = lista.filter((e) => e.status === 'entregada').length
          return (
            <Card key={driverId} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-100 text-navy-800">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {repartidor?.full_name ?? 'Sin repartidor asignado'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {lista.length} paradas · {kg(kilosRuta)} · {listas} entregadas
                    </p>
                  </div>
                </div>
              </div>

              <div className="divide-y divide-slate-50">
                {lista.map((e, i) => (
                  <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="flex flex-col items-center gap-0.5">
                      <button
                        onClick={() => mover(lista, i, -1)}
                        disabled={i === 0}
                        className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-navy-700 disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-[11px] font-semibold text-white">
                        {e.sequence ?? i + 1}
                      </span>
                      <button
                        onClick={() => mover(lista, i, 1)}
                        disabled={i === lista.length - 1}
                        className="rounded p-0.5 text-slate-300 hover:bg-slate-100 hover:text-navy-700 disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{e.orders?.customers?.name}</p>
                      <p className="text-xs text-slate-500">
                        {e.orders?.customers?.address} · {e.orders?.customers?.comuna}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {e.orders?.code} · {kg(kilos(e))}
                        {e.orders?.delivery_window && ` · ${e.orders.delivery_window}`}
                      </p>
                      {e.status === 'entregada' && (
                        <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
                          <Check className="h-3 w-3" />
                          {timeOnly(e.delivered_at)} · recibió {e.received_by_name ?? 'sin registrar'}
                        </p>
                      )}
                      {e.status === 'fallida' && (
                        <p className="mt-1 text-xs text-red-600">{e.failure_reason}</p>
                      )}
                    </div>

                    <div className="flex flex-col items-end gap-1">
                      <span className={`badge ${ESTILO[e.status]}`}>{DELIVERY_STATUS_LABEL[e.status]}</span>
                      {e.orders?.customers?.address && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                            `${e.orders.customers.address}, ${e.orders.customers.comuna ?? ''}, Chile`,
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-slate-400 hover:text-navy-700"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {lista.some((e) => e.driver_id === null) && (
                <div className="border-t border-slate-100 p-3">
                  <select
                    className="input text-sm"
                    defaultValue=""
                    onChange={(e) => {
                      if (!e.target.value) return
                      for (const ent of lista.filter((x) => !x.driver_id)) {
                        actualizar.mutate({ id: ent.id, cambios: { driver_id: e.target.value, status: 'asignada' } })
                      }
                    }}
                  >
                    <option value="">Asignar estas paradas a…</option>
                    {repartidores.data?.map((r) => (
                      <option key={r.id} value={r.id}>{r.full_name}</option>
                    ))}
                  </select>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <Card className="mt-4 p-4 text-xs text-slate-500">
        El orden que definas acá es el que ve el repartidor en su hoja de ruta. El negocio hace una
        ruta diaria con zonas fijas, así que basta con ordenar las paradas por cercanía: las flechas
        suben o bajan cada parada.
      </Card>
    </>
  )
}
