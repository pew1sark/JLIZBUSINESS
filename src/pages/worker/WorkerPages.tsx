import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Card, EmptyState, Skeleton } from '../../components/ui'
import { ROLE_LABEL } from '../../lib/constants'
import { relative } from '../../lib/format'
import type { AppNotification } from '../../lib/types'

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
        Pescadería Bilagay SpA · Solicita a tu administrador cualquier cambio de rol.
      </p>
    </>
  )
}
