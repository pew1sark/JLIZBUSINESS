import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { History, Pencil, Plus, Search, TrendingUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useCategories, useOperacion, useSpecies, useStock } from '../../lib/queries'
import type { Product, ProductStock } from '../../lib/types'
import { dateTime, kg, money, pct } from '../../lib/format'
import { Card, ErrorState, Modal, PageHeader, Skeleton, TableWrap } from '../../components/ui'

interface Form {
  id?: string
  name: string
  sku: string
  species_id: string
  category_id: string
  presentation: string
  base_unit: 'kg' | 'unidad' | 'caja' | 'bandeja'
  min_stock: string
  sale_price: string
  shelf_life_days: string
  status: 'activo' | 'inactivo'
}

const vacio: Form = {
  name: '', sku: '', species_id: '', category_id: '', presentation: '',
  base_unit: 'kg', min_stock: '0', sale_price: '0', shelf_life_days: '3', status: 'activo',
}

export function Productos() {
  const qc = useQueryClient()
  const stock = useStock()
  const categorias = useCategories()
  const especies = useSpecies()
  const operacion = useOperacion()
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [historialDe, setHistorialDe] = useState<ProductStock | null>(null)

  const markup = Number(operacion.data?.markup_objetivo_pct ?? 50)

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return stock.data ?? []
    return (stock.data ?? []).filter(
      (p) => p.name.toLowerCase().includes(t) || (p.sku ?? '').toLowerCase().includes(t),
    )
  }, [stock.data, busca])

  const guardar = useMutation({
    mutationFn: async (f: Form) => {
      const fila = {
        name: f.name.trim(),
        sku: f.sku.trim() || null,
        species_id: f.species_id || null,
        category_id: f.category_id || null,
        presentation: f.presentation.trim() || null,
        base_unit: f.base_unit,
        min_stock: Number(f.min_stock) || 0,
        sale_price: Number(f.sale_price) || 0,
        shelf_life_days: Number(f.shelf_life_days) || null,
        status: f.status,
      }
      const { error } = f.id
        ? await supabase.from('products').update(fila).eq('id', f.id)
        : await supabase.from('products').insert(fila)
      if (error) throw error
    },
    onSuccess: () => {
      setForm(null)
      qc.invalidateQueries({ queryKey: ['stock'] })
      qc.invalidateQueries({ queryKey: ['products'] })
    },
  })

  const historial = useQuery({
    queryKey: ['price-history', historialDe?.product_id],
    enabled: !!historialDe,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('product_price_history')
        .select('price, previous_price, cost_reference, created_at')
        .eq('product_id', historialDe!.product_id)
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data as { price: number; previous_price: number | null; cost_reference: number | null; created_at: string }[]
    },
  })

  async function abrirEdicion(p: ProductStock) {
    const { data } = await supabase.from('products').select('*').eq('id', p.product_id).single()
    const d = data as Product
    setForm({
      id: d.id, name: d.name, sku: d.sku ?? '', species_id: d.species_id ?? '',
      category_id: d.category_id ?? '', presentation: d.presentation ?? '',
      base_unit: d.base_unit as Form['base_unit'], min_stock: String(d.min_stock),
      sale_price: String(d.sale_price), shelf_life_days: String(d.shelf_life_days ?? ''),
      status: d.status === 'inactivo' ? 'inactivo' : 'activo',
    })
  }

  return (
    <>
      <PageHeader
        title="Productos"
        subtitle="Catálogo, precio de venta y margen sobre el costo real"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar producto…"
                className="input w-56 pl-9"
              />
            </div>
            <button onClick={() => setForm(vacio)} className="btn-primary">
              <Plus className="h-4 w-4" /> Nuevo producto
            </button>
          </>
        }
      />

      {stock.isError && <ErrorState error={stock.error} />}
      {stock.isLoading && <Skeleton className="h-64" />}

      {!!filtrados.length && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Producto</th>
              <th className="th">Disponible</th>
              <th className="th">Costo real</th>
              <th className="th">Precio venta</th>
              <th className="th">Margen</th>
              <th className="th">Mínimo</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtrados.map((p) => {
              const margen = p.sale_price > 0 ? ((p.sale_price - p.avg_cost) / p.sale_price) * 100 : 0
              const sugerido = Math.round(p.avg_cost * (1 + markup / 100))
              const bajoMinimo = p.min_stock > 0 && p.available < p.min_stock
              return (
                <tr key={p.product_id} className="hover:bg-slate-50">
                  <td className="td">
                    <p className="font-medium text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-400">{p.sku ?? 'sin código'}</p>
                  </td>
                  <td className="td">
                    <span className={bajoMinimo ? 'font-semibold text-amber-600' : 'text-slate-700'}>
                      {kg(p.available, p.base_unit)}
                    </span>
                    {p.reserved > 0 && (
                      <p className="text-xs text-slate-400">{kg(p.reserved, p.base_unit)} reservado</p>
                    )}
                  </td>
                  <td className="td tabular-nums">{money(p.avg_cost)}</td>
                  <td className="td tabular-nums font-medium">{money(p.sale_price)}</td>
                  <td className="td">
                    <span
                      className={`badge ${
                        margen >= margenObjetivo(markup) ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {pct(Math.round(margen * 10) / 10)}
                    </span>
                    {p.avg_cost > 0 && (
                      <p className="mt-0.5 text-xs text-slate-400">sugerido {money(sugerido)}</p>
                    )}
                  </td>
                  <td className="td text-slate-500">{kg(p.min_stock, p.base_unit)}</td>
                  <td className="td text-right whitespace-nowrap">
                    <button
                      onClick={() => setHistorialDe(p)}
                      title="Historial de precios"
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                    >
                      <History className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => abrirEdicion(p)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Editar producto' : 'Nuevo producto'}
        wide
        footer={
          <>
            <button onClick={() => setForm(null)} className="btn-secondary">Cancelar</button>
            <button
              onClick={() => form && guardar.mutate(form)}
              disabled={guardar.isPending || !form?.name.trim()}
              className="btn-primary"
            >
              Guardar
            </button>
          </>
        }
      >
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label">Nombre</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Merluza filete" />
            </div>
            <div>
              <label className="label">Código interno</label>
              <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="MER-FIL" />
            </div>
            <div>
              <label className="label">Presentación</label>
              <input className="input" value={form.presentation} onChange={(e) => setForm({ ...form, presentation: e.target.value })} placeholder="Filete sin piel" />
            </div>
            <div>
              <label className="label">Especie</label>
              <select className="input" value={form.species_id} onChange={(e) => setForm({ ...form, species_id: e.target.value })}>
                <option value="">—</option>
                {especies.data?.map((s) => <option key={s.id} value={s.id}>{s.common_name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Categoría</label>
              <select className="input" value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">—</option>
                {categorias.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Unidad de venta</label>
              <select className="input" value={form.base_unit} onChange={(e) => setForm({ ...form, base_unit: e.target.value as Form['base_unit'] })}>
                <option value="kg">Kilogramo</option>
                <option value="unidad">Unidad</option>
                <option value="bandeja">Bandeja</option>
                <option value="caja">Caja</option>
              </select>
            </div>
            <div>
              <label className="label">Stock mínimo</label>
              <input className="input" type="number" step="0.001" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} />
            </div>
            <div>
              <label className="label">Precio de venta (neto)</label>
              <input className="input" type="number" step="1" value={form.sale_price} onChange={(e) => setForm({ ...form, sale_price: e.target.value })} />
            </div>
            <div>
              <label className="label">Días de duración</label>
              <input className="input" type="number" value={form.shelf_life_days} onChange={(e) => setForm({ ...form, shelf_life_days: e.target.value })} />
            </div>
            <div>
              <label className="label">Estado</label>
              <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Form['status'] })}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </select>
            </div>
            <p className="text-xs text-slate-500 sm:col-span-2">
              Los precios son netos, sin IVA. Cada cambio de precio queda registrado con tu usuario y
              la fecha, según la regla acordada con el negocio.
            </p>
            {guardar.isError && <div className="sm:col-span-2"><ErrorState error={guardar.error} /></div>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!historialDe}
        onClose={() => setHistorialDe(null)}
        title={`Historial de precios · ${historialDe?.name ?? ''}`}
      >
        {historial.isLoading && <Skeleton className="h-24" />}
        {historial.data?.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">
            Todavía no hay cambios de precio registrados para este producto.
          </p>
        )}
        <div className="space-y-2">
          {historial.data?.map((h, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-900">{money(h.price)}</p>
                <p className="text-xs text-slate-400">{dateTime(h.created_at)}</p>
              </div>
              {h.previous_price != null && (
                <span className={`badge ${h.price >= h.previous_price ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                  <TrendingUp className="h-3 w-3" />
                  desde {money(h.previous_price)}
                </span>
              )}
            </div>
          ))}
        </div>
      </Modal>

      <Card className="mt-4 p-4 text-xs text-slate-500">
        El margen se calcula contra el costo real del inventario (incluye flete y costos de compra
        prorrateados, y el costo absorbido en los productos procesados). El precio sugerido usa el
        markup objetivo de {markup}% que definió el negocio.
      </Card>
    </>
  )
}

/** Umbral de margen saludable derivado del markup objetivo (50% markup ≈ 33% margen). */
function margenObjetivo(markupPct: number) {
  return (markupPct / (100 + markupPct)) * 100
}
