import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, PackageCheck, Pencil, Plus, SlidersHorizontal, Trash2, Truck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useProducts, useSuppliers } from '../../lib/queries'
import type { PaymentMethod, Purchase } from '../../lib/types'
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE, PURCHASE_STATUS_LABEL } from '../../lib/constants'
import { dateShort, kg, money } from '../../lib/format'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, StatCard, TableWrap } from '../../components/ui'

interface Linea {
  product_id: string
  quantity: string
  unit_price: string
}

interface ItemCompra {
  id: string
  product_id: string
  quantity: number
  unit: string
  unit_price: number
  line_total: number
  products: { name: string; sku: string | null } | null
}

const lineaVacia: Linea = { product_id: '', quantity: '', unit_price: '' }

export function Compras() {
  const qc = useQueryClient()
  const proveedores = useSuppliers()
  const productos = useProducts()
  const [editor, setEditor] = useState<{ modo: 'nueva' | 'borrador'; compra?: Purchase } | null>(null)
  const [corregir, setCorregir] = useState<Purchase | null>(null)
  const [anular, setAnular] = useState<Purchase | null>(null)
  const [detalleId, setDetalleId] = useState<string | null>(null)

  const compras = useQuery({
    queryKey: ['purchases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchases')
        .select('*, suppliers(id, name)')
        .order('purchase_date', { ascending: false })
        .limit(150)
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
        .select('id, product_id, quantity, unit, unit_price, line_total, products(name, sku)')
        .eq('purchase_id', detalleId)
      if (error) throw error
      return data as unknown as ItemCompra[]
    },
  })

  const recibir = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('receive_purchase', { _purchase_id: id })
      if (error) throw error
    },
    onSuccess: refrescar,
  })

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['purchases'] })
    qc.invalidateQueries({ queryKey: ['purchase-items'] })
    qc.invalidateQueries({ queryKey: ['stock'] })
    qc.invalidateQueries({ queryKey: ['lots-all'] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis'] })
  }

  const mes = (compras.data ?? []).filter(
    (c) => c.status === 'recibida' && new Date(c.purchase_date).getMonth() === new Date().getMonth(),
  )
  const borradores = (compras.data ?? []).filter((c) => c.status === 'borrador')

  return (
    <>
      <PageHeader
        title="Compras"
        subtitle="Al recibir, el flete y los costos se reparten y queda el costo real por kilo"
        actions={
          <button onClick={() => setEditor({ modo: 'nueva' })} className="btn-primary">
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
        <StatCard label="Borradores" value={String(borradores.length)} hint="pendientes de recibir" />
      </div>

      {compras.isError && <ErrorState error={compras.error} />}
      {compras.isLoading && <Skeleton className="mt-4 h-64" />}
      {compras.data?.length === 0 && <Card className="mt-4"><EmptyState title="Sin compras registradas" /></Card>}

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
                <tr key={c.id} className={`hover:bg-slate-50 ${c.status === 'anulada' ? 'opacity-50' : ''}`}>
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
                  <td className="td text-right whitespace-nowrap">
                    {c.status === 'borrador' && (
                      <>
                        <button
                          onClick={() => setEditor({ modo: 'borrador', compra: c })}
                          title="Editar el borrador"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => recibir.mutate(c.id)}
                          disabled={recibir.isPending}
                          className="btn-accent ml-1 px-3 py-1.5 text-xs"
                        >
                          <PackageCheck className="h-3.5 w-3.5" /> Recibir
                        </button>
                      </>
                    )}
                    {c.status === 'recibida' && (
                      <>
                        <button
                          onClick={() => setCorregir(c)}
                          title="Corregir costos y datos"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                        >
                          <SlidersHorizontal className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setAnular(c)}
                          title="Anular la compra"
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {recibir.isError && <div className="mt-3"><ErrorState error={recibir.error} /></div>}
        </div>
      )}

      <EditorCompra
        estado={editor}
        onClose={() => setEditor(null)}
        onListo={refrescar}
        proveedores={proveedores.data ?? []}
        productos={productos.data ?? []}
      />
      <CorregirCompra compra={corregir} onClose={() => setCorregir(null)} onListo={refrescar} />
      <AnularCompra compra={anular} onClose={() => setAnular(null)} onListo={refrescar} />

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

/** Crea una compra nueva o edita un borrador, que todavía no ha movido inventario. */
function EditorCompra({
  estado, onClose, onListo, proveedores, productos,
}: {
  estado: { modo: 'nueva' | 'borrador'; compra?: Purchase } | null
  onClose: () => void
  onListo: () => void
  proveedores: { id: string; name: string }[]
  productos: { id: string; name: string }[]
}) {
  const [supplierId, setSupplierId] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [flete, setFlete] = useState('0')
  const [otros, setOtros] = useState('0')
  const [origen, setOrigen] = useState('Terminal Pesquero')
  const [factura, setFactura] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([lineaVacia])

  const esEdicion = estado?.modo === 'borrador' && !!estado.compra

  const itemsExistentes = useQuery({
    queryKey: ['purchase-items-edit', estado?.compra?.id],
    enabled: !!estado?.compra?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_items')
        .select('product_id, quantity, unit_price')
        .eq('purchase_id', estado!.compra!.id)
      if (error) throw error
      return data as { product_id: string; quantity: number; unit_price: number }[]
    },
  })

  useEffect(() => {
    if (!estado) return
    const c = estado.compra
    setSupplierId(c?.supplier_id ?? '')
    setFecha(c?.purchase_date ?? new Date().toISOString().slice(0, 10))
    setFlete(String(c?.freight_cost ?? 0))
    setOtros(String(c?.other_costs ?? 0))
    setOrigen(c?.origin ?? 'Terminal Pesquero')
    setFactura('')
    if (!c) setLineas([lineaVacia])
  }, [estado])

  useEffect(() => {
    if (esEdicion && itemsExistentes.data) {
      setLineas(
        itemsExistentes.data.length
          ? itemsExistentes.data.map((i) => ({
              product_id: i.product_id,
              quantity: String(i.quantity),
              unit_price: String(i.unit_price),
            }))
          : [lineaVacia],
      )
    }
  }, [esEdicion, itemsExistentes.data])

  const subtotal = useMemo(
    () => lineas.reduce((n, l) => n + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    [lineas],
  )
  const totalKilos = useMemo(() => lineas.reduce((n, l) => n + (Number(l.quantity) || 0), 0), [lineas])
  const total = subtotal + (Number(flete) || 0) + (Number(otros) || 0)
  const costoRealKg = totalKilos > 0 ? total / totalKilos : 0

  const guardar = useMutation({
    mutationFn: async (recibirAhora: boolean) => {
      const validas = lineas.filter((l) => l.product_id && Number(l.quantity) > 0)
      if (!supplierId || validas.length === 0) throw new Error('Elige el proveedor y al menos un producto')

      const campos = {
        supplier_id: supplierId,
        purchase_date: fecha,
        freight_cost: Number(flete) || 0,
        other_costs: Number(otros) || 0,
        origin: origen.trim() || null,
        invoice_number: factura.trim() || null,
      }

      let compraId = estado?.compra?.id
      if (esEdicion && compraId) {
        const { error } = await supabase.from('purchases').update(campos).eq('id', compraId)
        if (error) throw error
        // Las líneas se reemplazan completas: es un borrador, no movió inventario
        const { error: eDel } = await supabase.from('purchase_items').delete().eq('purchase_id', compraId)
        if (eDel) throw eDel
      } else {
        const { data, error } = await supabase.from('purchases').insert(campos).select('id').single()
        if (error) throw error
        compraId = data.id
      }

      const { error: eIns } = await supabase.from('purchase_items').insert(
        validas.map((l) => ({
          purchase_id: compraId,
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price) || 0,
        })),
      )
      if (eIns) throw eIns

      if (recibirAhora) {
        const { error } = await supabase.rpc('receive_purchase', { _purchase_id: compraId })
        if (error) throw error
      }
    },
    onSuccess: () => {
      onListo()
      onClose()
      setLineas([lineaVacia])
      setFactura('')
    },
  })

  return (
    <Modal
      open={!!estado}
      onClose={onClose}
      title={esEdicion ? `Editar borrador ${estado?.compra?.code ?? ''}` : 'Nueva compra'}
      wide
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => guardar.mutate(false)} disabled={guardar.isPending} className="btn-secondary">
            {esEdicion ? 'Guardar cambios' : 'Guardar borrador'}
          </button>
          <button onClick={() => guardar.mutate(true)} disabled={guardar.isPending} className="btn-primary">
            <Check className="h-4 w-4" /> {esEdicion ? 'Guardar y recibir' : 'Guardar y recibir'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {esEdicion && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Este borrador todavía no ha entrado a bodega, así que se puede modificar entero:
            proveedor, productos, cantidades y precios.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Proveedor</label>
            <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Seleccionar…</option>
              {proveedores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
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
            <button onClick={() => setLineas([...lineas, lineaVacia])} className="text-xs font-medium text-navy-600 hover:underline">
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
                  {productos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <input
                  className="input w-24" type="number" step="0.001" placeholder="kg"
                  value={l.quantity}
                  onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))}
                />
                <input
                  className="input w-28" type="number" step="1" placeholder="$/kg"
                  value={l.unit_price}
                  onChange={(e) => setLineas(lineas.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))}
                />
                <button
                  onClick={() => setLineas(lineas.length > 1 ? lineas.filter((_, j) => j !== i) : [lineaVacia])}
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

        <ResumenCosto subtotal={subtotal} kilos={totalKilos} extras={(Number(flete) || 0) + (Number(otros) || 0)} total={total} costoKg={costoRealKg} />

        {guardar.isError && <ErrorState error={guardar.error} />}
      </div>
    </Modal>
  )
}

/** Corrige una compra ya recibida: datos y costos, sin tocar cantidades. */
function CorregirCompra({
  compra, onClose, onListo,
}: { compra: Purchase | null; onClose: () => void; onListo: () => void }) {
  const [flete, setFlete] = useState('')
  const [otros, setOtros] = useState('')
  const [factura, setFactura] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod | ''>('')
  const [vence, setVence] = useState('')
  const [notas, setNotas] = useState('')
  const [resultado, setResultado] = useState<{
    total: number; lotes_ajustados: number; lotes_con_movimiento: number; costo_por_kilo: number
  } | null>(null)

  useEffect(() => {
    if (compra) {
      setFlete(String(compra.freight_cost))
      setOtros(String(compra.other_costs))
      setFactura('')
      setMetodo('')
      setVence('')
      setNotas('')
      setResultado(null)
    }
  }, [compra])

  const guardar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('update_purchase_costs', {
        _purchase_id: compra!.id,
        _freight: Number(flete) || 0,
        _other: Number(otros) || 0,
        _invoice: factura.trim() || null,
        _notes: notas.trim() || null,
        _due_date: vence || null,
        _payment_method: metodo || null,
      })
      if (error) throw error
      return data as typeof resultado
    },
    onSuccess: (r) => {
      setResultado(r)
      onListo()
    },
  })

  return (
    <Modal
      open={!!compra}
      onClose={onClose}
      title={`Corregir ${compra?.code ?? ''}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cerrar</button>
          <button onClick={() => guardar.mutate()} disabled={guardar.isPending} className="btn-primary">
            Guardar corrección
          </button>
        </>
      }
    >
      {compra && (
        <div className="space-y-3">
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Esta compra ya entró a bodega. Puedes corregir el flete, los costos y los datos del
            documento: el sistema recalcula el costo por kilo de sus lotes. Para cambiar cantidades o
            precios hay que anular la compra y volver a ingresarla.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Flete</label>
              <input className="input" type="number" value={flete} onChange={(e) => setFlete(e.target.value)} />
            </div>
            <div>
              <label className="label">Otros costos</label>
              <input className="input" type="number" value={otros} onChange={(e) => setOtros(e.target.value)} />
            </div>
            <div>
              <label className="label">N° de factura</label>
              <input className="input" value={factura} onChange={(e) => setFactura(e.target.value)} placeholder={compra.code} />
            </div>
            <div>
              <label className="label">Vence</label>
              <input className="input" type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
            </div>
            <div>
              <label className="label">Método de pago</label>
              <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value as PaymentMethod)}>
                <option value="">Sin cambios</option>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Observación</label>
              <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} />
            </div>
          </div>

          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Neto de los productos</span>
              <span className="tabular-nums">{money(compra.subtotal)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Flete y otros costos</span>
              <span className="tabular-nums">{money((Number(flete) || 0) + (Number(otros) || 0))}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900">
              <span>Total corregido</span>
              <span className="tabular-nums">{money(Number(compra.subtotal) + (Number(flete) || 0) + (Number(otros) || 0))}</span>
            </div>
          </div>

          {resultado && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              <p className="font-medium">Corrección aplicada</p>
              <p className="text-xs">
                {resultado.lotes_ajustados} lote(s) con su costo recalculado · nuevo costo por kilo{' '}
                {money(resultado.costo_por_kilo)}
              </p>
              {resultado.lotes_con_movimiento > 0 && (
                <p className="mt-1 text-xs text-amber-700">
                  Atención: {resultado.lotes_con_movimiento} lote(s) ya habían salido a venta. Las
                  ventas anteriores quedaron con el costo antiguo; solo se corrige de aquí en adelante.
                </p>
              )}
            </div>
          )}

          {guardar.isError && <ErrorState error={guardar.error} />}
        </div>
      )}
    </Modal>
  )
}

function AnularCompra({
  compra, onClose, onListo,
}: { compra: Purchase | null; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('')

  const anular = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('void_purchase', {
        _purchase_id: compra!.id,
        _reason: motivo.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      onListo()
      onClose()
      setMotivo('')
    },
  })

  return (
    <Modal
      open={!!compra}
      onClose={onClose}
      title={`Anular ${compra?.code ?? ''}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Volver</button>
          <button onClick={() => anular.mutate()} disabled={!motivo.trim() || anular.isPending} className="btn-danger">
            Anular compra
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          Anular devuelve a cero los lotes que entraron con esta compra. Solo se puede si ese
          producto sigue intacto en bodega: si algo ya se vendió, reservó o procesó, el sistema lo
          impide y hay que corregir con un ajuste de inventario.
        </p>
        <div>
          <label className="label">Motivo de la anulación</label>
          <input
            className="input"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Documento duplicado, error de digitación…"
          />
        </div>
        <p className="text-xs text-slate-500">
          La compra no se borra: queda como anulada, con su motivo y en la auditoría.
        </p>
        {anular.isError && <ErrorState error={anular.error} />}
      </div>
    </Modal>
  )
}

function ResumenCosto({
  subtotal, kilos, extras, total, costoKg,
}: { subtotal: number; kilos: number; extras: number; total: number; costoKg: number }) {
  return (
    <div className="rounded-lg bg-navy-50 p-3 text-sm">
      <div className="flex justify-between text-slate-600">
        <span>Subtotal ({kg(kilos)})</span>
        <span className="tabular-nums">{money(subtotal)}</span>
      </div>
      <div className="flex justify-between text-slate-600">
        <span>Flete y otros costos</span>
        <span className="tabular-nums">{money(extras)}</span>
      </div>
      <div className="mt-1 flex justify-between border-t border-navy-200 pt-1 font-semibold text-navy-900">
        <span>Total real</span>
        <span className="tabular-nums">{money(total)}</span>
      </div>
      {kilos > 0 && (
        <p className="mt-1 text-xs text-navy-700">
          Costo real por kilo: <strong>{money(costoKg)}</strong> (con flete y costos repartidos)
        </p>
      )}
    </div>
  )
}
