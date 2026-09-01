import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, MessageCircle, Pencil, Phone, Plus, Search, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { geocodificarLista } from '../../lib/geo'
import type { Customer, CustomerType } from '../../lib/types'
import { CUSTOMER_TYPE_LABEL } from '../../lib/constants'
import { money, moneyShort, relative } from '../../lib/format'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, StatCard, TableWrap } from '../../components/ui'
import { QuitarEntidad, type EntidadAQuitar } from '../../components/QuitarEntidad'

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
  const [quitar, setQuitar] = useState<EntidadAQuitar | null>(null)
  const [verEstado, setVerEstado] = useState<'activos' | 'inactivos' | 'todos'>('activos')
  const [form, setForm] = useState<Form | null>(null)
  const [ubicando, setUbicando] = useState<{ hecho: number; total: number } | null>(null)

  async function ubicarTodos(lista: Customer[]) {
    const faltan = lista.filter((c) => c.latitude == null && c.address)
    if (!faltan.length) return
    setUbicando({ hecho: 0, total: faltan.length })
    await geocodificarLista(
      faltan.map((c) => ({ id: c.id, address: c.address, comuna: c.comuna })),
      async (hecho, total, item, r) => {
        setUbicando({ hecho, total })
        if (r) {
          await supabase.rpc('set_customer_location', {
            _customer_id: item.id, _lat: r.lat, _lng: r.lng, _source: 'nominatim',
          })
        }
      },
    )
    setUbicando(null)
    qc.invalidateQueries({ queryKey: ['customers'] })
    qc.invalidateQueries({ queryKey: ['clientes-mapa'] })
  }

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
    const lista = (clientes.data ?? []).filter((c) =>
      verEstado === 'todos' ? true
      : verEstado === 'activos' ? c.status === 'activo'
      : c.status !== 'activo')
    if (!t) return lista
    return lista.filter(
      (c) => c.name.toLowerCase().includes(t) || (c.comuna ?? '').toLowerCase().includes(t)
        || (c.rut ?? '').toLowerCase().includes(t),
    )
  }, [clientes.data, busca, verEstado])

  const totales = useMemo(() => {
    const b = Object.values(balances.data ?? {})
    return {
      porCobrar: b.reduce((n, x) => n + Number(x.balance_due), 0),
      vencido: b.reduce((n, x) => n + Number(x.overdue), 0),
      facturado: b.reduce((n, x) => n + Number(x.total_invoiced), 0),
    }
  }, [balances.data])


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
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar nombre, comuna o RUT…" className="input w-52 pl-9" />
            </div>
            <select className="input w-auto" value={verEstado}
              onChange={(e) => setVerEstado(e.target.value as typeof verEstado)}>
              <option value="activos">Activos</option>
              <option value="inactivos">Desactivados</option>
              <option value="todos">Todos</option>
            </select>
            <button
              onClick={() => ubicarTodos(clientes.data ?? [])}
              disabled={!!ubicando}
              className="btn-secondary"
              title="Busca la dirección de cada cliente y guarda su ubicación"
            >
              <MapPin className="h-4 w-4" />
              {ubicando ? `Ubicando ${ubicando.hecho}/${ubicando.total}…` : 'Ubicar en el mapa'}
            </button>
            <button onClick={() => setForm(vacio)} className="btn-primary">
              <Plus className="h-4 w-4" /> Nuevo cliente
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clientes activos"
          value={String((clientes.data ?? []).filter((c) => c.status === 'activo').length)}
          hint={(() => {
            const n = (clientes.data ?? []).filter((c) => c.status !== 'activo').length
            return n ? `${n} desactivado(s)` : undefined
          })()} />
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
                  <tr key={c.id} className={`hover:bg-slate-50 ${c.status !== 'activo' ? 'opacity-60' : ''}`}>
                    <td className="td">
                      <Link to={`/clientes/${c.id}`} className="block">
                        <p className="font-medium text-navy-800 hover:underline">
                          {c.name}
                          {c.status !== 'activo' && (
                            <span className="ml-2 badge bg-amber-100 text-amber-800">desactivado</span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">
                          {c.comuna ?? '—'}
                          {c.latitude == null && <span className="ml-1 text-amber-600">· sin ubicación</span>}
                        </p>
                      </Link>
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
                    <td className="td text-right whitespace-nowrap">
                      <button onClick={() => editar(c)} title="Editar la ficha"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setQuitar({ tipo: 'cliente', id: c.id, nombre: c.name, estado: c.status })}
                        title="Desactivar o eliminar"
                        className="ml-1 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </TableWrap>
        </div>
      )}

      <QuitarEntidad entidad={quitar} onClose={() => setQuitar(null)}
        onHecho={() => {
          qc.invalidateQueries({ queryKey: ['customers'] })
          qc.invalidateQueries({ queryKey: ['customers-select'] })
        }} />

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

    </>
  )
}

