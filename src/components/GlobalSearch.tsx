import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, ClipboardList, Fish, Search, Truck, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'

interface Hit {
  id: string
  type: 'pedido' | 'cliente' | 'producto' | 'lote' | 'proveedor'
  title: string
  subtitle: string
  to: string
}

const ICON = {
  pedido: ClipboardList,
  cliente: Users,
  producto: Fish,
  lote: Boxes,
  proveedor: Truck,
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!open) setTerm('')
  }, [open])

  useEffect(() => {
    const q = term.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    let cancelled = false
    setLoading(true)

    const timer = setTimeout(async () => {
      const like = `%${q}%`
      const [orders, customers, products, lots, suppliers] = await Promise.all([
        supabase.from('orders').select('id, code, total, status, customers(name)').ilike('code', like).limit(5),
        supabase.from('customers').select('id, name, comuna, customer_type')
          .or(`name.ilike.${like},rut.ilike.${like},email.ilike.${like},phone.ilike.${like}`).limit(5),
        supabase.from('products').select('id, name, sku, sale_price').or(`name.ilike.${like},sku.ilike.${like}`).limit(5),
        supabase.from('inventory_lots').select('id, code, quantity_on_hand, products(name)').ilike('code', like).limit(5),
        supabase.from('suppliers').select('id, name, comuna')
          .or(`name.ilike.${like},rut.ilike.${like}`).limit(5),
      ])
      if (cancelled) return

      const result: Hit[] = [
        ...(orders.data ?? []).map((o) => ({
          id: o.id,
          type: 'pedido' as const,
          title: o.code,
          subtitle: `${(o.customers as { name?: string } | null)?.name ?? 'Cliente'} · ${money(o.total)}`,
          to: `/pedidos/${o.id}`,
        })),
        ...(customers.data ?? []).map((c) => ({
          id: c.id, type: 'cliente' as const, title: c.name,
          subtitle: `${c.customer_type} · ${c.comuna ?? ''}`, to: `/clientes/${c.id}`,
        })),
        ...(products.data ?? []).map((p) => ({
          id: p.id, type: 'producto' as const, title: p.name,
          subtitle: `${p.sku ?? ''} · ${money(p.sale_price)}/kg`, to: `/inventario/${p.id}`,
        })),
        ...(lots.data ?? []).map((l) => ({
          id: l.id, type: 'lote' as const, title: l.code,
          subtitle: `${(l.products as { name?: string } | null)?.name ?? ''} · ${l.quantity_on_hand} kg`,
          to: `/inventario/lote/${l.id}`,
        })),
        ...(suppliers.data ?? []).map((s) => ({
          id: s.id, type: 'proveedor' as const, title: s.name,
          subtitle: s.comuna ?? '', to: `/proveedores/${s.id}`,
        })),
      ]
      setHits(result)
      setLoading(false)
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 p-4 sm:p-10" onClick={onClose}>
      <div
        className="mx-auto max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Factura, RUT, cliente, proveedor, producto, lote…"
            className="flex-1 py-3.5 text-sm outline-none placeholder:text-slate-400"
          />
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto">
          {loading && <p className="px-4 py-6 text-center text-sm text-slate-400">Buscando…</p>}
          {!loading && term.length >= 2 && hits.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">Sin resultados para "{term}"</p>
          )}
          {hits.map((h) => {
            const Icon = ICON[h.type]
            return (
              <button
                key={`${h.type}-${h.id}`}
                onClick={() => {
                  navigate(h.to)
                  onClose()
                }}
                className="flex w-full items-center gap-3 border-b border-slate-50 px-4 py-3 text-left hover:bg-slate-50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-slate-800">{h.title}</span>
                  <span className="block truncate text-xs text-slate-500">{h.subtitle}</span>
                </span>
                <span className="badge bg-slate-100 text-slate-500 capitalize">{h.type}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
