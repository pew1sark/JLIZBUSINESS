import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, PackageCheck, Plus, Trash2, Truck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useProducts, useSuppliers } from '../../lib/queries'
import type { Purchase } from '../../lib/types'
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE, PURCHASE_STATUS_LABEL } from '../../lib/constants'
import { dateShort, kg, money } from '../../lib/format'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, StatCard, TableWrap } from '../../components/ui'

interface Linea {
  product_id: string
  quantity: string
  unit_price: string
}

export function Compras() {
  const qc = useQueryClient()
  const proveedores = useSuppliers()
  const productos = useProducts()
  const [nueva, setNueva] = useState(false)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const [supplierId, setSupplierId] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [flete, setFlete] = useState('0')
  const [otros, setOtros] = useState('0')
  const [origen, setOrigen] = useState('Terminal Pesquero')
  const [factura, setFactura] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([{ product_id: '', quantity: '', unit_price: '' }])

  const compras = useQuery({
    queryKey: ['purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchases')
        .select('*, suppliers(id, name)')
        .order('purchase_date', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as Purchase[]
    },
  })

  const detalle = useQuery({
    queryKey: ['purchase-items', detalleId],
    enabled: !!detalleId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_items')
        .select('id, quantity, unit, unit_price, line_total, products(name, sku)')
        .eq('purchase_id', detalleId)
      if (error) throw error
      return data as unknown as {
        id: string; quantity: number; unit: string; unit_price: number; line_total: number
        products: { name: string; sku: string | null } | null
      }[]
    },
  })

  const subtotal = useMemo(
    () => lineas.reduce((n, l) => n + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    [lineas],
  )
  const totalKilos = useMemo(() => lineas.reduce((n, l) => n + (Number(l.quantity) || 0), 0), [lineas])
  const total = subtotal + (Number(flete) || 0) + (Number(otros) || 0)
  const costoRealKg = totalKilos > 0 ? total / totalKilos : 0

  const crear = useMutation({
    mutationFn: async (recibir: boolean) => {
      const validas = lineas.filter((l) => l.product_id && Number(l.quantity) > 0)
      if (!supplierId || validas.length === 0) throw new Error('Elige el proveedor y al menos un producto')

      const { data: compra, error } = await supabase
        .from('purchases')
        .insert({
          supplier_id: supplierId,
          purchase_date: fecha,
          freight_cost: Number(flete) || 0,
          other_costs: Number(otros) || 0,
          origin: origen.trim() || null,
          invoice_number: factura.trim() || null,
        })
        .select('id')
        .single()
      if (error) throw error

      const { error: e2 } = await supabase.from('purchase_items').insert(
        validas.map((l) => ({
          purchase_id: compra.id,
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price) || 0,
        })),
      )
      if (e2) throw e2

      if (recibir) {
        const { error: e3 } = await supabase.rpc('receive_purchase', { _purchase_id: compra.id })
        if (e3) throw e3
      }
    },
    onSuccess: () => {
      setNueva(false)
      setLineas([{ product_id: '', quantity: '', unit_price: '' }])
      setFlete('0')
      setOtros('0')
      setFactura('')
      qc.invalidateQueries({ queryKey: ['purchases'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
      qc.invalidateQueries({ queryKey: ['lots-all'] })
      qc.invalidateQueries({ queryKey: ['dashboard-kpis'] })
    },
  })

  const recibir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('receive_purchase', { _purchase_id: id })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchases'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
      qc.invalidateQueries({ queryKey: ['lots-all'] })
    },
  })

  const mes = (compras.data ?? []).filter(
    (c) => c.status === 'recibida' && new Date(c.purchase_date).getMonth() === new Date().getMonth(),
  )

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle="Al recibir, el flete y los costos se reparten y queda el costo real por kilo"
        actions={
          <button onClick={() => setNueva(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Nueva compra
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Compras del mes" value={money(mes.reduce((n, c) => n + Number(c.total), 0))} hint={`${mes.length} recepciones`} />
        <StatCard label="Flete del mes" value={money(mes.reduce((n, c) => n + Number(c.freight_cost), 0))} icon={<Truck className="h-4 w-4" />} />
        <StatCard
          label="Por pagar"
          value={money((compras.data ?? []).filter((c) => c.payment_status !== 'pagado' && c.status === 'recibida').reduce((n, c) => n + (Number(c.total) - Number(c.amount_paid)), 0))}
          tone="warning"
        />
        <StatCard label="Borradores" value={String((compras.data ?? []).filter((c) => c.status === 'borrador').length)} hint="pendientes de recibir" />
      </div>

      {compras.isError && <ErrorState error={compras.error} />}
      {compras.isLoading && <Skeleton className="mt-4 h-64" />}
      {compras.data?.length === 0 && (
        <Card className="mt-4"><EmptyState title="Sin compras registradas" /></Card>
      )}

      {!!compras.data?.length && (
        <div className="mt-4">
          <TableWrap>
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Compra</th>
                <th className="th">Proveedor</th>
                <th className="th">Fecha</th>
                <th className="th">Neto + costos</th>
                <th className="th">Total</th>
                <th className="th">Estado</th>
                <th className="th">Pago</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {compras.data.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="td">
                    <button onClick={() => setDetalleId(c.id)} className="font-mono text-xs font-medium text-navy-700 hover:underline">
                      {c.code}
                    </button>
                    <p className="text-xs text-slate-400">{c.origin ?? '—'}</p>
                  </td>
                  <td className="td font-medium text-slate-800">{c.suppliers?.name}</td>
                  <td className="td text-slate-500">{dateShort(c.purchase_date)}</td>
                  <td className="td text-xs text-slate-500">
                    {money(c.subtotal)} + {money(Number(c.freight_cost) + Number(c.other_costs))}
                  </td>
                  <td className="td tabular-nums font-medium">{money(c.total)}</td>
                  <td className="td">
                    <span className={`badge ${c.status === 'recibida' ? 'bg-emerald-100 text-emerald-700' : c.status === 'anulada' ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                      {PURCHASE_STATUS_LABEL[c.status]}
                    </span>
                  </td>
                  <td className="td">
                    <span className={`badge ${PAYMENT_STATUS_STYLE[c.payment_status]}`}>
                      {PAYMENT_STATUS_LABEL[c.payment_status]}
                    </span>
                  </td>
                  <td className="td text-right">
                    {c.status === 'borrador' && (
                      <button
                        onClick={() => recibir.mutate(c.id)}
                        disabled={recibir.isPending}
                        className="btn-accent px-3 py-1.5 text-xs"
                      >
                        <PackageCheck className="h-3.5 w-3.5" /> Recibir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {recibir.isError && <div className="mt-3"><ErrorState error={recibir.error} /></div>}
        </div>
      )}

      <Modal
        open={nueva}
        onClose={() => setNueva(false)}
        title="Nueva compra"
        wide
        footer={
          <>
            <button onClick={() => setNueva(false)} className="btn-secondary">Cancelar</button>
            <button onClick={() => crear.mutate(false)} disabled={crear.isPending} className="btn-secondary">
              Guardar borrador
            </button>
            <button onClick={() => crear.mutate(true)} disabled={crear.isPending} className="btn-primary">
              <Check className="h-4 w-4" /> Guardar y recibir
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Proveedor</label>
              <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Seleccionar…</option>
                {proveedores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Fecha</label>
              <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div>
              <label className="label">Origen</label>
              <input className="input" value={origen} onChange={(e) => setOrigen(e.target.value)} />
            </div>
            <div>
              <label className="label">N° de factura</label>
              <input className="input" value={factura} onChange={(e) => setFactura(e.target.value)} placeholder="Opcional" />
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="label mb-0">Productos</label>
              <button
                onClick={() => setLineas([...lineas, { product_id: '', quantity: '', unit_price: '' }])}
                className="text-xs font-medium text-navy-600 hover:underline"
              >
                + Agregar línea
              </button>
            </div>
            <div className="space-y-2">
              {lineas.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <select
                    className="input flex-1"
                    value={l.product_id}
                    onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, product_id: e.target.value } : x)))}
                  >
                    <option value="">Producto…</option>
                    {productos.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <input
                    className="input w-24"
                    type="number"
                    step="0.001"
                    placeholder="kg"
                    value={l.quantity}
                    onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                  />
                  <input
                    className="input w-28"
                    type="number"
                    step="1"
                    placeholder="$/kg"
                    value={l.unit_price}
                    onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))}
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
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Flete</label>
              <input className="input" type="number" value={flete} onChange={(e) => setFlete(e.target.value)} />
            </div>
            <div>
              <label className="label">Otros costos (hielo, cajas, peajes, combustible)</label>
              <input className="input" type="number" value={otros} onChange={(e) => setOtros(e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg bg-navy-50 p-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal ({kg(totalKilos)})</span>
              <span className="tabular-nums">{money(subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Flete y otros costos</span>
              <span className="tabular-nums">{money((Number(flete) || 0) + (Number(otros) || 0))}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-navy-200 pt-1 font-semibold text-navy-900">
              <span>Total real</span>
              <span className="tabular-nums">{money(total)}</span>
            </div>
            {totalKilos > 0 && (
              <p className="mt-1 text-xs text-navy-700">
                Costo real por kilo: <strong>{money(costoRealKg)}</strong> (con flete y costos repartidos)
              </p>
            )}
          </div>

          {crear.isError && <ErrorState error={crear.error} />}
        </div>
      </Modal>

      <Modal open={!!detalleId} onClose={() => setDetalleId(null)} title="Detalle de la compra" wide>
        {detalle.isLoading && <Skeleton className="h-32" />}
        <div className="space-y-1.5">
          {detalle.data?.map((it) => (
            <div key={it.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
              <div>
                <p className="font-medium text-slate-800">{it.products?.name}</p>
                <p className="text-xs text-slate-400">{kg(it.quantity, it.unit)} × {money(it.unit_price)}</p>
              </div>
              <p className="font-medium tabular-nums">{money(it.line_total)}</p>
            </div>
          ))}
        </div>
      </Modal>
    </>
  )
}
