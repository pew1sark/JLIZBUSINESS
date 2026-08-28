import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RotateCcw, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { dateShort, money } from '../lib/format'
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE } from '../lib/constants'
import type { PaymentMethod, PaymentStatus } from '../lib/types'
import { ErrorState, Modal, Skeleton } from './ui'
import { SelectorEtiqueta } from './EtiquetaFactura'

interface Imputacion {
  allocation_id: string
  monto_imputado: number
  payment_id: string
  pago_code: string
  fecha_pago: string
  metodo: string
  monto_pago: number
  reference: string | null
  notes: string | null
  es_nota_credito: boolean
  sin_imputar: number
}

interface Factura {
  invoice_id: string
  doc_number: string
  cliente: string
  issued_at: string
  due_date: string | null
  total: number
  amount_paid: number
  saldo: number
  payment_status: PaymentStatus
  estado_corregido: boolean
  estado_forzado_motivo: string | null
  estado_forzado_at: string | null
  etiqueta: string | null
  etiqueta_nota: string | null
}

/**
 * Corregir una factura cuando lo que dice el sistema no es lo que pasó.
 *
 * La primera versión ofrecía un desplegable con los cuatro estados posibles y un
 * botón de "forzar", y hacía falta entender que la deuda no sale del estado sino
 * del saldo para saber qué iba a pasar. Nadie tiene por qué saber eso. Ahora hay
 * dos preguntas en castellano —¿está pagada o no?— y cada botón dice qué hace
 * antes de hacerlo.
 *
 * El detalle fino —bajar el monto de un cobro, quitar solo uno de varios— sigue
 * disponible más abajo, porque a veces el problema es ese y no el estado.
 */
export function CorregirFactura({
  invoiceId, onClose, onGuardado,
}: {
  invoiceId: string | null
  onClose: () => void
  onGuardado?: () => void
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = useState('')
  const [montos, setMontos] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null)

  const factura = useQuery({
    queryKey: ['corregir-factura', invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_facturas_con_pago')
        .select('invoice_id, doc_number, cliente, issued_at, due_date, total, amount_paid, saldo,'
              + ' payment_status, estado_corregido, estado_forzado_motivo, estado_forzado_at,'
              + ' etiqueta, etiqueta_nota')
        .eq('invoice_id', invoiceId!).maybeSingle()
      if (error) throw error
      return data as Factura | null
    },
  })

  const imputaciones = useQuery({
    queryKey: ['corregir-imputaciones', invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_imputaciones_factura').select('*')
        .eq('invoice_id', invoiceId!).order('fecha_pago')
      if (error) throw error
      return data as Imputacion[]
    },
  })

  function refrescar() {
    for (const k of ['corregir-factura', 'corregir-imputaciones', 'factura-detalle',
                     'cob-documentos', 'cob-facturas', 'cob-clientes', 'cob-comportamiento',
                     'cob-sin-imputar', 'cob-pagos-detalle', 'finance-kpis',
                     'cuentas-cobrar', 'dashboard-kpis', 'facturas-emitidas']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
    onGuardado?.()
  }

  const cambiarEstado = useMutation({
    mutationFn: async (estado: 'pendiente' | 'pagado' | null) => {
      const { data, error } = await supabase.rpc('corregir_estado_factura', {
        _invoice_id: invoiceId, _estado: estado, _motivo: motivo.trim(),
      })
      if (error) throw error
      return { estado, r: data as { cobros_borrados: { cobro: string; monto: number }[] } }
    },
    onSuccess: ({ estado, r }) => {
      const borrados = r?.cobros_borrados ?? []
      const suma = borrados.reduce((a, b) => a + Number(b.monto), 0)
      setAviso({ tono: 'ok', texto:
        estado === null ? 'Vuelve a calcularse sola desde los cobros.'
        : estado === 'pagado' ? 'Marcada como pagada. Sale de cuentas por cobrar.'
        : borrados.length > 0
          ? `Marcada como no pagada. Se eliminó ${borrados.length === 1 ? 'el cobro' : 'los cobros'} `
            + `${borrados.map((b) => b.cobro).join(', ')} por ${money(suma)}, que no cubría otra factura.`
          : 'Marcada como no pagada. Vuelve a aparecer en cuentas por cobrar.' })
      refrescar()
    },
    onError: (e: Error) => setAviso({ tono: 'error', texto: e.message }),
  })

  const corregirImputacion = useMutation({
    mutationFn: async ({ id, monto }: { id: string; monto: number | null }) => {
      const { error } = await supabase.rpc('corregir_imputacion', {
        _allocation_id: id, _monto: monto, _motivo: motivo.trim(),
      })
      if (error) throw error
    },
    onSuccess: () => { setAviso({ tono: 'ok', texto: 'Cobro corregido.' }); refrescar() },
    onError: (e: Error) => setAviso({ tono: 'error', texto: e.message }),
  })

  const f = factura.data
  const enPlata = (imputaciones.data ?? []).filter((i) => !i.es_nota_credito)
  const cobrosEnPlata = enPlata.reduce((a, i) => a + Number(i.monto_imputado), 0)
  const listo = motivo.trim().length >= 3
  const trabajando = cambiarEstado.isPending || corregirImputacion.isPending

  return (
    <Modal open={!!invoiceId} onClose={onClose} wide sobrepuesto
      title={f ? `Factura ${f.doc_number} · ${f.cliente}` : 'Corregir la factura'}>
      {factura.isLoading && <Skeleton className="h-32" />}
      {factura.isError && <ErrorState error={factura.error} />}

      {f && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm sm:grid-cols-4">
            <Dato k="Emitida" v={dateShort(f.issued_at)} />
            <Dato k="Total" v={money(f.total)} />
            <Dato k="Cobrado" v={money(f.amount_paid)} />
            <Dato k="Saldo" v={money(f.saldo)} />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className={`badge ${PAYMENT_STATUS_STYLE[f.payment_status]}`}>
              {PAYMENT_STATUS_LABEL[f.payment_status]}
            </span>
            {f.estado_corregido && (
              <span className="flex items-center gap-1 text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                Puesto a mano el {dateShort(f.estado_forzado_at)}: {f.estado_forzado_motivo}
              </span>
            )}
            <span className="ml-auto flex items-center gap-1 text-slate-500">
              Etiqueta
              <SelectorEtiqueta invoiceId={f.invoice_id} actual={f.etiqueta}
                notaActual={f.etiqueta_nota} onListo={refrescar} />
            </span>
          </div>

          <div>
            <label className="label" htmlFor="motivo-correccion">
              Por qué se corrige · queda anotado con tu nombre
            </label>
            <input id="motivo-correccion" className="input" value={motivo}
              placeholder="Ej: el cliente nunca pagó esta factura"
              onChange={(e) => { setMotivo(e.target.value); setAviso(null) }} />
          </div>

          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              ¿Está pagada?
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              <Accion
                titulo="No está pagada"
                detalle={cobrosEnPlata > 0
                  ? `Vuelve a deber ${money(f.total)}. Se elimina ${money(cobrosEnPlata)} en cobros que no cubren otra factura.`
                  : 'Vuelve a aparecer en cuentas por cobrar.'}
                tono="peligro" disabled={!listo || trabajando}
                onClick={() => cambiarEstado.mutate('pendiente')} />
              <Accion
                titulo="Sí, está pagada"
                detalle={f.saldo > 0
                  ? `Sale de cuentas por cobrar aunque le queden ${money(f.saldo)} sin cubrir.`
                  : 'Queda cerrada aunque cambien los cobros.'}
                disabled={!listo || trabajando}
                onClick={() => cambiarEstado.mutate('pagado')} />
            </div>

            {f.estado_corregido && (
              <button type="button" disabled={!listo || trabajando}
                onClick={() => cambiarEstado.mutate(null)}
                className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 hover:text-navy-700 disabled:opacity-50">
                <RotateCcw className="h-3.5 w-3.5" />
                Quitar la marca y dejar que se calcule sola desde los cobros
              </button>
            )}
          </section>

          {(imputaciones.data ?? []).length > 0 && (
            <section>
              <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
                Cobros imputados
              </h4>
              <div className="space-y-2">
                {(imputaciones.data ?? []).map((im) => {
                  const editado = montos[im.allocation_id] ?? String(Math.round(im.monto_imputado))
                  const cambio = Number(editado) !== Math.round(im.monto_imputado)
                  return (
                    <div key={im.allocation_id}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800">
                          {dateShort(im.fecha_pago)} · {money(im.monto_imputado)}
                          {im.es_nota_credito && (
                            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                              nota de crédito
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">
                          {im.pago_code} · {PAYMENT_METHOD_LABEL[im.metodo as PaymentMethod] ?? im.metodo}
                          {im.monto_pago !== im.monto_imputado && ` · cobro de ${money(im.monto_pago)}`}
                        </p>
                      </div>
                      {!im.es_nota_credito && (
                        <>
                          <input type="number" min={0} className="input w-28 text-right text-sm"
                            value={editado}
                            onChange={(e) => setMontos((m) => ({ ...m, [im.allocation_id]: e.target.value }))} />
                          <button type="button" className="btn-secondary px-3 py-1.5 text-xs"
                            disabled={!cambio || !listo || trabajando}
                            onClick={() => corregirImputacion.mutate({
                              id: im.allocation_id, monto: Number(editado) })}>
                            Cambiar
                          </button>
                          <button type="button" title="Quitar este cobro de la factura"
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                            disabled={!listo || trabajando}
                            onClick={() => corregirImputacion.mutate({ id: im.allocation_id, monto: null })}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Quitar un cobro desde acá lo deja sin imputar, para asignarlo a la factura que
                corresponda. Si lo que pasa es que la factura no se pagó, usa el botón de arriba.
              </p>
            </section>
          )}

          {!listo && (
            <p className="text-xs text-slate-400">Escribe el motivo para poder corregir.</p>
          )}
          {aviso && (
            <p className={clsx('rounded-lg px-3 py-2 text-sm',
              aviso.tono === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>
              {aviso.texto}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function Accion({
  titulo, detalle, tono, disabled, onClick,
}: {
  titulo: string
  detalle: string
  tono?: 'peligro'
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={clsx('rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-50',
        tono === 'peligro'
          ? 'border-red-200 bg-red-50/60 hover:bg-red-50'
          : 'border-slate-200 bg-white hover:bg-slate-50')}>
      <p className={clsx('text-sm font-medium', tono === 'peligro' ? 'text-red-800' : 'text-slate-800')}>
        {titulo}
      </p>
      <p className="mt-0.5 text-xs text-slate-500">{detalle}</p>
    </button>
  )
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{k}</p>
      <p className="font-medium text-slate-800 tabular-nums">{v}</p>
    </div>
  )
}
