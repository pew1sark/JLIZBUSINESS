import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Boxes, Scissors, Search, SlidersHorizontal, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useLocations, useOperacion, useProducts, useStock } from '../../lib/queries'
import type { InventoryLot, LossReason, ProductStock } from '../../lib/types'
import { LOSS_REASON_LABEL, MOVEMENT_LABEL } from '../../lib/constants'
import { dateShort, dateTime, kg, money, moneyShort } from '../../lib/format'
import { Card, ErrorState, Modal, PageHeader, Pestanas, Skeleton, StatCard, TableWrap } from '../../components/ui'

type Vista = 'stock' | 'lotes' | 'movimientos'

export function Inventario() {
  const qc = useQueryClient()
  const stock = useStock()
  const productos = useProducts()
  const locales = useLocations()
  const operacion = useOperacion()
  const [vista, setVista] = useState<Vista>('stock')
  const [busca, setBusca] = useState('')
  const [ajuste, setAjuste] = useState<InventoryLot | null>(null)
  const [merma, setMerma] = useState<InventoryLot | null>(null)
  const [proceso, setProceso] = useState<InventoryLot | null>(null)

  const lotes = useQuery({
    queryKey: ['lots-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_lots')
        .select('*, products(id, name, sku), suppliers(id, name)')
        .eq('status', 'disponible')
        .gt('quantity_on_hand', 0)
        .order('expires_at', { nullsFirst: false })
      if (error) throw error
      return data as InventoryLot[]
    },
  })

  const movimientos = useQuery({
    queryKey: ['movements'],
    enabled: vista === 'movimientos',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('id, type, quantity, unit, unit_cost, reason, created_at, products(name), inventory_lots(code)')
        .order('created_at', { ascending: false })
        .limit(120)
      if (error) throw error
      return data as unknown as {
        id: number; type: keyof typeof MOVEMENT_LABEL; quantity: number; unit: string
        unit_cost: number | null; reason: string | null; created_at: string
        products: { name: string } | null; inventory_lots: { code: string } | null
      }[]
    },
  })

  const totales = useMemo(() => {
    const d = stock.data ?? []
    return {
      kilos: d.reduce((n, p) => n + Number(p.available), 0),
      valor: d.reduce((n, p) => n + Number(p.stock_value), 0),
      bajos: d.filter((p) => p.min_stock > 0 && p.available < p.min_stock).length,
      reservado: d.reduce((n, p) => n + Number(p.reserved), 0),
    }
  }, [stock.data])

  const porVencer = useMemo(() => {
    const limite = new Date()
    limite.setDate(limite.getDate() + 1)
    return (lotes.data ?? []).filter((l) => l.expires_at && new Date(l.expires_at) <= limite)
  }, [lotes.data])

  const filtro = (t: string) => t.toLowerCase().includes(busca.trim().toLowerCase())

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['stock'] })
    qc.invalidateQueries({ queryKey: ['lots-all'] })
    qc.invalidateQueries({ queryKey: ['movements'] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis'] })
  }

  return (
    <>
      <PageHeader
        title="Inventario"
        subtitle="Stock físico, reservado y disponible por producto y por lote"
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" className="input w-56 pl-9" />
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Disponible" value={kg(totales.kilos)} icon={<Boxes className="h-4 w-4" />} />
        <StatCard label="Reservado" value={kg(totales.reservado)} hint="comprometido en pedidos" />
        <StatCard label="Valorizado" value={moneyShort(totales.valor)} hint="a costo real" />
        <StatCard
          label="Bajo mínimo"
          value={String(totales.bajos)}
          tone={totales.bajos ? 'warning' : 'default'}
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      {porVencer.length > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-amber-900">
              {porVencer.length} lote(s) vencen hoy o mañana
            </p>
            <p className="text-amber-800/80">
              {porVencer.slice(0, 4).map((l) => `${l.products?.name} (${kg(l.quantity_on_hand)})`).join(' · ')}
            </p>
          </div>
        </div>
      )}

      <div className="mt-4 mb-3">
        <Pestanas
          valor={vista}
          onChange={setVista}
          opciones={[
            { id: 'stock', label: 'Stock' },
            { id: 'lotes', label: 'Lotes' },
            { id: 'movimientos', label: 'Movimientos' },
          ]}
        />
      </div>

      {stock.isError && <ErrorState error={stock.error} />}
      {(stock.isLoading || lotes.isLoading) && <Skeleton className="h-64" />}

      {vista === 'stock' && !!stock.data && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Producto</th>
              <th className="th">Físico</th>
              <th className="th">Reservado</th>
              <th className="th">Disponible</th>
              <th className="th">Mínimo</th>
              <th className="th">Lotes</th>
              <th className="th">Valorizado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {stock.data.filter((p) => filtro(p.name)).map((p: ProductStock) => {
              const bajo = p.min_stock > 0 && p.available < p.min_stock
              return (
                <tr key={p.product_id} className="hover:bg-slate-50">
                  <td className="td">
                    <p className="font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.sku ?? '—'}</p>
                  </td>
                  <td className="td tabular-nums">{kg(p.on_hand, p.base_unit)}</td>
                  <td className="td tabular-nums text-slate-500">{kg(p.reserved, p.base_unit)}</td>
                  <td className={`td tabular-nums font-semibold ${bajo ? 'text-amber-600' : 'text-slate-900'}`}>
                    {kg(p.available, p.base_unit)}
                  </td>
                  <td className="td tabular-nums text-slate-500">{kg(p.min_stock, p.base_unit)}</td>
                  <td className="td text-slate-500">{p.active_lots}</td>
                  <td className="td tabular-nums">{money(p.stock_value)}</td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {vista === 'lotes' && !!lotes.data && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Lote</th>
              <th className="th">Producto</th>
              <th className="th">Disponible</th>
              <th className="th">Costo/kg</th>
              <th className="th">Vence</th>
              <th className="th">Proveedor</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lotes.data.filter((l) => filtro(l.products?.name ?? '') || filtro(l.code)).map((l) => {
              const vence = l.expires_at ? new Date(l.expires_at) : null
              const critico = vence ? vence.getTime() - Date.now() < 36 * 3600 * 1000 : false
              return (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="td font-mono text-xs">{l.code}</td>
                  <td className="td">
                    <p className="font-medium text-slate-900">{l.products?.name}</p>
                    <p className="text-xs text-slate-400">recibido {dateShort(l.received_at)}</p>
                  </td>
                  <td className="td tabular-nums">
                    {kg(l.quantity_available, l.unit)}
                    {l.quantity_reserved > 0 && (
                      <p className="text-xs text-slate-400">{kg(l.quantity_reserved, l.unit)} reservado</p>
                    )}
                  </td>
                  <td className="td tabular-nums">{money(l.unit_cost)}</td>
                  <td className="td">
                    <span className={critico ? 'font-semibold text-red-600' : 'text-slate-500'}>
                      {dateShort(l.expires_at)}
                    </span>
                  </td>
                  <td className="td text-slate-500">{l.suppliers?.name ?? '—'}</td>
                  <td className="td text-right whitespace-nowrap">
                    <button onClick={() => setProceso(l)} title="Procesar (filetear)" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700">
                      <Scissors className="h-4 w-4" />
                    </button>
                    <button onClick={() => setAjuste(l)} title="Ajustar cantidad" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700">
                      <SlidersHorizontal className="h-4 w-4" />
                    </button>
                    <button onClick={() => setMerma(l)} title="Registrar merma" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {vista === 'movimientos' && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Fecha</th>
              <th className="th">Movimiento</th>
              <th className="th">Producto</th>
              <th className="th">Lote</th>
              <th className="th">Cantidad</th>
              <th className="th">Motivo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {movimientos.data?.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="td whitespace-nowrap text-slate-500">{dateTime(m.created_at)}</td>
                <td className="td">{MOVEMENT_LABEL[m.type] ?? m.type}</td>
                <td className="td font-medium text-slate-800">{m.products?.name ?? '—'}</td>
                <td className="td font-mono text-xs text-slate-500">{m.inventory_lots?.code ?? '—'}</td>
                <td className="td tabular-nums">{kg(m.quantity, m.unit)}</td>
                <td className="td text-slate-500">{m.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <AjusteModal lote={ajuste} onClose={() => setAjuste(null)} onDone={refrescar} />
      <MermaModal lote={merma} onClose={() => setMerma(null)} onDone={refrescar} />
      <ProcesoModal
        lote={proceso}
        productos={productos.data ?? []}
        ubicaciones={locales.data ?? []}
        onClose={() => setProceso(null)}
        onDone={refrescar}
      />

      <Card className="mt-4 p-4 text-xs text-slate-500">
        La vida útil configurada es de {String(operacion.data?.vida_util_fresco_dias ?? 3)} días para producto
        fresco y el sistema reserva siempre el lote más próximo a vencer.
      </Card>
    </>
  )
}

function AjusteModal({ lote, onClose, onDone }: { lote: InventoryLot | null; onClose: () => void; onDone: () => void }) {
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState('')

  const guardar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('adjust_lot_quantity', {
        _lot_id: lote!.id,
        _new_quantity: Number(cantidad),
        _reason: motivo.trim(),
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      onDone()
      onClose()
      setCantidad('')
      setMotivo('')
    },
  })

  return (
    <Modal
      open={!!lote}
      onClose={onClose}
      title={`Ajustar lote ${lote?.code ?? ''}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => guardar.mutate()}
            disabled={guardar.isPending || !cantidad || !motivo.trim()}
            className="btn-primary"
          >
            Guardar ajuste
          </button>
        </>
      }
    >
      {lote && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-900">{lote.products?.name}</p>
            <p className="text-slate-500">
              Actual {kg(lote.quantity_on_hand, lote.unit)} · reservado {kg(lote.quantity_reserved, lote.unit)}
            </p>
          </div>
          <div>
            <label className="label">Cantidad real contada</label>
            <input className="input" type="number" step="0.001" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej: 42.5" />
          </div>
          <div>
            <label className="label">Motivo (obligatorio)</label>
            <input className="input" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Diferencia de inventario, pérdida de peso en cámara…" />
          </div>
          <p className="text-xs text-slate-500">
            El ajuste queda registrado como movimiento y en la auditoría, con tu usuario y el motivo.
            No puede quedar por debajo de lo ya reservado.
          </p>
          {guardar.isError && <ErrorState error={guardar.error} />}
        </div>
      )}
    </Modal>
  )
}

function MermaModal({ lote, onClose, onDone }: { lote: InventoryLot | null; onClose: () => void; onDone: () => void }) {
  const [cantidad, setCantidad] = useState('')
  const [motivo, setMotivo] = useState<LossReason>('dano')
  const [notas, setNotas] = useState('')

  const guardar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('register_loss', {
        _product_id: lote!.product_id,
        _lot_id: lote!.id,
        _quantity: Number(cantidad),
        _reason: motivo,
        _notes: notas.trim() || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      onDone()
      onClose()
      setCantidad('')
      setNotas('')
    },
  })

  return (
    <Modal
      open={!!lote}
      onClose={onClose}
      title={`Registrar merma · ${lote?.products?.name ?? ''}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => guardar.mutate()} disabled={guardar.isPending || !cantidad} className="btn-danger">
            Registrar pérdida
          </button>
        </>
      }
    >
      {lote && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Lote {lote.code} · disponible {kg(lote.quantity_available, lote.unit)} · costo {money(lote.unit_cost)}/kg
          </div>
          <div>
            <label className="label">Cantidad perdida</label>
            <input className="input" type="number" step="0.001" value={cantidad} onChange={(e) => setCantidad(e.target.value)} />
          </div>
          <div>
            <label className="label">Motivo</label>
            <select className="input" value={motivo} onChange={(e) => setMotivo(e.target.value as LossReason)}>
              {Object.entries(LOSS_REASON_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Observaciones</label>
            <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
          {cantidad && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              Costo de la pérdida: {money(Number(cantidad) * lote.unit_cost)}
            </p>
          )}
          {guardar.isError && <ErrorState error={guardar.error} />}
        </div>
      )}
    </Modal>
  )
}

function ProcesoModal({
  lote, productos, ubicaciones, onClose, onDone,
}: {
  lote: InventoryLot | null
  productos: { id: string; name: string }[]
  ubicaciones: { id: string; name: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const [entrada, setEntrada] = useState('')
  const [salidaProducto, setSalidaProducto] = useState('')
  const [salidaCantidad, setSalidaCantidad] = useState('')
  const [ubicacion, setUbicacion] = useState('')
  const [notas, setNotas] = useState('')

  const rendimiento = useQuery({
    queryKey: ['yield', lote?.product_id, salidaProducto],
    enabled: !!lote && !!salidaProducto,
    queryFn: async () => {
      const { data } = await supabase
        .from('processing_yields')
        .select('avg_yield_pct, samples')
        .eq('source_product_id', lote!.product_id)
        .eq('output_product_id', salidaProducto)
        .maybeSingle()
      return data as { avg_yield_pct: number; samples: number } | null
    },
  })

  const procesar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('process_lot', {
        _source_lot_id: lote!.id,
        _input_quantity: Number(entrada),
        _outputs: [{ product_id: salidaProducto, quantity: Number(salidaCantidad) }],
        _notes: notas.trim() || null,
        _location_id: ubicacion || null,
      })
      if (error) throw error
      return data as { rendimiento_pct: number; merma: number }
    },
    onSuccess: () => {
      onDone()
      onClose()
      setEntrada('')
      setSalidaCantidad('')
      setNotas('')
    },
  })

  const rendActual =
    entrada && salidaCantidad ? (Number(salidaCantidad) / Number(entrada)) * 100 : null

  return (
    <Modal
      open={!!lote}
      onClose={onClose}
      title={`Procesar ${lote?.products?.name ?? ''}`}
      wide
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => procesar.mutate()}
            disabled={procesar.isPending || !entrada || !salidaProducto || !salidaCantidad}
            className="btn-accent"
          >
            Registrar proceso
          </button>
        </>
      }
    >
      {lote && (
        <div className="space-y-3">
          <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
            Lote {lote.code} · disponible {kg(lote.quantity_available, lote.unit)} a {money(lote.unit_cost)}/kg.
            El costo del pescado entero se traspasa completo al producto que sale, de modo que el filete
            queda con su costo real por kilo.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Kilos que entran a proceso</label>
              <input className="input" type="number" step="0.001" value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="40" />
            </div>
            <div>
              <label className="label">Dónde se procesa</label>
              <select className="input" value={ubicacion} onChange={(e) => setUbicacion(e.target.value)}>
                <option value="">—</option>
                {ubicaciones.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Producto que sale</label>
              <select className="input" value={salidaProducto} onChange={(e) => setSalidaProducto(e.target.value)}>
                <option value="">Seleccionar…</option>
                {productos.filter((p) => p.id !== lote.product_id).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Kilos obtenidos</label>
              <input className="input" type="number" step="0.001" value={salidaCantidad} onChange={(e) => setSalidaCantidad(e.target.value)} placeholder="18.4" />
            </div>
          </div>

          {rendimiento.data && (
            <p className="text-xs text-slate-500">
              Rendimiento histórico de este par: <strong>{rendimiento.data.avg_yield_pct}%</strong> en{' '}
              {rendimiento.data.samples} proceso(s).
            </p>
          )}

          {rendActual !== null && Number(entrada) > 0 && (
            <div className="rounded-lg bg-sea-50 p-3 text-sm text-sea-900">
              Rendimiento de este proceso: <strong>{Math.round(rendActual * 10) / 10}%</strong> ·
              desecho {kg(Number(entrada) - Number(salidaCantidad))} ·
              costo resultante ≈ {money((Number(entrada) * lote.unit_cost) / Math.max(Number(salidaCantidad), 1))}/kg
            </div>
          )}

          <div>
            <label className="label">Observaciones</label>
            <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} placeholder="Fileteo en el terminal" />
          </div>

          {procesar.isError && <ErrorState error={procesar.error} />}
        </div>
      )}
    </Modal>
  )
}
