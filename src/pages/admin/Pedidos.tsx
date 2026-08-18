import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Clock, Loader2, Package, Plus, Scale, Trash2, Truck, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOperacion, useProducts } from '../../lib/queries'
import type { Customer, Order, OrderItem, OrderStatus, Profile } from '../../lib/types'
import {
  ORDER_FLOW, ORDER_STATUS_LABEL, ORDER_STATUS_STYLE, PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE,
} from '../../lib/constants'
import { dateShort, dateTime, kg, money, moneyShort, timeOnly } from '../../lib/format'
import { ErrorState, Modal, PageHeader, Skeleton } from '../../components/ui'

const COLUMNAS: OrderStatus[] = ORDER_FLOW

export function Pedidos() {
  const qc = useQueryClient()
  const [verId, setVerId] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState(false)

  const pedidos = useQuery({
    queryKey: ['orders-board'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('*, customers(id, name, customer_type, phone, address, comuna)')
        .order('delivery_date', { ascending: true })
        .limit(300)
      if (error) throw error
      return data as Order[]
    },
  })

  const porEstado = useMemo(() => {
    const map: Record<string, Order[]> = {}
    for (const c of [...COLUMNAS, 'cancelado' as OrderStatus]) map[c] = []
    for (const o of pedidos.data ?? []) map[o.status]?.push(o)
    return map
  }, [pedidos.data])

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['orders-board'] })
    qc.invalidateQueries({ queryKey: ['order-detail'] })
    qc.invalidateQueries({ queryKey: ['stock'] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis'] })
  }

  return (
    <>
      <PageHeader
        title="Pedidos"
        subtitle="Tablero por estado · el pedido avanza con los botones de cada tarjeta"
        actions={
          <button onClick={() => setNuevo(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Nuevo pedido
          </button>
        }
      />

      {pedidos.isError && <ErrorState error={pedidos.error} />}
      {pedidos.isLoading && <Skeleton className="h-72" />}

      {!!pedidos.data && (
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
          <div className="flex min-w-max gap-3">
            {COLUMNAS.map((estado) => (
              <div key={estado} className="w-72 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className={`badge ${ORDER_STATUS_STYLE[estado]}`}>
                    {ORDER_STATUS_LABEL[estado]}
                  </span>
                  <span className="text-xs font-medium text-slate-400">
                    {porEstado[estado].length}
                  </span>
                </div>
                <div className="space-y-2">
                  {porEstado[estado].length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-xs text-slate-300">
                      Sin pedidos
                    </div>
                  )}
                  {porEstado[estado].map((o) => (
                    <button
                      key={o.id}
                      onClick={() => setVerId(o.id)}
                      className="card w-full p-3 text-left transition-shadow hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-900">{o.customers?.name}</p>
                        <span className="font-mono text-[10px] text-slate-400">{o.code.slice(-6)}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {o.delivery_date ? dateShort(o.delivery_date) : 'sin fecha'}
                        {o.delivery_window && ` · ${o.delivery_window}`}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-sm font-medium tabular-nums text-slate-700">
                          {moneyShort(o.total)}
                        </span>
                        <span className={`badge ${PAYMENT_STATUS_STYLE[o.payment_status]}`}>
                          {PAYMENT_STATUS_LABEL[o.payment_status]}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {porEstado.cancelado?.length > 0 && (
        <p className="mt-2 text-xs text-slate-400">
          {porEstado.cancelado.length} pedido(s) cancelado(s) — se conservan para la auditoría.
        </p>
      )}

      <DetallePedido id={verId} onClose={() => setVerId(null)} onCambio={refrescar} />
      <NuevoPedido open={nuevo} onClose={() => setNuevo(false)} onCreado={refrescar} />
    </>
  )
}

function DetallePedido({
  id, onClose, onCambio,
}: { id: string | null; onClose: () => void; onCambio: () => void }) {
  const [pesos, setPesos] = useState<Record<string, { neto: string; bruto: string; hielo: string }>>({})
  const [motivo, setMotivo] = useState('')
  const [cancelando, setCancelando] = useState(false)
  const [conductor, setConductor] = useState('')
  const [alertas, setAlertas] = useState<{ producto: string; pedido: number; preparado: number; diferencia_pct: number }[]>([])
  const operacion = useOperacion()

  const pedido = useQuery({
    queryKey: ['order-detail', id],
    enabled: !!id,
    queryFn: async () => {
      const [o, items, historia] = await Promise.all([
        supabase.from('orders').select('*, customers(id, name, customer_type, phone, address, comuna)').eq('id', id).single(),
        supabase.from('order_items').select('*, products(id, name, sku, base_unit)').eq('order_id', id),
        supabase.from('order_status_history').select('*').eq('order_id', id).order('created_at'),
      ])
      if (o.error) throw o.error
      return {
        orden: o.data as Order,
        items: (items.data ?? []) as OrderItem[],
        historia: (historia.data ?? []) as { id: number; to_status: OrderStatus; created_at: string; note: string | null }[],
      }
    },
  })

  const repartidores = useQuery({
    queryKey: ['drivers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .in('role', ['reparto', 'admin'])
        .eq('is_active', true)
      if (error) throw error
      return data as Profile[]
    },
  })

  const accion = useMutation({
    mutationFn: async (tipo: 'confirmar' | 'preparar' | 'finalizar' | 'despachar' | 'cancelar') => {
      if (tipo === 'confirmar') {
        const { data, error } = await supabase.rpc('confirm_order', { _order_id: id })
        if (error) throw error
        return data
      }
      if (tipo === 'preparar') {
        const { error } = await supabase.rpc('start_preparation', { _order_id: id })
        if (error) throw error
        return null
      }
      if (tipo === 'finalizar') {
        const items = (pedido.data?.items ?? [])
          .map((it) => {
            const p = pesos[it.id]
            const neto = Number(p?.neto ?? it.quantity_prepared ?? it.quantity_ordered)
            return {
              item_id: it.id,
              quantity_prepared: neto,
              gross_weight: p?.bruto ? Number(p.bruto) : null,
              ice_weight: p?.hielo ? Number(p.hielo) : 0,
            }
          })
        const { data, error } = await supabase.rpc('finish_preparation', { _order_id: id, _items: items })
        if (error) throw error
        return data
      }
      if (tipo === 'despachar') {
        const { error } = await supabase.rpc('dispatch_order', {
          _order_id: id,
          _driver_id: conductor || null,
        })
        if (error) throw error
        return null
      }
      const { error } = await supabase.rpc('cancel_order', { _order_id: id, _reason: motivo })
      if (error) throw error
      return null
    },
    onSuccess: (data) => {
      const res = data as { alertas?: typeof alertas } | null
      setAlertas(res?.alertas ?? [])
      setCancelando(false)
      setMotivo('')
      onCambio()
      pedido.refetch()
    },
  })

  if (!id) return null
  const o = pedido.data?.orden
  const items = pedido.data?.items ?? []
  const tolerancia = Number(operacion.data?.tolerancia_peso_pct ?? 5)

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {pedido.isLoading && <Skeleton className="m-5 h-40" />}

        {o && (
          <>
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-slate-900">{o.customers?.name}</h3>
                  <span className={`badge ${ORDER_STATUS_STYLE[o.status]}`}>
                    {ORDER_STATUS_LABEL[o.status]}
                  </span>
                </div>
                <p className="font-mono text-xs text-slate-400">{o.code}</p>
              </div>
              <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Dato k="Entrega" v={dateShort(o.delivery_date)} />
                <Dato k="Horario" v={o.delivery_window ?? '—'} />
                <Dato k="Pago" v={PAYMENT_METHOD_LABEL[o.payment_method]} />
                <Dato k="Dirección" v={o.customers?.comuna ?? '—'} />
              </div>

              {alertas.length > 0 && (
                <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p className="font-medium text-amber-900">
                    Diferencia de peso sobre el {tolerancia}% acordado
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
                    {alertas.map((a, i) => (
                      <li key={i}>
                        {a.producto}: pedido {a.pedido} kg → preparado {a.preparado} kg ({a.diferencia_pct}%)
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-amber-700">Hay que avisar al cliente antes de despachar.</p>
                </div>
              )}

              <h4 className="mb-2 text-xs font-semibold tracking-wide text-navy-700 uppercase">
                Productos
              </h4>
              <div className="space-y-1.5">
                {items.map((it) => (
                  <div key={it.id} className="rounded-lg border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{it.products?.name}</p>
                        <p className="text-xs text-slate-500">
                          pedido {kg(it.quantity_ordered, it.unit)} × {money(it.unit_price)}
                          {it.quantity_prepared != null && (
                            <> · preparado <strong>{kg(it.quantity_prepared, it.unit)}</strong></>
                          )}
                        </p>
                      </div>
                      <p className="text-sm font-medium tabular-nums">{money(it.line_total)}</p>
                    </div>

                    {o.status === 'en_preparacion' && (
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div>
                          <label className="label mb-0.5">Peso bruto</label>
                          <input
                            className="input py-1 text-sm"
                            type="number"
                            step="0.001"
                            value={pesos[it.id]?.bruto ?? ''}
                            onChange={(e) =>
                              setPesos((p) => ({
                                ...p,
                                [it.id]: { ...(p[it.id] ?? { neto: '', bruto: '', hielo: '' }), bruto: e.target.value },
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="label mb-0.5">Hielo</label>
                          <input
                            className="input py-1 text-sm"
                            type="number"
                            step="0.001"
                            value={pesos[it.id]?.hielo ?? ''}
                            onChange={(e) =>
                              setPesos((p) => ({
                                ...p,
                                [it.id]: { ...(p[it.id] ?? { neto: '', bruto: '', hielo: '' }), hielo: e.target.value },
                              }))
                            }
                          />
                        </div>
                        <div>
                          <label className="label mb-0.5">Neto a cobrar</label>
                          <input
                            className="input py-1 text-sm"
                            type="number"
                            step="0.001"
                            placeholder={String(it.quantity_ordered)}
                            value={
                              pesos[it.id]?.neto ??
                              (pesos[it.id]?.bruto
                                ? String(
                                    Math.round(
                                      (Number(pesos[it.id].bruto) - Number(pesos[it.id].hielo || 0)) * 1000,
                                    ) / 1000,
                                  )
                                : '')
                            }
                            onChange={(e) =>
                              setPesos((p) => ({
                                ...p,
                                [it.id]: { ...(p[it.id] ?? { neto: '', bruto: '', hielo: '' }), neto: e.target.value },
                              }))
                            }
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>Neto</span><span className="tabular-nums">{money(o.subtotal)}</span>
                </div>
                {o.freight > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Despacho</span><span className="tabular-nums">{money(o.freight)}</span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-slate-900">
                  <span>Total</span><span className="tabular-nums">{money(o.total)}</span>
                </div>
                <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-xs text-slate-500">
                  <span>+ IVA {String(operacion.data?.iva ?? 19)}%</span>
                  <span className="tabular-nums">
                    {money(o.total * (1 + Number(operacion.data?.iva ?? 19) / 100))}
                  </span>
                </div>
              </div>

              <h4 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-navy-700 uppercase">
                Línea de tiempo
              </h4>
              <div className="space-y-2">
                {pedido.data?.historia.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 text-sm">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-100 text-navy-700">
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="flex-1 text-slate-700">{ORDER_STATUS_LABEL[h.to_status]}</span>
                    <span className="text-xs text-slate-400">{dateTime(h.created_at)}</span>
                  </div>
                ))}
              </div>

              {accion.isError && <div className="mt-4"><ErrorState error={accion.error} /></div>}

              {cancelando && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                  <label className="label">Motivo de la cancelación</label>
                  <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => setCancelando(false)} className="btn-secondary px-3 py-1.5 text-xs">
                      Volver
                    </button>
                    <button
                      onClick={() => accion.mutate('cancelar')}
                      disabled={!motivo.trim() || accion.isPending}
                      className="btn-danger px-3 py-1.5 text-xs"
                    >
                      Confirmar cancelación
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-5 py-3">
              {o.status === 'nuevo' && (
                <button onClick={() => accion.mutate('confirmar')} disabled={accion.isPending} className="btn-primary">
                  {accion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Confirmar y reservar stock
                </button>
              )}
              {o.status === 'confirmado' && (
                <button onClick={() => accion.mutate('preparar')} disabled={accion.isPending} className="btn-primary">
                  <Package className="h-4 w-4" /> Comenzar preparación
                </button>
              )}
              {o.status === 'en_preparacion' && (
                <button onClick={() => accion.mutate('finalizar')} disabled={accion.isPending} className="btn-accent">
                  <Scale className="h-4 w-4" /> Registrar pesos y marcar preparado
                </button>
              )}
              {o.status === 'preparado' && (
                <>
                  <select className="input w-auto" value={conductor} onChange={(e) => setConductor(e.target.value)}>
                    <option value="">Repartidor…</option>
                    {repartidores.data?.map((r) => (
                      <option key={r.id} value={r.id}>{r.full_name}</option>
                    ))}
                  </select>
                  <button onClick={() => accion.mutate('despachar')} disabled={accion.isPending} className="btn-primary">
                    <Truck className="h-4 w-4" /> Despachar
                  </button>
                </>
              )}
              {o.status !== 'entregado' && o.status !== 'cancelado' && !cancelando && (
                <button onClick={() => setCancelando(true)} className="btn-secondary ml-auto">
                  Cancelar pedido
                </button>
              )}
              {o.status === 'entregado' && (
                <p className="flex items-center gap-2 text-sm text-emerald-700">
                  <Check className="h-4 w-4" /> Entregado {o.delivered_at ? timeOnly(o.delivered_at) : ''}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function NuevoPedido({
  open, onClose, onCreado,
}: { open: boolean; onClose: () => void; onCreado: () => void }) {
  const productos = useProducts()
  const [clienteId, setClienteId] = useState('')
  const [fecha, setFecha] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  })
  const [ventana, setVentana] = useState('09:00 - 11:00')
  const [notas, setNotas] = useState('')
  const [lineas, setLineas] = useState<{ product_id: string; cantidad: string; precio: string }[]>([
    { product_id: '', cantidad: '', precio: '' },
  ])

  const clientes = useQuery({
    queryKey: ['customers-select'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, customer_type, payment_terms_days')
        .eq('status', 'activo')
        .order('name')
      if (error) throw error
      return data as Customer[]
    },
  })

  async function precioDe(productId: string, cantidad: number) {
    const { data } = await supabase.rpc('price_for', {
      _product_id: productId,
      _customer_id: clienteId || null,
      _quantity: cantidad || 0,
    })
    return Number(data ?? 0)
  }

  const crear = useMutation({
    mutationFn: async () => {
      const validas = lineas.filter((l) => l.product_id && Number(l.cantidad) > 0)
      if (!clienteId || validas.length === 0) throw new Error('Elige el cliente y al menos un producto')

      const cliente = clientes.data?.find((c) => c.id === clienteId)
      const due = new Date(fecha)
      due.setDate(due.getDate() + (cliente?.payment_terms_days ?? 30))

      const { data: orden, error } = await supabase
        .from('orders')
        .insert({
          customer_id: clienteId,
          delivery_date: fecha,
          delivery_window: ventana || null,
          notes: notas.trim() || null,
          due_date: due.toISOString().slice(0, 10),
        })
        .select('id')
        .single()
      if (error) throw error

      const { error: e2 } = await supabase.from('order_items').insert(
        validas.map((l) => ({
          order_id: orden.id,
          product_id: l.product_id,
          quantity_ordered: Number(l.cantidad),
          unit_price: Number(l.precio) || 0,
        })),
      )
      if (e2) throw e2
    },
    onSuccess: () => {
      onCreado()
      onClose()
      setLineas([{ product_id: '', cantidad: '', precio: '' }])
      setNotas('')
      setClienteId('')
    },
  })

  const total = lineas.reduce((n, l) => n + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nuevo pedido"
      wide
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => crear.mutate()} disabled={crear.isPending} className="btn-primary">
            Crear pedido
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-1">
            <label className="label">Cliente</label>
            <select className="input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
              <option value="">Seleccionar…</option>
              {clientes.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Fecha de entrega</label>
            <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </div>
          <div>
            <label className="label">Horario</label>
            <input className="input" value={ventana} onChange={(e) => setVentana(e.target.value)} />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">Productos</label>
            <button
              onClick={() => setLineas([...lineas, { product_id: '', cantidad: '', precio: '' }])}
              className="text-xs font-medium text-navy-600 hover:underline"
            >
              + Agregar producto
            </button>
          </div>
          <div className="space-y-2">
            {lineas.map((l, i) => (
              <div key={i} className="flex gap-2">
                <select
                  className="input flex-1"
                  value={l.product_id}
                  onChange={async (e) => {
                    const pid = e.target.value
                    const precio = pid ? await precioDe(pid, Number(l.cantidad) || 0) : 0
                    setLineas((ls) =>
                      ls.map((x, j) => (j === i ? { ...x, product_id: pid, precio: String(precio) } : x)),
                    )
                  }}
                >
                  <option value="">Producto…</option>
                  {productos.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input
                  className="input w-24"
                  type="number"
                  step="0.001"
                  placeholder="kg"
                  value={l.cantidad}
                  onChange={(e) =>
                    setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))
                  }
                />
                <input
                  className="input w-28"
                  type="number"
                  placeholder="$/kg"
                  value={l.precio}
                  onChange={(e) =>
                    setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, precio: e.target.value } : x)))
                  }
                />
                <button
                  onClick={() => setLineas(lineas.filter((_, j) => j !== i))}
                  className="rounded-lg px-2 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            El precio se trae solo desde el precio vigente del producto o el precio especial del cliente.
          </p>
        </div>

        <div>
          <label className="label">Observaciones</label>
          <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-navy-50 px-3 py-2">
          <span className="text-sm text-navy-800">Total neto estimado</span>
          <span className="font-semibold tabular-nums text-navy-900">{money(total)}</span>
        </div>

        <p className="flex items-start gap-2 text-xs text-slate-500">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          El pedido se crea como <strong>nuevo</strong>. Al confirmarlo se reserva el stock; si no
          alcanza, el sistema lo impide, tal como pidió el negocio.
        </p>

        {crear.isError && <ErrorState error={crear.error} />}
      </div>
    </Modal>
  )
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{k}</p>
      <p className="text-slate-800">{v}</p>
    </div>
  )
}
