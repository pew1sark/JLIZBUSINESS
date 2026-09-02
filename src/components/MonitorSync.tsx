import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, Check, Clock, RefreshCw, Radio } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { useMonitorSync, type CorridaSync, type EstadoSync } from '../lib/queries'
import { dateTime, relative, timeOnly } from '../lib/format'
import { Card, CardHeader, ErrorState, Skeleton } from './ui'

/**
 * La consola de la sincronización con Bsale.
 *
 * Que el cron se cayera no se notaba: el panel decía "Conectada" y una fecha,
 * mientras once corridas seguidas terminaban en error. Acá se ve lo que está
 * pasando ahora —cada corrida aparece en el momento en que arranca y cambia
 * sola cuando termina, por Realtime— y lo que quedó sin entrar.
 *
 * El estado grande mira SOLO las corridas automáticas: una sincronización
 * manual no prueba que el trabajo programado siga vivo. El registro de abajo
 * muestra todas, con su origen a la vista.
 */

const TONO = {
  bien:   { caja: 'border-emerald-200 bg-emerald-50', punto: 'bg-emerald-500', texto: 'text-emerald-900', suave: 'text-emerald-700' },
  mal:    { caja: 'border-red-200 bg-red-50',         punto: 'bg-red-500',     texto: 'text-red-900',     suave: 'text-red-700' },
  aviso:  { caja: 'border-amber-200 bg-amber-50',     punto: 'bg-amber-500',   texto: 'text-amber-900',   suave: 'text-amber-700' },
  neutro: { caja: 'border-sea-200 bg-sea-50',         punto: 'bg-sea-500',     texto: 'text-navy-900',    suave: 'text-navy-700' },
} as const

const ESTADO: Record<EstadoSync, { titulo: string; tono: keyof typeof TONO }> = {
  ok:        { titulo: 'Sincronización al día',        tono: 'bien' },
  corriendo: { titulo: 'Sincronizando ahora',          tono: 'neutro' },
  caida:     { titulo: 'Sincronización caída',         tono: 'mal' },
  trabada:   { titulo: 'Corrida trabada',              tono: 'mal' },
  apagada:   { titulo: 'Trabajo programado apagado',   tono: 'mal' },
  atrasada:  { titulo: 'Hace rato que no entra nada',  tono: 'aviso' },
  sin_datos: { titulo: 'Todavía no ha corrido',        tono: 'neutro' },
}

export function MonitorSync() {
  const qc = useQueryClient()
  const { data, isLoading, isError, error, dataUpdatedAt, isFetching, refetch } = useMonitorSync(true)
  const [envivo, setEnvivo] = useState(false)
  const [tic, setTic] = useState(() => Date.now())

  // El reloj de la cuenta regresiva. Un segundo basta y no cuesta nada.
  useEffect(() => {
    const id = setInterval(() => setTic(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Tiempo real: la corrida se inserta al arrancar y se actualiza al terminar,
  // así que la consola la ve aparecer y después cambiar de estado sola.
  useEffect(() => {
    const canal = supabase
      .channel('consola-sincronizacion')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'bsale_sync_runs' },
        () => qc.invalidateQueries({ queryKey: ['bsale-monitor'] }))
      .subscribe((estado) => setEnvivo(estado === 'SUBSCRIBED'))
    return () => {
      supabase.removeChannel(canal)
    }
  }, [qc])

  if (isLoading) return <Skeleton className="h-64" />
  if (isError) return <ErrorState error={error} />
  if (!data) return null

  const { titulo, tono } = ESTADO[data.estado] ?? ESTADO.sin_datos
  const t = TONO[tono]

  // El reloj del navegador puede ir corrido; la cuenta se ancla en la hora que
  // devolvió la base, no en la del equipo.
  const desfase = Date.parse(data.ahora) - dataUpdatedAt
  const faltan = Math.max(0, Date.parse(data.proxima) - (tic + desfase))
  const mm = String(Math.floor(faltan / 60000)).padStart(2, '0')
  const ss = String(Math.floor((faltan % 60000) / 1000)).padStart(2, '0')

  const p = data.pendientes

  return (
    <Card>
      <CardHeader
        title="Consola de sincronización"
        action={
          <div className="flex items-center gap-2">
            <span className={clsx('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium',
              envivo ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
              <Radio className={clsx('h-3 w-3', envivo && 'animate-pulse')} />
              {envivo ? 'En vivo' : 'Cada 30 s'}
            </span>
            <button
              onClick={() => refetch()}
              title="Actualizar ahora"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <RefreshCw className={clsx('h-4 w-4', isFetching && 'animate-spin')} />
            </button>
          </div>
        } />

      <div className="p-4">
        <div className={clsx('rounded-xl border p-4', t.caja)}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={clsx('flex items-center gap-2 font-semibold', t.texto)}>
                <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', t.punto,
                  data.estado === 'corriendo' && 'animate-pulse')} />
                {titulo}
              </p>
              <p className={clsx('mt-1 text-sm', t.suave)}>
                {data.ultima_ok
                  ? `Última corrida buena ${relative(data.ultima_ok)} · ${dateTime(data.ultima_ok)}`
                  : 'Ninguna corrida ha terminado bien todavía'}
                {data.fallas_seguidas > 0 && ` · ${data.fallas_seguidas} fallas seguidas`}
              </p>
              {data.ultima?.error && (
                <p className="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-xs break-all text-red-700">
                  {data.ultima.error}
                </p>
              )}
            </div>

            <div className="text-right">
              <p className="flex items-center justify-end gap-1.5 text-xs text-slate-500">
                <Clock className="h-3.5 w-3.5" /> Próxima corrida
              </p>
              <p className={clsx('font-mono text-2xl font-semibold tabular-nums', t.texto)}>
                {data.job.activo ? `${mm}:${ss}` : '—'}
              </p>
              <p className="text-[11px] text-slate-400">
                {data.job.activo ? `cada 30 min · ${data.job.schedule}` : 'trabajo programado apagado'}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Dato titulo="Últimas 24 h"
            valor={`${data.resumen_24h.ok} ok · ${data.resumen_24h.error} error`}
            detalle={`${data.resumen_24h.corridas} corridas`}
            mal={data.resumen_24h.error > 0} />
          <Dato titulo="Compras sin volcar" valor={String(p.compras_sin_volcar)}
            detalle="documentos leídos que no llegaron al ERP" mal={p.compras_sin_volcar > 0} />
          <Dato titulo="XML sin leer" valor={String(p.xml_sin_leer)}
            detalle="detalle de productos pendiente" mal={p.xml_sin_leer > 20} />
          <Dato titulo="XML con error" valor={String(p.xml_con_error)}
            detalle="el DTE no se pudo interpretar" mal={p.xml_con_error > 0} />
        </div>

        <p className="mt-4 mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          <Activity className="h-3.5 w-3.5" /> Registro de corridas
        </p>
        <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-100">
          {data.corridas.map((c) => <Corrida key={c.id} c={c} />)}
          {!data.corridas.length && (
            <p className="px-3 py-6 text-center text-sm text-slate-400">Sin corridas registradas</p>
          )}
        </div>
      </div>
    </Card>
  )
}

function Dato({ titulo, valor, detalle, mal }: {
  titulo: string; valor: string; detalle: string; mal?: boolean
}) {
  return (
    <div className={clsx('rounded-xl border px-3 py-2.5',
      mal ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50')}>
      <p className="text-[11px] font-medium text-slate-500">{titulo}</p>
      <p className={clsx('font-semibold tabular-nums', mal ? 'text-red-700' : 'text-slate-900')}>{valor}</p>
      <p className="text-[11px] text-slate-400">{detalle}</p>
    </div>
  )
}

const ORIGEN: Record<string, string> = {
  cron: 'automática', manual: 'a mano', webhook: 'webhook',
}

function Corrida({ c }: { c: CorridaSync }) {
  const ok = c.status === 'ok'
  const corriendo = c.status === 'corriendo'
  return (
    <div className="flex items-start gap-3 bg-white px-3 py-2.5">
      <span className={clsx('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
        ok ? 'bg-emerald-100 text-emerald-700'
        : corriendo ? 'bg-sea-100 text-sea-700'
        : 'bg-red-100 text-red-700')}>
        {ok ? <Check className="h-3 w-3" />
         : corriendo ? <RefreshCw className="h-3 w-3 animate-spin" />
         : <AlertTriangle className="h-3 w-3" />}
      </span>

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-slate-800">
          <span className="font-mono tabular-nums">{timeOnly(c.started_at)}</span>
          <span className="text-slate-500">{c.resource}</span>
          <span className="text-[11px] text-slate-400">
            {ORIGEN[c.trigger] ?? c.trigger}
            {c.segundos != null && ` · ${c.segundos} s`}
          </span>
        </p>
        {c.error
          ? <p className="mt-0.5 font-mono text-xs break-all text-red-600">{c.error}</p>
          : <p className="mt-0.5 text-xs text-slate-400">
              {corriendo
                ? 'corriendo…'
                : `${c.records_saved ?? 0} guardados · ${c.records_read ?? 0} leídos`}
            </p>}
      </div>
    </div>
  )
}
