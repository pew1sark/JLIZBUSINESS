import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import type { AppNotification } from '../lib/types'
import { relative } from '../lib/format'

const KIND_STYLE: Record<AppNotification['kind'], string> = {
  info: 'bg-blue-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-red-500',
}

export function NotificationBell() {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  const { data = [] } = useQuery({
    queryKey: ['notifications', profile?.id],
    enabled: !!profile,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as AppNotification[]
    },
  })

  // Realtime: las notificaciones nuevas aparecen sin recargar.
  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel('notifications-feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, () => {
        qc.invalidateQueries({ queryKey: ['notifications'] })
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [profile, qc])

  const unread = data.filter((n) => !n.read_at).length

  async function markAllRead() {
    const ids = data.filter((n) => !n.read_at).map((n) => n.id)
    if (!ids.length) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids)
    qc.invalidateQueries({ queryKey: ['notifications'] })
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-slate-800">Notificaciones</p>
              {unread > 0 && (
                <button onClick={markAllRead} className="text-xs font-medium text-navy-600 hover:underline">
                  Marcar leídas
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {data.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-slate-400">Sin notificaciones</p>
              )}
              {data.map((n) => (
                <div
                  key={n.id}
                  className={clsx('flex gap-3 border-b border-slate-50 px-4 py-3', !n.read_at && 'bg-slate-50/70')}
                >
                  <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', KIND_STYLE[n.kind])} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">{n.title}</p>
                    {n.body && <p className="text-xs text-slate-500">{n.body}</p>}
                    <p className="mt-0.5 text-[11px] text-slate-400">{relative(n.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
