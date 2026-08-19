import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Check, Loader2, Map, MessageCircle, Navigation, Phone, Route, Truck, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useHojaRuta, type ParadaRuta } from '../../lib/operativo'
import { Mapa, type PuntoMapa } from '../../components/Mapa'
import { kilometrosRuta, urlMapaNativo, urlRutaCompleta, urlWaze } from '../../lib/geo'
import { DELIVERY_STATUS_LABEL } from '../../lib/constants'
import { kg, timeOnly } from '../../lib/format'
import { Card, EmptyState, ErrorState, Modal, Skeleton } from '../../components/ui'

const ESTILO: Record<string, string> = {
  pendiente: 'bg-slate-100 text-slate-600',
  asignada: 'bg-blue-100 text-blue-700',
  en_camino: 'bg-sea-100 text-sea-800',
  entregada: 'bg-emerald-100 text-emerald-700',
  fallida: 'bg-red-100 text-red-700',
}

export function WorkerRuta() {
  const hoy = new Date().toISOString().slice(0, 10)
  const ruta = useHojaRuta(hoy)
  const qc = useQueryClient()
  const [entregar, setEntregar] = useState<ParadaRuta | null>(null)
  const [fallar, setFallar] = useState<ParadaRuta | null>(null)

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['op-ruta'] })
    qc.invalidateQueries({ queryKey: ['op-pedidos'] })
  }

  const empresa = useQuery({
    queryKey: ['settings', 'empresa'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings').select('value').eq('key', 'empresa').maybeSingle()
      if (error) throw error
      return (data?.value ?? {}) as Record<string, string | number>
    },
  })

  const enCamino = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('start_delivery', { _delivery_id: id })
      if (error) throw error
    },
    onSuccess: refrescar,
  })

  const bodega = useMemo(() => {
    const lat = Number(empresa.data?.bodega_lat)
    const lng = Number(empresa.data?.bodega_lng)
    return Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng, etiqueta: 'Bodega' }
      : null
  }, [empresa.data])

  const paradas = ruta.data ?? []
  const pendientes = paradas.filter((p) => p.status !== 'entregada' && p.status !== 'fallida')
  const cerradas = paradas.filter((p) => p.status === 'entregada' || p.status === 'fallida')
  const kilos = pendientes.reduce((n, p) => n + Number(p.total_kilos), 0)

  const conCoordenadas = pendientes.filter((p) => p.latitude != null && p.longitude != null)

  const puntosRuta: PuntoMapa[] = conCoordenadas.map((p, i) => ({
    id: p.delivery_id,
    lat: Number(p.latitude),
    lng: Number(p.longitude),
    numero: p.sequence ?? i + 1,
    color: p.status === 'en_camino' ? '#1eafa7' : '#0b2545',
    popup: (
      <div className="text-sm">
        <p className="font-semibold">{p.cliente}</p>
        <p className="text-xs text-slate-500">{p.direccion}</p>
        <p className="text-xs text-slate-500">{kg(p.total_kilos)}</p>
      </div>
    ),
  }))

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Hoja de ruta</h1>
      <p className="mb-4 text-sm text-slate-500">
        {pendientes.length} entrega(s) pendientes · {kg(kilos)} por repartir
      </p>

      {conCoordenadas.length > 0 && (
        <div className="mb-4">
          <Mapa
            puntos={puntosRuta}
            alto={260}
            ruta
            origen={bodega ?? undefined}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">
              {conCoordenadas.length} parada(s) en el mapa
              {bodega && ` · ${kilometrosRuta(bodega, conCoordenadas.map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude) })))} km aprox.`}
            </span>
            {bodega && (
              <a
                href={urlRutaCompleta(bodega, conCoordenadas.map((p) => ({ lat: Number(p.latitude), lng: Number(p.longitude) })))}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary ml-auto px-3 py-1.5 text-xs"
              >
                <Route className="h-3.5 w-3.5" /> Abrir ruta completa
              </a>
            )}
          </div>
        </div>
      )}

      {ruta.isError && <ErrorState error={ruta.error} />}
      {ruta.isLoading && <Skeleton className="h-48" />}
      {!ruta.isLoading && paradas.length === 0 && (
        <Card><EmptyState title="No tienes entregas asignadas para hoy" icon={<Truck className="h-8 w-8" />} /></Card>
      )}

      {enCamino.isError && <ErrorState error={enCamino.error} />}

      <div className="space-y-3">
        {pendientes.map((p, i) => (
          <Card key={p.delivery_id} className="overflow-hidden">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-semibold text-white">
                  {p.sequence ?? i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{p.cliente}</p>
                  <p className="text-sm text-slate-500">{p.direccion}</p>
                  <p className="text-xs text-slate-400">
                    {p.comuna} · {p.horario ?? 'sin horario'} · {kg(p.total_kilos)}
                  </p>
                </div>
                <span className={`badge shrink-0 ${ESTILO[p.status]}`}>
                  {DELIVERY_STATUS_LABEL[p.status]}
                </span>
              </div>

              {p.notes && (
                <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{p.notes}</p>
              )}

              <div className="mt-3 grid grid-cols-4 gap-2">
                <a
                  href={p.telefono ? `tel:${p.telefono}` : undefined}
                  className="btn-secondary justify-center py-2.5 text-xs"
                >
                  <Phone className="h-4 w-4" /> Llamar
                </a>
                <a
                  href={p.whatsapp ? `https://wa.me/${p.whatsapp.replace(/\D/g, '')}` : undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary justify-center py-2.5 text-xs"
                >
                  <MessageCircle className="h-4 w-4" /> WhatsApp
                </a>
                <a
                  href={coordDe(p) ? urlWaze(coordDe(p)!) : urlMapaNativo(null, p.direccion, p.comuna)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary justify-center py-2.5 text-xs"
                >
                  <Navigation className="h-4 w-4" /> Waze
                </a>
                <a
                  href={urlMapaNativo(coordDe(p), p.direccion, p.comuna)}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary justify-center py-2.5 text-xs"
                >
                  <Map className="h-4 w-4" /> Maps
                </a>
              </div>
            </div>

            <div className="flex gap-2 border-t border-slate-100 p-3">
              {p.status !== 'en_camino' && (
                <button
                  onClick={() => enCamino.mutate(p.delivery_id)}
                  disabled={enCamino.isPending}
                  className="btn-secondary flex-1 py-3"
                >
                  {enCamino.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
                  En camino
                </button>
              )}
              <button onClick={() => setEntregar(p)} className="btn-accent flex-1 py-3">
                <Check className="h-4 w-4" /> Entregado
              </button>
              <button onClick={() => setFallar(p)} className="btn-secondary px-3 py-3 text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
          </Card>
        ))}
      </div>

      {cerradas.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            Cerradas hoy
          </h2>
          <div className="space-y-2">
            {cerradas.map((p) => (
              <Card key={p.delivery_id} className="flex items-center justify-between p-3 opacity-70">
                <div>
                  <p className="text-sm font-medium text-slate-800">{p.cliente}</p>
                  <p className="text-xs text-slate-400">
                    {p.delivered_at ? `entregado ${timeOnly(p.delivered_at)}` : 'no entregado'}
                    {p.received_by_name && ` · recibió ${p.received_by_name}`}
                  </p>
                </div>
                <span className={`badge ${ESTILO[p.status]}`}>{DELIVERY_STATUS_LABEL[p.status]}</span>
              </Card>
            ))}
          </div>
        </>
      )}

      <EntregaModal parada={entregar} onClose={() => setEntregar(null)} onListo={refrescar} />
      <FallidaModal parada={fallar} onClose={() => setFallar(null)} onListo={refrescar} />
    </>
  )
}

function EntregaModal({
  parada, onClose, onListo,
}: { parada: ParadaRuta | null; onClose: () => void; onListo: () => void }) {
  const [receptor, setReceptor] = useState('')
  const [notas, setNotas] = useState('')
  const [ubicando, setUbicando] = useState(false)

  const confirmar = useMutation({
    mutationFn: async () => {
      let lat: number | null = null
      let lng: number | null = null
      try {
        setUbicando(true)
        const pos = await new Promise<GeolocationPosition>((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 }),
        )
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch {
        // Sin GPS la entrega se registra igual: no se bloquea al repartidor.
      } finally {
        setUbicando(false)
      }

      const { error } = await supabase.rpc('complete_delivery', {
        _delivery_id: parada!.delivery_id,
        _received_by: receptor.trim() || null,
        _notes: notas.trim() || null,
        _lat: lat,
        _lng: lng,
      })
      if (error) throw error
    },
    onSuccess: () => {
      onListo()
      onClose()
      setReceptor('')
      setNotas('')
    },
  })

  return (
    <Modal
      open={!!parada}
      onClose={onClose}
      title="Confirmar entrega"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => confirmar.mutate()} disabled={confirmar.isPending} className="btn-accent">
            {(confirmar.isPending || ubicando) && <Loader2 className="h-4 w-4 animate-spin" />}
            Confirmar entrega
          </button>
        </>
      }
    >
      {parada && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="font-medium text-slate-900">{parada.cliente}</p>
            <p className="text-sm text-slate-500">{parada.direccion}</p>
            <p className="text-sm text-slate-500">{kg(parada.total_kilos)}</p>
          </div>
          <div>
            <label className="label">¿Quién recibió?</label>
            <input className="input py-3" value={receptor} onChange={(e) => setReceptor(e.target.value)} placeholder="Nombre de quien recibe" />
          </div>
          <div>
            <label className="label">Observaciones</label>
            <input className="input py-3" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
          <p className="text-xs text-slate-500">
            Se registra la hora y, si el teléfono lo permite, la ubicación. El cobro lo lleva la
            administración: el pago del cliente es por transferencia.
          </p>
          {confirmar.isError && <ErrorState error={confirmar.error} />}
        </div>
      )}
    </Modal>
  )
}

function FallidaModal({
  parada, onClose, onListo,
}: { parada: ParadaRuta | null; onClose: () => void; onListo: () => void }) {
  const [motivo, setMotivo] = useState('')

  const marcar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('fail_delivery', {
        _delivery_id: parada!.delivery_id,
        _reason: motivo.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      onListo()
      onClose()
      setMotivo('')
    },
  })

  return (
    <Modal
      open={!!parada}
      onClose={onClose}
      title="No se pudo entregar"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Volver</button>
          <button onClick={() => marcar.mutate()} disabled={!motivo.trim() || marcar.isPending} className="btn-danger">
            Registrar
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="label">¿Qué pasó?</label>
        <input
          className="input py-3"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Local cerrado, cliente no contesta…"
        />
        <p className="text-xs text-slate-500">
          El pedido vuelve a bodega y queda avisada la administración para reprogramar.
        </p>
        {marcar.isError && <ErrorState error={marcar.error} />}
      </div>
    </Modal>
  )
}

function coordDe(p: ParadaRuta) {
  return p.latitude != null && p.longitude != null
    ? { lat: Number(p.latitude), lng: Number(p.longitude) }
    : null
}
