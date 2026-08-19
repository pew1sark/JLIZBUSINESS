import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ClipboardList, Loader2, Package, Scale } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useItemsOperativos, usePedidosOperativos, type PedidoOperativo } from '../../lib/operativo'
import type { OrderStatus } from '../../lib/types'
import { ORDER_STATUS_LABEL, ORDER_STATUS_STYLE } from '../../lib/constants'
import { dateShort, kg } from '../../lib/format'
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui'

const ETAPAS: { estado: OrderStatus; titulo: string }[] = [
  { estado: 'confirmado', titulo: 'Por preparar' },
  { estado: 'en_preparacion', titulo: 'En preparación' },
  { estado: 'preparado', titulo: 'Listos para reparto' },
]

export function WorkerPedidos() {
  const [abierto, setAbierto] = useState<PedidoOperativo | null>(null)
  const pedidos = usePedidosOperativos(['confirmado', 'en_preparacion', 'preparado'])

  if (abierto) {
    return <DetalleTrabajador pedido={abierto} onVolver={() => setAbierto(null)} />
  }

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Pedidos</h1>
      <p className="mb-4 text-sm text-slate-500">Prepara y actualiza el estado de cada pedido</p>

      {pedidos.isError && <ErrorState error={pedidos.error} />}
      {pedidos.isLoading && <Skeleton className="h-48" />}
      {!pedidos.isLoading && pedidos.data?.length === 0 && (
        <Card><EmptyState title="No hay pedidos pendientes" icon={<ClipboardList className="h-8 w-8" />} /></Card>
      )}

      {ETAPAS.map(({ estado, titulo }) => {
        const lista = (pedidos.data ?? []).filter((p) => p.status === estado)
        if (!lista.length) return null
        return (
          <section key={estado} className="mb-5">
            <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-navy-700 uppercase">
              {titulo}
              <span className="rounded-full bg-navy-100 px-2 py-0.5 text-navy-700">{lista.length}</span>
            </h2>
            <div className="space-y-2">
              {lista.map((p) => (
                <button key={p.order_id} onClick={() => setAbierto(p)} className="w-full text-left">
                  <Card className="p-4 active:bg-slate-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900">{p.cliente}</p>
                        <p className="text-xs text-slate-500">
                          {p.lineas} producto(s) · {kg(p.total_kilos)}
                        </p>
                      </div>
                      <span className={`badge shrink-0 ${ORDER_STATUS_STYLE[p.status]}`}>
                        {ORDER_STATUS_LABEL[p.status]}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      Entrega {dateShort(p.delivery_date)} {p.delivery_window ?? ''}
                    </p>
                  </Card>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </>
  )
}

function DetalleTrabajador({
  pedido, onVolver,
}: { pedido: PedidoOperativo; onVolver: () => void }) {
  const qc = useQueryClient()
  const items = useItemsOperativos(pedido.order_id)
  const [pesos, setPesos] = useState<Record<string, { bruto: string; hielo: string }>>({})
  const [alertas, setAlertas] = useState<{ producto: string; pedido: number; preparado: number; diferencia_pct: number }[]>([])

  const neto = (id: string, pedidoKg: number) => {
    const p = pesos[id]
    if (!p?.bruto) return null
    return Math.round((Number(p.bruto) - Number(p.hielo || 0)) * 1000) / 1000 || pedidoKg
  }

  const accion = useMutation({
    mutationFn: async (tipo: 'iniciar' | 'terminar') => {
      if (tipo === 'iniciar') {
        const { error } = await supabase.rpc('start_preparation', { _order_id: pedido.order_id })
        if (error) throw error
        return null
      }
      const cuerpo = (items.data ?? []).map((it) => ({
        item_id: it.item_id,
        gross_weight: pesos[it.item_id]?.bruto ? Number(pesos[it.item_id].bruto) : null,
        ice_weight: pesos[it.item_id]?.hielo ? Number(pesos[it.item_id].hielo) : 0,
        quantity_prepared: pesos[it.item_id]?.bruto ? null : it.quantity_ordered,
      }))
      const { data, error } = await supabase.rpc('finish_preparation', {
        _order_id: pedido.order_id,
        _items: cuerpo,
      })
      if (error) throw error
      return data as { alertas?: typeof alertas }
    },
    onSuccess: (data) => {
      setAlertas(data?.alertas ?? [])
      qc.invalidateQueries({ queryKey: ['op-pedidos'] })
      qc.invalidateQueries({ queryKey: ['op-items'] })
      qc.invalidateQueries({ queryKey: ['op-stock'] })
      if (!data?.alertas?.length) onVolver()
    },
  })

  return (
    <>
      <button onClick={onVolver} className="mb-3 flex items-center gap-1 text-sm font-medium text-navy-600">
        <ChevronLeft className="h-4 w-4" /> Volver
      </button>

      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">{pedido.cliente}</h1>
        <p className="text-sm text-slate-500">
          {pedido.code} · entrega {dateShort(pedido.delivery_date)} {pedido.delivery_window ?? ''}
        </p>
        {pedido.notes && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{pedido.notes}</p>
        )}
      </div>

      {alertas.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Aviso: diferencia de peso importante</p>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
            {alertas.map((a, i) => (
              <li key={i}>{a.producto}: pedido {a.pedido} → preparado {a.preparado} ({a.diferencia_pct}%)</li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-amber-700">Avisa a la administración antes de despachar.</p>
          <button onClick={onVolver} className="btn-secondary mt-2 w-full py-2 text-sm">Entendido</button>
        </div>
      )}

      {items.isLoading && <Skeleton className="h-40" />}

      <div className="space-y-3">
        {items.data?.map((it) => {
          const enPreparacion = pedido.status === 'en_preparacion'
          const n = neto(it.item_id, it.quantity_ordered)
          return (
            <Card key={it.item_id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-900">{it.producto}</p>
                  <p className="text-sm text-slate-500">Solicitado {kg(it.quantity_ordered, it.unit)}</p>
                  {it.lote && <p className="text-[11px] text-slate-400">lote {it.lote}</p>}
                </div>
                {it.quantity_prepared != null && (
                  <span className="badge bg-emerald-100 text-emerald-700">
                    {kg(it.quantity_prepared, it.unit)}
                  </span>
                )}
              </div>

              {enPreparacion && (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div>
                      <label className="label mb-1">Peso en balanza</label>
                      <input
                        className="input py-3 text-lg"
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        value={pesos[it.item_id]?.bruto ?? ''}
                        onChange={(e) =>
                          setPesos((p) => ({
                            ...p,
                            [it.item_id]: { ...(p[it.item_id] ?? { bruto: '', hielo: '' }), bruto: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className="label mb-1">Hielo</label>
                      <input
                        className="input py-3 text-lg"
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        value={pesos[it.item_id]?.hielo ?? ''}
                        onChange={(e) =>
                          setPesos((p) => ({
                            ...p,
                            [it.item_id]: { ...(p[it.item_id] ?? { bruto: '', hielo: '' }), hielo: e.target.value },
                          }))
                        }
                      />
                    </div>
                  </div>
                  {n !== null && (
                    <p className="mt-2 rounded-lg bg-sea-50 px-3 py-2 text-sm font-medium text-sea-900">
                      Se entregan {kg(n, it.unit)}
                    </p>
                  )}
                </>
              )}
            </Card>
          )
        })}
      </div>

      {accion.isError && <div className="mt-3"><ErrorState error={accion.error} /></div>}

      <div className="mt-4 pb-4">
        {pedido.status === 'confirmado' && (
          <button onClick={() => accion.mutate('iniciar')} disabled={accion.isPending} className="btn-primary btn-lg w-full">
            {accion.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Package className="h-5 w-5" />}
            Comenzar preparación
          </button>
        )}
        {pedido.status === 'en_preparacion' && (
          <button onClick={() => accion.mutate('terminar')} disabled={accion.isPending} className="btn-accent btn-lg w-full">
            {accion.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Scale className="h-5 w-5" />}
            Guardar pesos y marcar preparado
          </button>
        )}
        {pedido.status === 'preparado' && (
          <p className="rounded-lg bg-emerald-50 px-4 py-3 text-center text-sm font-medium text-emerald-800">
            Pedido preparado y listo para reparto
          </p>
        )}
      </div>
    </>
  )
}
