import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check, Copy, Loader2, Mail, ShieldCheck, ShieldOff, Trash2, UserPlus,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import type { AppRole, Profile } from '../../lib/types'
import { ROLE_LABEL } from '../../lib/constants'
import { dateShort, dateTime, initials, relative } from '../../lib/format'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Pestanas, Skeleton, TableWrap } from '../../components/ui'

const ROLES: AppRole[] = ['admin', 'finanzas', 'ventas', 'compras', 'inventario', 'empaque', 'reparto']

const ROL_ESTILO: Record<AppRole, string> = {
  admin: 'bg-navy-100 text-navy-800',
  finanzas: 'bg-violet-100 text-violet-700',
  ventas: 'bg-blue-100 text-blue-700',
  compras: 'bg-amber-100 text-amber-800',
  inventario: 'bg-sea-100 text-sea-800',
  empaque: 'bg-emerald-100 text-emerald-700',
  reparto: 'bg-slate-200 text-slate-700',
}

const RECURSOS: { key: string; label: string }[] = [
  { key: 'orders', label: 'Pedidos' },
  { key: 'customers', label: 'Clientes' },
  { key: 'products', label: 'Productos' },
  { key: 'inventory', label: 'Inventario' },
  { key: 'lots', label: 'Lotes' },
  { key: 'losses', label: 'Mermas' },
  { key: 'purchases', label: 'Compras' },
  { key: 'suppliers', label: 'Proveedores' },
  { key: 'deliveries', label: 'Entregas' },
  { key: 'payments', label: 'Pagos' },
  { key: 'reports', label: 'Reportes' },
  { key: 'audit', label: 'Auditoría' },
]
const ACCIONES = ['read', 'create', 'update'] as const
const ACCION_LABEL: Record<string, string> = { read: 'Ver', create: 'Crear', update: 'Editar' }

interface Invitacion {
  id: string
  email: string
  full_name: string | null
  role: AppRole
  notes: string | null
  created_at: string
  expires_at: string
  used_at: string | null
}

type Pestana = 'usuarios' | 'invitaciones' | 'permisos'

export function Trabajadores() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [pestana, setPestana] = useState<Pestana>('usuarios')
  const [invitando, setInvitando] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const usuarios = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name, phone, avatar_url, role, is_active, created_at')
        .order('created_at')
      if (error) throw error
      return data as Profile[]
    },
  })

  const invitaciones = useQuery({
    queryKey: ['invitaciones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_invitations')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Invitacion[]
    },
  })

  const permisos = useQuery({
    queryKey: ['role-permissions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('role_permissions').select('*')
      if (error) throw error
      return new Set((data as { role: string; resource: string; action: string }[]).map(
        (p) => `${p.role}|${p.resource}|${p.action}`,
      ))
    },
  })

  const cambiarRol = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: AppRole }) => {
      const { error } = await supabase.rpc('set_user_role', { _user_id: id, _role: role })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usuarios'] }),
  })

  const cambiarEstado = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await supabase.rpc('set_user_active', { _user_id: id, _active: activo })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['usuarios'] }),
  })

  const anular = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('revoke_invitation', { _id: id })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitaciones'] }),
  })

  const cambiarPermiso = useMutation({
    mutationFn: async ({ role, resource, action, enabled }: {
      role: AppRole; resource: string; action: string; enabled: boolean
    }) => {
      const { error } = await supabase.rpc('set_role_permission', {
        _role: role, _resource: resource, _action: action, _enabled: enabled,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['role-permissions'] }),
  })

  const pendientes = (invitaciones.data ?? []).filter((i) => !i.used_at)
  const activos = (usuarios.data ?? []).filter((u) => u.is_active).length
  const enlaceRegistro = `${window.location.origin}${import.meta.env.BASE_URL}#/login`

  return (
    <>
      <PageHeader
        title="Cuentas y accesos"
        subtitle="Control interno de usuarios, roles y permisos · solo el administrador"
        actions={
          <button onClick={() => setInvitando(true)} className="btn-primary">
            <UserPlus className="h-4 w-4" /> Crear acceso
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Resumen label="Usuarios activos" valor={String(activos)} />
        <Resumen label="Cuentas totales" valor={String(usuarios.data?.length ?? 0)} />
        <Resumen label="Invitaciones pendientes" valor={String(pendientes.length)} />
        <Resumen label="Administradores" valor={String((usuarios.data ?? []).filter((u) => u.role === 'admin' && u.is_active).length)} />
      </div>

      <div className="mb-4">
        <Pestanas
          valor={pestana}
          onChange={setPestana}
          opciones={[
            { id: 'usuarios', label: 'Usuarios' },
            { id: 'invitaciones', label: 'Invitaciones', badge: pendientes.length || '' },
            { id: 'permisos', label: 'Permisos por rol' },
          ]}
        />
      </div>

      {cambiarRol.isError && <div className="mb-3"><ErrorState error={cambiarRol.error} /></div>}
      {cambiarEstado.isError && <div className="mb-3"><ErrorState error={cambiarEstado.error} /></div>}
      {cambiarPermiso.isError && <div className="mb-3"><ErrorState error={cambiarPermiso.error} /></div>}

      {pestana === 'usuarios' && (
        <>
          {usuarios.isLoading && <Skeleton className="h-56" />}
          {!!usuarios.data?.length && (
            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Persona</th>
                  <th className="th">Rol</th>
                  <th className="th">Estado</th>
                  <th className="th">Desde</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usuarios.data.map((u) => {
                  const soyYo = u.id === profile?.id
                  return (
                    <tr key={u.id} className={u.is_active ? 'hover:bg-slate-50' : 'bg-slate-50/60 opacity-70'}>
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-100 text-xs font-semibold text-navy-800">
                            {initials(u.full_name || u.email)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-slate-900">
                              {u.full_name || '—'}
                              {soyYo && <span className="ml-1 text-xs text-slate-400">(tú)</span>}
                            </p>
                            <p className="truncate text-xs text-slate-400">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="td">
                        <select
                          value={u.role}
                          disabled={cambiarRol.isPending}
                          onChange={(e) => cambiarRol.mutate({ id: u.id, role: e.target.value as AppRole })}
                          className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${ROL_ESTILO[u.role]}`}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="td">
                        <span className={`badge ${u.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                          {u.is_active ? 'Activo' : 'Desactivado'}
                        </span>
                      </td>
                      <td className="td text-xs text-slate-500">{dateShort(u.created_at)}</td>
                      <td className="td text-right">
                        <button
                          onClick={() => cambiarEstado.mutate({ id: u.id, activo: !u.is_active })}
                          disabled={soyYo || cambiarEstado.isPending}
                          title={soyYo ? 'No puedes desactivar tu propia cuenta' : u.is_active ? 'Desactivar' : 'Activar'}
                          className="btn-secondary px-3 py-1.5 text-xs disabled:opacity-40"
                        >
                          {u.is_active ? <ShieldOff className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                          {u.is_active ? 'Desactivar' : 'Activar'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </TableWrap>
          )}
          <Card className="mt-3 p-4 text-xs text-slate-500">
            Al desactivar una cuenta, la sesión deja de funcionar en el próximo ingreso y la persona
            no puede volver a entrar. No se elimina: su historial de pedidos, preparaciones y entregas
            se conserva para la auditoría.
          </Card>
        </>
      )}

      {pestana === 'invitaciones' && (
        <>
          <Card className="mb-3 flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <p className="font-medium text-slate-800">Enlace para que se registren</p>
              <p className="text-xs text-slate-500">
                Solo funciona para los correos que invitaste. Cualquier otro queda rechazado.
              </p>
            </div>
            <button
              onClick={() => {
                navigator.clipboard.writeText(enlaceRegistro)
                setCopiado(true)
                setTimeout(() => setCopiado(false), 2000)
              }}
              className="btn-secondary"
            >
              {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiado ? '¡Copiado!' : 'Copiar enlace'}
            </button>
          </Card>

          {invitaciones.isLoading && <Skeleton className="h-40" />}
          {invitaciones.data?.length === 0 && (
            <Card>
              <EmptyState
                title="Sin invitaciones"
                hint="Crea un acceso, envíale el enlace a la persona y al registrarse entra directo con el rol que le asignaste."
                icon={<Mail className="h-8 w-8" />}
              />
            </Card>
          )}

          {!!invitaciones.data?.length && (
            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Correo</th>
                  <th className="th">Nombre</th>
                  <th className="th">Rol asignado</th>
                  <th className="th">Estado</th>
                  <th className="th">Vence</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invitaciones.data.map((i) => (
                  <tr key={i.id} className="hover:bg-slate-50">
                    <td className="td font-medium text-slate-800">{i.email}</td>
                    <td className="td text-slate-600">{i.full_name ?? '—'}</td>
                    <td className="td">
                      <span className={`badge ${ROL_ESTILO[i.role]}`}>{ROLE_LABEL[i.role]}</span>
                    </td>
                    <td className="td">
                      {i.used_at ? (
                        <span className="badge bg-emerald-100 text-emerald-700">
                          Usada {relative(i.used_at)}
                        </span>
                      ) : new Date(i.expires_at) < new Date() ? (
                        <span className="badge bg-red-100 text-red-700">Vencida</span>
                      ) : (
                        <span className="badge bg-amber-100 text-amber-800">Pendiente</span>
                      )}
                    </td>
                    <td className="td text-xs text-slate-500">{dateTime(i.expires_at)}</td>
                    <td className="td text-right">
                      {!i.used_at && (
                        <button
                          onClick={() => anular.mutate(i.id)}
                          disabled={anular.isPending}
                          className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </>
      )}

      {pestana === 'permisos' && (
        <>
          <Card className="mb-3 p-4 text-xs text-slate-500">
            Esta matriz es la autoridad real: la base de datos consulta estos permisos en cada
            consulta y en cada función. El administrador siempre tiene acceso total y no es editable.
            Bodega, empaque y reparto además trabajan sobre vistas sin precios ni costos.
          </Card>

          {permisos.isLoading && <Skeleton className="h-72" />}
          {permisos.data && (
            <div className="card overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th sticky left-0 bg-slate-50">Recurso</th>
                    {ROLES.filter((r) => r !== 'admin').map((r) => (
                      <th key={r} className="th text-center">{ROLE_LABEL[r]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {RECURSOS.map((rec) => (
                    <tr key={rec.key}>
                      <td className="td sticky left-0 bg-white font-medium text-slate-800">{rec.label}</td>
                      {ROLES.filter((r) => r !== 'admin').map((rol) => (
                        <td key={rol} className="td">
                          <div className="flex justify-center gap-1">
                            {ACCIONES.map((acc) => {
                              const activo = permisos.data.has(`${rol}|${rec.key}|${acc}`)
                              return (
                                <button
                                  key={acc}
                                  title={`${ACCION_LABEL[acc]} ${rec.label.toLowerCase()}`}
                                  onClick={() =>
                                    cambiarPermiso.mutate({
                                      role: rol, resource: rec.key, action: acc, enabled: !activo,
                                    })
                                  }
                                  className={`h-7 w-7 rounded text-[10px] font-semibold transition-colors ${
                                    activo
                                      ? 'bg-sea-500 text-white hover:bg-sea-600'
                                      : 'bg-slate-100 text-slate-300 hover:bg-slate-200'
                                  }`}
                                >
                                  {ACCION_LABEL[acc][0]}
                                </button>
                              )
                            })}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-400">V = ver · C = crear · E = editar</p>
        </>
      )}

      <InvitarModal open={invitando} onClose={() => setInvitando(false)} />
    </>
  )
}

function InvitarModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [rol, setRol] = useState<AppRole>('reparto')
  const [notas, setNotas] = useState('')

  const invitar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('invite_user', {
        _email: email, _role: rol, _full_name: nombre, _notes: notas,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invitaciones'] })
      onClose()
      setEmail('')
      setNombre('')
      setNotas('')
    },
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Crear acceso"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => invitar.mutate()} disabled={invitar.isPending || !email.trim()} className="btn-primary">
            {invitar.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Autorizar
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Correo de la persona</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="bodega@bilagay.cl" />
        </div>
        <div>
          <label className="label">Nombre</label>
          <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Juan Pérez" />
        </div>
        <div>
          <label className="label">Rol</label>
          <select className="input" value={rol} onChange={(e) => setRol(e.target.value as AppRole)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">{DESCRIPCION_ROL[rol]}</p>
        </div>
        <div>
          <label className="label">Nota interna</label>
          <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>
        <div className="rounded-lg bg-navy-50 p-3 text-xs text-navy-800">
          <p className="font-medium">Cómo funciona</p>
          <p className="mt-0.5 text-navy-700/80">
            La persona entra al enlace del sistema, elige «Crear cuenta» con este mismo correo y
            define su contraseña. Queda con el rol que asignaste aquí. Nadie que no esté en esta
            lista puede registrarse. La invitación vence en 30 días.
          </p>
        </div>
        {invitar.isError && <ErrorState error={invitar.error} />}
      </div>
    </Modal>
  )
}

const DESCRIPCION_ROL: Record<AppRole, string> = {
  admin: 'Acceso total, incluidos costos, márgenes, finanzas y esta pantalla.',
  finanzas: 'Cobros, pagos y cuentas por cobrar. No modifica inventario ni pedidos.',
  ventas: 'Clientes, pedidos y precios de venta. No ve costos ni compras.',
  compras: 'Proveedores, compras y recepción de mercadería.',
  inventario: 'Portal móvil: stock, lotes, preparación y mermas. Sin precios ni costos.',
  empaque: 'Portal móvil: preparar y pesar pedidos. Sin precios ni costos.',
  reparto: 'Portal móvil: solo su hoja de ruta, stock y reportes. Sin precios ni costos.',
}

function Resumen({ label, valor }: { label: string; valor: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{valor}</p>
    </Card>
  )
}
