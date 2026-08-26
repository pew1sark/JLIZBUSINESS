import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Link2, Loader2, PlugZap, RefreshCw, Unplug } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import { dateTime, relative } from '../../lib/format'
import { Card, CardHeader, ErrorState, Skeleton } from '../../components/ui'

interface Conexion {
  id: string
  label: string
  client_code: string | null
  client_name: string | null
  cpn_id: number | null
  status: 'activa' | 'revocada' | 'error'
  last_sync_at: string | null
  last_error: string | null
  created_at: string
}

interface Corrida {
  id: string
  resource: string
  trigger: string
  status: 'corriendo' | 'ok' | 'error'
  pages: number
  records_read: number
  records_saved: number
  error: string | null
  started_at: string
  finished_at: string | null
}

/** Llama a una Edge Function con la sesión del usuario. */
async function invocar<T>(nombre: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nombre, { body })
  if (error) {
    // El cuerpo del error trae el mensaje útil; el genérico no sirve de nada.
    const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null)
    throw new Error(detalle?.error ?? error.message)
  }
  if ((data as { ok?: boolean; error?: string })?.error) {
    throw new Error((data as { error: string }).error)
  }
  return data as T
}

export function BsaleConexion() {
  const qc = useQueryClient()
  const [token, setToken] = useState('')
  const [label, setLabel] = useState('Pescadería Bilagay')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const conexiones = useQuery({
    queryKey: ['bsale-conexiones'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bsale_connections').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data as Conexion[]
    },
  })

  const corridas = useQuery({
    queryKey: ['bsale-corridas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bsale_sync_runs').select('*').order('started_at', { ascending: false }).limit(10)
      if (error) throw error
      return data as Corrida[]
    },
  })

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['bsale-conexiones'] })
    qc.invalidateQueries({ queryKey: ['bsale-corridas'] })
  }

  const conectar = useMutation({
    mutationFn: () => invocar<{ ok: boolean; verificado?: { usuarios_visibles: number | null } }>(
      'bsale-connect', { label: label.trim(), token: token.trim() }),
    onSuccess: (r) => {
      setToken('')
      setError(null)
      setAviso(`Conectado. Bsale respondió correctamente${
        r.verificado?.usuarios_visibles != null ? ` (${r.verificado.usuarios_visibles} usuarios visibles)` : ''}.`)
      refrescar()
    },
    onError: (e) => { setAviso(null); setError(e instanceof Error ? e.message : String(e)) },
  })

  const sincronizar = useMutation({
    mutationFn: (payload: Record<string, unknown>) => invocar('bsale-sync', payload),
    onSuccess: (r) => {
      setError(null)
      setAviso(`Sincronización lista: ${JSON.stringify((r as { resumen?: unknown }).resumen)}`)
      refrescar()
    },
    onError: (e) => { setAviso(null); setError(e instanceof Error ? e.message : String(e)) },
  })

  const activa = conexiones.data?.find((c) => c.status === 'activa')
  const hoy = new Date()

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Conexión con Bsale" />

        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-600">
            Las compras se leen directamente de la API oficial de Bsale, no de planillas.
            El token queda guardado cifrado en el servidor: no se muestra nunca más ni viaja al navegador.
          </p>

          {error && <ErrorState error={error} />}
          {aviso && (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <Check className="mt-0.5 h-4 w-4 shrink-0" /> <span className="break-all">{aviso}</span>
            </div>
          )}

          {conexiones.isLoading && <Skeleton className="h-20" />}

          {activa ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <PlugZap className="h-5 w-5 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{activa.label}</p>
                  <p className="text-xs text-slate-500">
                    Conectada {relative(activa.created_at)}
                    {activa.client_code && ` · ${activa.client_code}`}
                    {activa.cpn_id && ` · instancia ${activa.cpn_id}`}
                  </p>
                  <p className="text-xs text-slate-500">
                    Última sincronización:{' '}
                    {activa.last_sync_at ? dateTime(activa.last_sync_at) : 'nunca'}
                  </p>
                </div>
              </div>

              {activa.last_error && (
                <p className="mt-2 flex items-start gap-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Último error: {activa.last_error}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn-primary px-3 py-1.5 text-xs" disabled={sincronizar.isPending}
                  onClick={() => sincronizar.mutate({
                    resource: 'documentos',
                    year: hoy.getFullYear(), month: hoy.getMonth() + 1,
                  })}>
                  {sincronizar.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <RefreshCw className="h-3.5 w-3.5" />}
                  Traer compras de este mes
                </button>
                <button className="btn-secondary px-3 py-1.5 text-xs" disabled={sincronizar.isPending}
                  onClick={() => sincronizar.mutate({ resource: 'recepciones' })}>
                  Traer recepciones
                </button>
                <button className="btn-secondary px-3 py-1.5 text-xs" disabled={sincronizar.isPending}
                  onClick={() => sincronizar.mutate({ resource: 'detalles', max_detalles: 120 })}>
                  Traer costos por producto
                </button>
              </div>

              <p className="mt-3 text-xs text-slate-500">
                Las compras vienen de dos recursos distintos de Bsale y se cruzan acá: el libro de
                compras trae al proveedor y los montos; la recepción de mercadería trae el costo de
                cada producto.
              </p>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-slate-200 p-4">
              <label className="block">
                <span className="label">Nombre de la conexión</span>
                <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label className="block">
                <span className="label">Access token de Bsale</span>
                <input className="input font-mono text-xs" type="password" value={token}
                  autoComplete="off" placeholder="Pégalo aquí; no se guarda en el navegador"
                  onChange={(e) => setToken(e.target.value)} />
                <span className="mt-1 block text-xs text-slate-400">
                  Se saca del panel de Bsale de la empresa. Antes de guardarlo lo probamos contra
                  la API: si no sirve, no se guarda.
                </span>
              </label>
              <button className="btn-primary" disabled={!token.trim() || conectar.isPending}
                onClick={() => conectar.mutate()}>
                {conectar.isPending
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Verificando…</>
                  : <><Link2 className="h-4 w-4" /> Conectar y verificar</>}
              </button>
            </div>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Últimas sincronizaciones" />
        {corridas.isLoading && <Skeleton className="m-5 h-24" />}
        {corridas.data?.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-slate-400">
            Todavía no se ha sincronizado nada
          </p>
        )}
        <div className="divide-y divide-slate-50">
          {corridas.data?.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <span className={clsx('badge',
                c.status === 'ok' ? 'bg-emerald-100 text-emerald-700'
                : c.status === 'error' ? 'bg-red-100 text-red-700'
                : 'bg-amber-100 text-amber-800')}>
                {c.status === 'ok' ? 'OK' : c.status === 'error' ? 'Error' : 'Corriendo'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-800">{c.resource}</p>
                <p className="text-xs text-slate-400">
                  {dateTime(c.started_at)} · {c.trigger}
                  {c.pages > 0 && ` · ${c.pages} página(s)`}
                </p>
                {c.error && <p className="mt-0.5 text-xs text-red-600">{c.error}</p>}
              </div>
              <span className="text-xs text-slate-500 tabular-nums">
                {c.records_read} leídos · {c.records_saved} guardados
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="flex items-start gap-3 p-4 text-xs text-slate-500">
        <Unplug className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>
          Para que Bsale avise en el momento en que entra una compra hay que activar sus webhooks:
          se solicita a <span className="font-medium">ayuda@bsale.app</span> indicando el RUT de la
          empresa y la URL del receptor. Mientras tanto, la sincronización manual y la programada
          traen lo mismo.
        </p>
      </Card>
    </div>
  )
}
