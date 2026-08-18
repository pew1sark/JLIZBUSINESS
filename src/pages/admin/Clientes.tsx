import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Pencil, Phone, Plus, Search, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Customer, CustomerType, Order } from '../../lib/types'
import {
  CUSTOMER_TYPE_LABEL, ORDER_STATUS_LABEL, ORDER_STATUS_STYLE,
  PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE,
} from '../../lib/constants'
import { dateShort, money, moneyShort, relative } from '../../lib/format'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, StatCard, TableWrap } from '../../components/ui'

interface Balance {
  customer_id: string
  name: string
  orders_count: number
  total_invoiced: number
  total_paid: number
  balance_due: number
  overdue: number
  last_order_at: string | null
}

interface Form {
  id?: string
  name: string
  company: string
  rut: string
  customer_type: CustomerType
  contact_name: string
  phone: string
  whatsapp: string
  email: string
  address: string
  comuna: string
  payment_terms_days: string
  credit_limit: string
  notes: string
}

const vacio: Form = {
  name: '', company: '', rut: '', customer_type: 'restaurante', contact_name: '', phone: '',
  whatsapp: '', email: '', address: '', comuna: '', payment_terms_days: '30',
  credit_limit: '0', notes: '',
}

export function Clientes() {
  const qc = useQueryClient()
  const [busca, setBusca] = useState('')
  const [form, setForm] = useState<Form | null>(null)
  const [verId, setVerId] = useState<string | null>(null)

  const clientes = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('customers').select('*').order('name')
      if (error) throw error
      return data as Customer[]
    },
  })

  const balances = useQuery({
    queryKey: ['customer-balance'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_customer_balance').select('*')
      if (error) throw error
      const map: Record<string, Balance> = {}
      for (const b of data as Balance[]) map[b.customer_id] = b
      return map
    },
  })

  const pedidosCliente = useQuery({
    queryKey: ['customer-orders', verId],
    enabled: !!verId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('id, code, status, order_date, total, amount_paid, payment_status')
        .eq('customer_id', verId)
        .order('order_date', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as Order[]
    },
  })

  const guardar = useMutation({
    mutationFn: async (f: Form) => {
      const fila = {
        name: f.name.trim(),
        company: f.company.trim() || null,
        rut: f.rut.trim() || null,
        customer_type: f.customer_type,
        contact_name: f.contact_name.trim() || null,
        phone: f.phone.trim() || null,
        whatsapp: f.whatsapp.trim() || null,
        email: f.email.trim() || null,
        address: f.address.trim() || null,
        comuna: f.comuna.trim() || null,
        payment_terms_days: Number(f.payment_terms_days) || 0,
        credit_limit: Number(f.credit_limit) || 0,
        notes: f.notes.trim() || null,
      }
      const { error } = f.id
        ? await supabase.from('customers').update(fila).eq('id', f.id)
        : await supabase.from('customers').insert(fila)
      if (error) throw error
    },
    onSuccess: () => {
      setForm(null)
      qc.invalidateQueries({ queryKey: ['customers'] })
    },
  })

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    const lista = clientes.data ?? []
    if (!t) return lista
    return lista.filter(
      (c) => c.name.toLowerCase().includes(t) || (c.comuna ?? '').toLowerCase().includes(t),
    )
  }, [clientes.data, busca])

  const totales = useMemo(() => {
    const b = Object.values(balances.data ?? {})
    return {
      porCobrar: b.reduce((n, x) => n + Number(x.balance_due), 0),
      vencido: b.reduce((n, x) => n + Number(x.overdue), 0),
      facturado: b.reduce((n, x) => n + Number(x.total_invoiced), 0),
    }
  }, [balances.data])

  const cliente = clientes.data?.find((c) => c.id === verId)
  const balance = verId ? balances.data?.[verId] : undefined

  function editar(c: Customer) {
    setForm({
      id: c.id, name: c.name, company: c.company ?? '', rut: c.rut ?? '',
      customer_type: c.customer_type, contact_name: c.contact_name ?? '', phone: c.phone ?? '',
      whatsapp: c.whatsapp ?? '', email: c.email ?? '', address: c.address ?? '',
      comuna: c.comuna ?? '', payment_terms_days: String(c.payment_terms_days),
      credit_limit: String(c.credit_limit), notes: '',
    })
  }

  return (
    <>
      <PageHeader
        title="Clientes"
        subtitle="Cartera, condiciones de pago y saldo pendiente"
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" className="input w-52 pl-9" />
            </div>
            <button onClick={() => setForm(vacio)} className="btn-primary">
              <Plus className="h-4 w-4" /> Nuevo cliente
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clientes activos" value={String(filtrados.filter((c) => c.status === 'activo').length)} />
        <StatCard label="Facturado histórico" value={moneyShort(totales.facturado)} />
        <StatCard label="Por cobrar" value={moneyShort(totales.porCobrar)} tone={totales.porCobrar > 0 ? 'warning' : 'default'} />
        <StatCard label="Vencido" value={moneyShort(totales.vencido)} tone={totales.vencido > 0 ? 'danger' : 'default'} />
      </div>

      {clientes.isError && <ErrorState error={clientes.error} />}
      {clientes.isLoading && <Skeleton className="mt-4 h-64" />}
      {filtrados.length === 0 && !clientes.isLoading && (
        <Card className="mt-4"><EmptyState title="Sin clientes" hint="Se cargan solos al importar el formulario de catálogo del cliente." /></Card>
      )}

      {filtrados.length > 0 && (
        <div className="mt-4">
          <TableWrap>
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Cliente</th>
                <th className="th">Tipo</th>
                <th className="th">Contacto</th>
                <th className="th">Crédito</th>
                <th className="th">Comprado</th>
                <th className="th">Saldo</th>
                <th className="th">Última compra</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtrados.map((c) => {
                const b = balances.data?.[c.id]
                const sobrepasado = c.credit_limit > 0 && (b?.balance_due ?? 0) > c.credit_limit
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="td">
                      <button onClick={() => setVerId(c.id)} className="text-left">
                        <p className="font-medium text-navy-800 hover:underline">{c.name}</p>
                        <p className="text-xs text-slate-400">{c.comuna ?? '—'}</p>
                      </button>
                    </td>
                    <td className="td">
                      <span className="badge bg-slate-100 text-slate-600">
                        {CUSTOMER_TYPE_LABEL[c.customer_type]}
                      </span>
                    </td>
                    <td className="td">
                      <div className="flex gap-2 text-xs text-slate-500">
                        {c.phone && (
                          <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-navy-700">
                            <Phone className="h-3 w-3" />{c.phone}
                          </a>
                        )}
                        {c.whatsapp && (
                          <a href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-emerald-600">
                            <MessageCircle className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="td text-xs text-slate-500">
                      {c.payment_terms_days} días · tope {moneyShort(c.credit_limit)}
                    </td>
                    <td className="td tabular-nums">{moneyShort(b?.total_invoiced ?? 0)}</td>
                    <td className="td">
                      <span className={`tabular-nums ${sobrepasado ? 'font-semibold text-red-600' : (b?.balance_due ?? 0) > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                        {money(b?.balance_due ?? 0)}
                      </span>
                      {(b?.overdue ?? 0) > 0 && (
                        <p className="text-xs text-red-500">{money(b!.overdue)} vencido</p>
                      )}
                    </td>
                    <td className="td text-xs text-slate-500">{relative(b?.last_order_at)}</td>
                    <td className="td text-right">
                      <button onClick={() => editar(c)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        </div>
      )}

      <Modal
        open={!!form}
        onClose={() => setForm(null)}
        title={form?.id ? 'Editar cliente' : 'Nuevo cliente'}
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
            <div>
              <label className="label">Nombre del local</label>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Tipo</label>
              <select className="input" value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value as CustomerType })}>
                {Object.entries(CUSTOMER_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            {([
              ['company', 'Razón social'], ['rut', 'RUT'], ['contact_name', 'Quién pide'],
              ['phone', 'Teléfono'], ['whatsapp', 'WhatsApp'], ['email', 'Correo'],
              ['address', 'Dirección de entrega'], ['comuna', 'Comuna'],
            ] as [keyof Form, string][]).map(([campo, etiqueta]) => (
              <div key={campo}>
                <label className="label">{etiqueta}</label>
                <input className="input" value={form[campo] as string} onChange={(e) => setForm({ ...form, [campo]: e.target.value })} />
              </div>
            ))}
            <div>
              <label className="label">Días de crédito</label>
              <input className="input" type="number" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} />
            </div>
            <div>
              <label className="label">Límite de crédito</label>
              <input className="input" type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} />
            </div>
            {guardar.isError && <div className="sm:col-span-2"><ErrorState error={guardar.error} /></div>}
          </div>
        )}
      </Modal>

      {verId && cliente && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={() => setVerId(null)}>
          <div className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{cliente.name}</h3>
                <p className="text-xs text-slate-500">
                  {CUSTOMER_TYPE_LABEL[cliente.customer_type]} · {cliente.comuna ?? ''}
                </p>
              </div>
              <button onClick={() => setVerId(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatCard label="Comprado" value={moneyShort(balance?.total_invoiced ?? 0)} />
                <StatCard label="Pagado" value={moneyShort(balance?.total_paid ?? 0)} />
                <StatCard label="Pendiente" value={moneyShort(balance?.balance_due ?? 0)} tone={(balance?.balance_due ?? 0) > 0 ? 'warning' : 'default'} />
                <StatCard label="Vencido" value={moneyShort(balance?.overdue ?? 0)} tone={(balance?.overdue ?? 0) > 0 ? 'danger' : 'default'} />
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <Dato k="Quién pide" v={cliente.contact_name} />
                <Dato k="Teléfono" v={cliente.phone} />
                <Dato k="Dirección" v={cliente.address} />
                <Dato k="Condición" v={`${cliente.payment_terms_days} días · tope ${money(cliente.credit_limit)}`} />
              </div>

              <h4 className="mt-5 mb-2 text-xs font-semibold tracking-wide text-navy-700 uppercase">
                Últimos pedidos
              </h4>
              {pedidosCliente.isLoading && <Skeleton className="h-24" />}
              {pedidosCliente.data?.length === 0 && (
                <p className="text-sm text-slate-400">Todavía no tiene pedidos registrados.</p>
              )}
              <div className="space-y-1.5">
                {pedidosCliente.data?.map((o) => (
                  <div key={o.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2">
                    <div>
                      <p className="font-mono text-xs text-slate-500">{o.code}</p>
                      <p className="text-xs text-slate-400">{dateShort(o.order_date)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`badge ${ORDER_STATUS_STYLE[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                      <span className={`badge ${PAYMENT_STATUS_STYLE[o.payment_status]}`}>
                        {PAYMENT_STATUS_LABEL[o.payment_status]}
                      </span>
                      <span className="w-20 text-right text-sm font-medium tabular-nums">{moneyShort(o.total)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Dato({ k, v }: { k: string; v: string | null }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{k}</p>
      <p className="text-slate-800">{v || '—'}</p>
    </div>
  )
}
