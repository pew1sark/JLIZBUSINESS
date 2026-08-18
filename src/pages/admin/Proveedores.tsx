import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Pencil, Phone, Plus, Star } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useSuppliers } from '../../lib/queries'
import type { Supplier } from '../../lib/types'
import { dateShort, money } from '../../lib/format'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, TableWrap } from '../../components/ui'

interface Form {
  id?: string
  name: string
  company: string
  rut: string
  contact_name: string
  phone: string
  whatsapp: string
  email: string
  address: string
  comuna: string
  payment_terms_days: string
  rating: string
  notes: string
}

const vacio: Form = {
  name: '', company: '', rut: '', contact_name: '', phone: '', whatsapp: '', email: '',
  address: '', comuna: '', payment_terms_days: '30', rating: '', notes: '',
}

export function Proveedores() {
  const qc = useQueryClient()
  const proveedores = useSuppliers()
  const [form, setForm] = useState<Form | null>(null)
  const [detalle, setDetalle] = useState<Supplier | null>(null)

  const compras = useQuery({
    queryKey: ['supplier-totals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchases')
        .select('supplier_id, total, purchase_date, payment_status')
        .neq('status', 'anulada')
      if (error) throw error
      const map: Record<string, { total: number; deuda: number; ultima: string | null; n: number }> = {}
      for (const p of data as { supplier_id: string; total: number; purchase_date: string; payment_status: string }[]) {
        const prev = map[p.supplier_id] ?? { total: 0, deuda: 0, ultima: null, n: 0 }
        prev.total += Number(p.total)
        prev.n += 1
        if (p.payment_status !== 'pagado') prev.deuda += Number(p.total)
        if (!prev.ultima || p.purchase_date > prev.ultima) prev.ultima = p.purchase_date
        map[p.supplier_id] = prev
      }
      return map
    },
  })

  const precios = useQuery({
    queryKey: ['supplier-products', detalle?.id],
    enabled: !!detalle,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('supplier_products')
        .select('last_price, avg_price, last_purchase_at, products(name, sku)')
        .eq('supplier_id', detalle!.id)
      if (error) throw error
      return data as unknown as {
        last_price: number | null; avg_price: number | null; last_purchase_at: string | null
        products: { name: string; sku: string | null } | null
      }[]
    },
  })

  const guardar = useMutation({
    mutationFn: async (f: Form) => {
      const fila = {
        name: f.name.trim(),
        company: f.company.trim() || null,
        rut: f.rut.trim() || null,
        contact_name: f.contact_name.trim() || null,
        phone: f.phone.trim() || null,
        whatsapp: f.whatsapp.trim() || null,
        email: f.email.trim() || null,
        address: f.address.trim() || null,
        comuna: f.comuna.trim() || null,
        payment_terms_days: Number(f.payment_terms_days) || 0,
        rating: f.rating ? Number(f.rating) : null,
        notes: f.notes.trim() || null,
      }
      const { error } = f.id
        ? await supabase.from('suppliers').update(fila).eq('id', f.id)
        : await supabase.from('suppliers').insert(fila)
      if (error) throw error
    },
    onSuccess: () => {
      setForm(null)
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })

  function editar(s: Supplier) {
    setForm({
      id: s.id, name: s.name, company: s.company ?? '', rut: s.rut ?? '',
      contact_name: s.contact_name ?? '', phone: s.phone ?? '', whatsapp: s.whatsapp ?? '',
      email: s.email ?? '', address: s.address ?? '', comuna: s.comuna ?? '',
      payment_terms_days: String(s.payment_terms_days), rating: s.rating ? String(s.rating) : '',
      notes: '',
    })
  }

  return (
    <>
      <PageHeader
        title="Proveedores"
        subtitle="Fichas, condiciones de pago y precios históricos por producto"
        actions={
          <button onClick={() => setForm(vacio)} className="btn-primary">
            <Plus className="h-4 w-4" /> Nuevo proveedor
          </button>
        }
      />

      {proveedores.isError && <ErrorState error={proveedores.error} />}
      {proveedores.isLoading && <Skeleton className="h-48" />}
      {proveedores.data?.length === 0 && (
        <Card><EmptyState title="Todavía no hay proveedores" hint="El negocio trabaja con 6 proveedores habituales del terminal pesquero." /></Card>
      )}

      {!!proveedores.data?.length && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Proveedor</th>
              <th className="th">Contacto</th>
              <th className="th">Pago</th>
              <th className="th">Compras</th>
              <th className="th">Por pagar</th>
              <th className="th">Evaluación</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {proveedores.data.map((s) => {
              const t = compras.data?.[s.id]
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="td">
                    <button onClick={() => setDetalle(s)} className="text-left">
                      <p className="font-medium text-navy-800 hover:underline">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.company ?? s.rut ?? '—'}</p>
                    </button>
                  </td>
                  <td className="td">
                    <p className="text-slate-700">{s.contact_name ?? '—'}</p>
                    <div className="flex gap-2 text-xs text-slate-400">
                      {s.phone && (
                        <a href={`tel:${s.phone}`} className="flex items-center gap-1 hover:text-navy-700">
                          <Phone className="h-3 w-3" />{s.phone}
                        </a>
                      )}
                      {s.whatsapp && (
                        <a href={`https://wa.me/${s.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-emerald-600">
                          <MessageCircle className="h-3 w-3" />WhatsApp
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="td text-slate-500">
                    {s.payment_terms_days > 0 ? `${s.payment_terms_days} días` : 'Contado'}
                  </td>
                  <td className="td">
                    <p className="tabular-nums">{money(t?.total ?? 0)}</p>
                    <p className="text-xs text-slate-400">
                      {t?.n ?? 0} compras · última {dateShort(t?.ultima)}
                    </p>
                  </td>
                  <td className={`td tabular-nums ${(t?.deuda ?? 0) > 0 ? 'font-medium text-amber-600' : 'text-slate-400'}`}>
                    {money(t?.deuda ?? 0)}
                  </td>
                  <td className="td">
                    <span className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`h-3.5 w-3.5 ${i < (s.rating ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
                        />
                      ))}
                    </span>
                  </td>
                  <td className="td text-right">
                    <button onClick={() => editar(s)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700">
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
        title={form?.id ? 'Editar proveedor' : 'Nuevo proveedor'}
        wide
        footer={
          <>
            <button onClick={() => setForm(null)} className="btn-secondary">Cancelar</button>
            <button onClick={() => form && guardar.mutate(form)} disabled={guardar.isPending || !form?.name.trim()} className="btn-primary">
              Guardar
            </button>
          </>
        }
      >
        {form && (
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['name', 'Nombre', 'Pesquera Chiloé'],
              ['company', 'Razón social', 'Pesquera Chiloé Ltda.'],
              ['rut', 'RUT', '76.543.210-9'],
              ['contact_name', 'Persona de contacto', 'Marcos Uribe'],
              ['phone', 'Teléfono', '+56 9 8123 4567'],
              ['whatsapp', 'WhatsApp', '+56981234567'],
              ['email', 'Correo', 'ventas@proveedor.cl'],
              ['address', 'Dirección', 'Terminal Pesquero, local 12'],
              ['comuna', 'Comuna', 'Lo Espejo'],
            ] as [keyof Form, string, string][]).map(([campo, etiqueta, ph]) => (
              <div key={campo}>
                <label className="label">{etiqueta}</label>
                <input
                  className="input"
                  value={form[campo] as string}
                  onChange={(e) => setForm({ ...form, [campo]: e.target.value })}
                  placeholder={ph}
                />
              </div>
            ))}
            <div>
              <label className="label">Días de pago</label>
              <input className="input" type="number" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} />
            </div>
            <div>
              <label className="label">Evaluación (1 a 5)</label>
              <select className="input" value={form.rating} onChange={(e) => setForm({ ...form, rating: e.target.value })}>
                <option value="">Sin evaluar</option>
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {guardar.isError && <div className="sm:col-span-2"><ErrorState error={guardar.error} /></div>}
          </div>
        )}
      </Modal>

      <Modal open={!!detalle} onClose={() => setDetalle(null)} title={detalle?.name ?? ''} wide>
        {detalle && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Dato k="Empresa" v={detalle.company} />
              <Dato k="RUT" v={detalle.rut} />
              <Dato k="Contacto" v={detalle.contact_name} />
              <Dato k="Teléfono" v={detalle.phone} />
              <Dato k="Dirección" v={detalle.address} />
              <Dato k="Condición de pago" v={detalle.payment_terms_days > 0 ? `${detalle.payment_terms_days} días` : 'Contado'} />
            </div>

            <div>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-navy-700 uppercase">
                Precios por producto
              </h4>
              {precios.isLoading && <Skeleton className="h-20" />}
              {precios.data?.length === 0 && (
                <p className="text-sm text-slate-400">Aún no hay compras registradas a este proveedor.</p>
              )}
              <div className="space-y-1.5">
                {precios.data?.map((p, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{p.products?.name}</p>
                      <p className="text-xs text-slate-400">última compra {dateShort(p.last_purchase_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium tabular-nums">{money(p.last_price ?? 0)}/kg</p>
                      <p className="text-xs text-slate-400">promedio {money(p.avg_price ?? 0)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}

function Dato({ k, v }: { k: string; v: string | number | null }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{k}</p>
      <p className="text-slate-800">{v || '—'}</p>
    </div>
  )
}
