import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { dateShort, money } from '../lib/format'
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE } from '../lib/constants'
import type { PaymentMethod, PaymentStatus } from '../lib/types'
import { ErrorState, Modal, Skeleton } from './ui'

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
}

const ESTADOS: { valor: string; label: string }[] = [
  { valor: '', label: 'Automático (según los cobros)' },
  { valor: 'pendiente', label: 'Pendiente' },
  { valor: 'parcial', label: 'Parcial' },
  { valor: 'pagado', label: 'Pagado' },
  { valor: 'vencido', label: 'Vencido' },
]

/**
 * Corregir una factura cuando lo que dice el sistema no es lo que pasó.
 *
 * El estado sale solo de los cobros imputados, que es lo correcto casi siempre.
 * Cuando no lo es —un cobro cargado a la factura equivocada, una saldada por
 * fuera del sistema, una cerrada por error— antes no había arreglo desde acá:
 * la única herramienta era anular el pago entero, y si ese pago cubría tres
 * facturas se llevaba las otras dos por delante.
 *
 * Por eso hay dos niveles. Primero corregir la imputación, que es lo que suele
 * fallar y deja los números coherentes solos. Forzar el estado es el último
 * recurso, exige motivo y queda anotado a la vista de todos.
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
  const [estado, setEstado] = useState<string>('')
  const [montos, setMontos] = useState<Record<string, string>>({})
  const [aviso, setAviso] = useState<string | null>(null)

  const factura = useQuery({
    queryKey: ['corregir-factura', invoiceId],
    enabled: !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_facturas_con_pago')
        .select('invoice_id, doc_number, cliente, issued_at, due_date, total, amount_paid, saldo,'
              + ' payment_status, estado_corregido, estado_forzado_motivo, estado_forzado_at')
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
                     'cuentas-cobrar', 'dashboard-kpis', 'ventas-facturas']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
    onGuardado?.()
  }

  const corregirImputacion = useMutation({
    mutationFn: async ({ id, monto }: { id: string; monto: number | null }) => {
      const { data, error } = await supabase.rpc('corregir_imputacion', {
        _allocation_id: id, _monto: monto, _motivo: motivo.trim(),
      })
      if (error) throw error
      return data
    },
    onSuccess: () => { setAviso('Imputación corregida'); refrescar() },
    onError: (e: Error) => setAviso(e.message),
  })

  const corregirEstado = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('corregir_estado_factura', {
        _invoice_id: invoiceId, _estado: estado || null, _motivo: motivo.trim(),
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      setAviso(estado ? 'Estado corregido' : 'Vuelve al estado automático')
      refrescar()
    },
    onError: (e: Error) => setAviso(e.message),
  })

  const f = factura.data
  const motivoOk = motivo.trim().length >= 3
  const trabajando = corregirImputacion.isPending || corregirEstado.isPending

  return (
    <Modal open={!!invoiceId} onClose={onClose} wide sobrepuesto
      title={f ? `Corregir la factura ${f.doc_number}` : 'Corregir la factura'}>
      {factura.isLoading && <Skeleton className="h-32" />}
      {factura.isError && <ErrorState error={factura.error} />}

      {f && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm sm:grid-cols-4">
            <Dato k="Cliente" v={f.cliente} />
            <Dato k="Total" v={money(f.total)} />
            <Dato k="Cobrado" v={money(f.amount_paid)} />
            <Dato k="Saldo" v={money(f.saldo)} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`badge ${PAYMENT_STATUS_STYLE[f.payment_status]}`}>
              {PAYMENT_STATUS_LABEL[f.payment_status]}
            </span>
            {f.estado_corregido && (
              <span className="flex items-center gap-1 text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                Puesto a mano el {dateShort(f.estado_forzado_at)}: {f.estado_forzado_motivo}
              </span>
            )}
          </div>

          {/* El motivo es uno solo para todo lo que se toque en esta pasada:
              pedirlo por separado en cada fila era pedirlo cuatro veces. */}
          <div>
            <label className="label" htmlFor="motivo-correccion">
              Por qué se corrige (queda anotado)
            </label>
            <input id="motivo-correccion" className="input" value={motivo}
              placeholder="Ej: el cobro del 12 de agosto era de la factura 35410"
              onChange={(e) => { setMotivo(e.target.value); setAviso(null) }} />
          </div>

          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Cobros imputados a esta factura
            </h4>

            {imputaciones.isLoading && <Skeleton className="h-20" />}

            {imputaciones.data?.length === 0 && (
              <p className="rounded-lg border border-dashed border-slate-200 px-4 py-4 text-sm text-slate-400">
                Ningún cobro está imputado a esta factura.
              </p>
            )}

            <div className="space-y-2">
              {(imputaciones.data ?? []).map((im) => {
                const editado = montos[im.allocation_id] ?? String(Math.round(im.monto_imputado))
                const cambio = Number(editado) !== Math.round(im.monto_imputado)
                return (
                  <div key={im.allocation_id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800">
                        {dateShort(im.fecha_pago)} · {im.pago_code}
                        {im.es_nota_credito && (
                          <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
                            nota de crédito
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400">
                        {PAYMENT_METHOD_LABEL[im.metodo as PaymentMethod] ?? im.metodo}
                        {' · cobro de '}{money(im.monto_pago)}
                        {im.sin_imputar > 0 && ` · ${money(im.sin_imputar)} sin imputar`}
                        {im.reference && ` · ref ${im.reference}`}
                      </p>
                    </div>

                    <input type="number" min={0} className="input w-32 text-right text-sm"
                      value={editado}
                      onChange={(e) => setMontos((m) => ({ ...m, [im.allocation_id]: e.target.value }))} />

                    <button type="button" title="Guardar el monto"
                      className="btn-secondary px-2.5 py-1.5"
                      disabled={!cambio || !motivoOk || trabajando}
                      onClick={() => corregirImputacion.mutate({
                        id: im.allocation_id, monto: Number(editado),
                      })}>
                      <Check className="h-4 w-4" />
                    </button>

                    <button type="button" title="Quitar esta imputación"
                      className="btn-danger px-2.5 py-1.5"
                      disabled={!motivoOk || trabajando}
                      onClick={() => corregirImputacion.mutate({ id: im.allocation_id, monto: null })}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )
              })}
            </div>

            <p className="mt-2 text-xs text-slate-400">
              Quitar una imputación no borra el cobro: lo deja disponible para imputarlo a la
              factura que corresponda.
            </p>
          </section>

          <section className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
            <h4 className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
              Forzar el estado
            </h4>
            <p className="mt-1 mb-3 text-xs text-amber-800/80">
              Solo si la factura se saldó por fuera del sistema o quedó cerrada por error. El
              estado forzado le gana al cálculo y no lo pisa la sincronización.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select className="input w-auto" value={estado}
                onChange={(e) => { setEstado(e.target.value); setAviso(null) }}>
                {ESTADOS.map((e) => (
                  <option key={e.valor} value={e.valor}>{e.label}</option>
                ))}
              </select>
              <button type="button" className="btn-primary"
                disabled={!motivoOk || trabajando}
                onClick={() => corregirEstado.mutate()}>
                {estado ? 'Forzar este estado' : 'Volver al automático'}
              </button>
            </div>
          </section>

          {!motivoOk && (
            <p className="text-xs text-slate-400">
              Escribe el motivo para poder corregir.
            </p>
          )}
          {aviso && (
            <p className={clsx('text-sm', aviso.includes('corregi') || aviso.includes('automático')
              ? 'text-emerald-700' : 'text-red-600')}>
              {aviso}
            </p>
          )}
        </div>
      )}
    </Modal>
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
