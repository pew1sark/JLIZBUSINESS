import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MessageCircle, Pencil, Plus, Trash2, Truck, Wallet } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { Card, CardHeader, ErrorState, Modal, Skeleton } from './ui'

export type ContactRole = 'logistica' | 'finanzas' | 'gerencia' | 'otro'

export interface Contacto {
  id: string
  customer_id: string
  role: ContactRole
  name: string
  position: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  notes: string | null
  is_primary: boolean
}

/** En un restaurante quien pide no es quien paga. Cada función tiene su gente. */
const ROL: Record<ContactRole, { label: string; hint: string; clase: string }> = {
  logistica: { label: 'Logística', hint: 'quien hace el pedido y recibe', clase: 'bg-sky-100 text-sky-800' },
  finanzas:  { label: 'Finanzas',  hint: 'quien paga las facturas',       clase: 'bg-emerald-100 text-emerald-800' },
  gerencia:  { label: 'Gerencia',  hint: 'para temas comerciales',        clase: 'bg-violet-100 text-violet-800' },
  otro:      { label: 'Otro',      hint: '',                              clase: 'bg-slate-100 text-slate-600' },
}

const vacio = (customer_id: string): Partial<Contacto> => ({
  customer_id, role: 'logistica', name: '', position: '', phone: '', whatsapp: '', email: '',
  notes: '', is_primary: true,
})

export function ContactosCliente({ customerId }: { customerId: string }) {
  const qc = useQueryClient()
  const [editar, setEditar] = useState<Partial<Contacto> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const contactos = useQuery({
    queryKey: ['customer-contacts', customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_contacts').select('*').eq('customer_id', customerId)
        .order('role').order('is_primary', { ascending: false })
      if (error) throw error
      return data as Contacto[]
    },
  })

  const guardar = useMutation({
    mutationFn: async (c: Partial<Contacto>) => {
      const fila = {
        customer_id: customerId, role: c.role ?? 'otro', name: (c.name ?? '').trim(),
        position: c.position?.trim() || null, phone: c.phone?.trim() || null,
        whatsapp: c.whatsapp?.trim() || null, email: c.email?.trim() || null,
        notes: c.notes?.trim() || null, is_primary: !!c.is_primary,
      }
      // Solo puede haber un principal por función: se baja el anterior.
      if (fila.is_primary) {
        await supabase.from('customer_contacts')
          .update({ is_primary: false })
          .eq('customer_id', customerId).eq('role', fila.role)
          .neq('id', c.id ?? '00000000-0000-0000-0000-000000000000')
      }
      const { error } = c.id
        ? await supabase.from('customer_contacts').update(fila).eq('id', c.id)
        : await supabase.from('customer_contacts').insert(fila)
      if (error) throw error
    },
    onSuccess: () => {
      setEditar(null); setError(null)
      qc.invalidateQueries({ queryKey: ['customer-contacts', customerId] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const borrar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('customer_contacts').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer-contacts', customerId] }),
  })

  const porRol = (r: ContactRole) => (contactos.data ?? []).filter((c) => c.role === r)

  return (
    <Card>
      <CardHeader
        title="Contactos"
        action={
          <button className="text-xs font-medium text-navy-600 hover:underline"
            onClick={() => setEditar(vacio(customerId))}>
            <Plus className="mr-1 inline h-3.5 w-3.5" />Agregar
          </button>
        }
      />

      {contactos.isLoading && <Skeleton className="m-4 h-24" />}
      {contactos.isError && <div className="p-4"><ErrorState error={contactos.error} /></div>}

      {contactos.data?.length === 0 && (
        <p className="px-5 py-6 text-center text-sm text-slate-400">
          Sin contactos. Conviene separar <span className="font-medium">quién pide</span> de{' '}
          <span className="font-medium">quién paga</span>: así el recordatorio de cobro no le llega
          al chef ni la confirmación del pedido al contador.
        </p>
      )}

      <div className="divide-y divide-slate-50">
        {(['logistica', 'finanzas', 'gerencia', 'otro'] as ContactRole[]).flatMap((r) =>
          porRol(r).map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <span className={clsx('badge shrink-0', ROL[c.role].clase)}>
                {c.role === 'logistica' ? <Truck className="h-3 w-3" />
                 : c.role === 'finanzas' ? <Wallet className="h-3 w-3" /> : null}
                {ROL[c.role].label}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">
                  {c.name}
                  {c.is_primary && <span className="ml-2 text-[11px] text-slate-400">principal</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {[c.position, c.phone, c.email].filter(Boolean).join(' · ') || ROL[c.role].hint}
                </p>
                {c.notes && <p className="mt-0.5 text-xs text-slate-400 italic">{c.notes}</p>}
              </div>
              <div className="flex gap-1">
                {c.whatsapp && (
                  <a className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
                    target="_blank" rel="noreferrer" title="Escribir por WhatsApp"
                    href={`https://wa.me/${c.whatsapp.replace(/\D/g, '')}`}>
                    <MessageCircle className="h-4 w-4" />
                  </a>
                )}
                <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                  onClick={() => setEditar(c)} title="Editar">
                  <Pencil className="h-4 w-4" />
                </button>
                <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                  title="Eliminar"
                  onClick={() => { if (confirm(`¿Eliminar el contacto ${c.name}?`)) borrar.mutate(c.id) }}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )),
        )}
      </div>

      {editar && (
        <Modal open onClose={() => setEditar(null)}
          title={editar.id ? 'Editar contacto' : 'Nuevo contacto'}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setEditar(null)}>Cancelar</button>
              <button className="btn-primary"
                disabled={!editar.name?.trim() || guardar.isPending}
                onClick={() => guardar.mutate(editar)}>
                Guardar
              </button>
            </>
          }>
          <div className="space-y-3">
            {error && <ErrorState error={error} />}
            <label className="block">
              <span className="label">Función</span>
              <select className="input" value={editar.role}
                onChange={(e) => setEditar({ ...editar, role: e.target.value as ContactRole })}>
                {(Object.keys(ROL) as ContactRole[]).map((r) => (
                  <option key={r} value={r}>
                    {ROL[r].label}{ROL[r].hint ? ` — ${ROL[r].hint}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="label">Nombre</span>
                <input className="input" value={editar.name ?? ''}
                  onChange={(e) => setEditar({ ...editar, name: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">Cargo</span>
                <input className="input" value={editar.position ?? ''} placeholder="Opcional"
                  onChange={(e) => setEditar({ ...editar, position: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">Teléfono</span>
                <input className="input" value={editar.phone ?? ''}
                  onChange={(e) => setEditar({ ...editar, phone: e.target.value })} />
              </label>
              <label className="block">
                <span className="label">WhatsApp</span>
                <input className="input" value={editar.whatsapp ?? ''} placeholder="+569…"
                  onChange={(e) => setEditar({ ...editar, whatsapp: e.target.value })} />
              </label>
              <label className="block sm:col-span-2">
                <span className="label">Correo</span>
                <input className="input" type="email" value={editar.email ?? ''}
                  onChange={(e) => setEditar({ ...editar, email: e.target.value })} />
              </label>
              <label className="block sm:col-span-2">
                <span className="label">Nota</span>
                <input className="input" value={editar.notes ?? ''}
                  placeholder="Ej: recibe solo hasta las 11:00"
                  onChange={(e) => setEditar({ ...editar, notes: e.target.value })} />
              </label>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" className="rounded border-slate-300" checked={!!editar.is_primary}
                onChange={(e) => setEditar({ ...editar, is_primary: e.target.checked })} />
              Es el contacto principal de esta función
            </label>
          </div>
        </Modal>
      )}
    </Card>
  )
}
