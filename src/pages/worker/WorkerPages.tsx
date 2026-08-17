import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Card, EmptyState, PhaseNotice, Skeleton } from '../../components/ui'
import { ROLE_LABEL } from '../../lib/constants'
import { relative } from '../../lib/format'
import type { AppNotification } from '../../lib/types'

export function MisTareas() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Mis tareas</h1>
      <PhaseNotice phase="Fase 4">
        Lista de tareas asignadas (tabla <code>tasks</code>) con botones grandes para completarlas en
        pocos pasos desde el teléfono.
      </PhaseNotice>
    </>
  )
}

export function Preparacion() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Preparación</h1>
      <PhaseNotice phase="Fase 4">
        Pantalla de empaque: pedidos por preparar, productos y kilos solicitados, registro del peso real
        por línea y confirmación con <code>finish_preparation()</code>, que descuenta el stock de los lotes
        reservados y recalcula el costo del pedido.
      </PhaseNotice>
    </>
  )
}

export function MisEntregas() {
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Mis entregas</h1>
      <PhaseNotice phase="Fase 4">
        Entregas asignadas del día con dirección, teléfono, monto y botones «En camino», «Llamar
        cliente», «Abrir mapa» y «Entregado» (función <code>complete_delivery()</code>, que además registra
        el cobro en terreno).
      </PhaseNotice>
    </>
  )
}

export function Avisos() {
  const qc = useQueryClient()
  const { data = [], isLoading } = useQuery({
    queryKey: ['worker-notifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data as AppNotification[]
    },
  })

  async function marcar(id: string) {
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    qc.invalidateQueries({ queryKey: ['worker-notifications'] })
  }

  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Avisos</h1>
      {isLoading && <Skeleton className="h-40" />}
      {!isLoading && data.length === 0 && <Card><EmptyState title="Sin avisos por ahora" /></Card>}
      <div className="space-y-2">
        {data.map((n) => (
          <Card key={n.id} className={`p-4 ${n.read_at ? 'opacity-60' : ''}`}>
            <p className="text-sm font-semibold text-slate-900">{n.title}</p>
            {n.body && <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>}
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-slate-400">{relative(n.created_at)}</span>
              {!n.read_at && (
                <button onClick={() => marcar(n.id)} className="text-xs font-medium text-navy-600">
                  Marcar leído
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}

export function Perfil() {
  const { profile, signOut } = useAuth()
  return (
    <>
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Mi perfil</h1>
      <Card className="divide-y divide-slate-100">
        {[
          ['Nombre', profile?.full_name],
          ['Correo', profile?.email],
          ['Teléfono', profile?.phone || '—'],
          ['Rol', profile ? ROLE_LABEL[profile.role] : '—'],
        ].map(([k, v]) => (
          <div key={k as string} className="flex items-center justify-between px-4 py-3">
            <span className="text-sm text-slate-500">{k}</span>
            <span className="text-sm font-medium text-slate-800">{v as string}</span>
          </div>
        ))}
      </Card>
      <button onClick={() => signOut()} className="btn-secondary mt-4 w-full">
        Cerrar sesión
      </button>
      <p className="mt-6 text-center text-xs text-slate-400">
        JLIZ Business · Fase 1 · Solicita a tu administrador cualquier cambio de rol.
      </p>
    </>
  )
}
