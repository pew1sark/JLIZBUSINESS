import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dateShort, money } from '../lib/format'
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE } from '../lib/constants'
import type { PaymentStatus } from '../lib/types'
import { Modal, Skeleton } from './ui'
import { CorregirFactura } from './CorregirFactura'

const DOC_LABEL: Record<string, string> = {
  factura: 'Factura', boleta: 'Boleta',
  nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito',
}

/**
 * Lo mínimo que hay que saber de una factura para abrir su detalle. Se pide
 * suelto en vez de la fila entera porque cada pantalla trae la factura con una
 * forma distinta (invoices, v_cuentas_por_cobrar, v_facturas_con_pago).
 */
export interface FacturaRef {
  id: string
  doc_type?: string | null
  doc_number: string
  cliente?: string | null
}

/**
 * El detalle de una factura: línea por línea, con neto, IVA y total, más su
 * estado de pago y qué día se pagó. Vive acá y no dentro de Ventas porque la
 * misma pregunta aparece en cobranza: "¿qué trae esta factura que me están
 * discutiendo?".
 */
export function DetalleFactura({
  factura, onClose,
}: {
  factura: FacturaRef | null
  onClose: () => void
}) {
  const doc = useQuery({
    queryKey: ['factura-detalle', factura?.id],
    enabled: !!factura,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_facturas_con_pago').select('*').eq('invoice_id', factura!.id).maybeSingle()
      if (error) throw error
      return data as {
        doc_type: string; doc_number: string; cliente: string; rut: string | null
        razon_social: string | null
        issued_at: string; due_date: string | null
        net_amount: number; tax_amount: number; total: number
        amount_paid: number; saldo: number; payment_status: PaymentStatus
        primer_pago: string | null; ultimo_pago: string | null; n_pagos: number
        metodos: string | null; referencias: string | null
        dias_en_pagar: number | null; dias_esperando: number | null; dias_atraso: number | null
        nota_credito_aplicada: number; saldada_con_nota: boolean; notas_credito: string | null
        estado_corregido: boolean; estado_forzado_motivo: string | null
      } | null
    },
  })

  const items = useQuery({
    queryKey: ['factura-items', factura?.id],
    enabled: !!factura,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoice_items')
        .select('id, line_no, sku, description, variant, quantity, unit_price_net, net_total, gross_total')
        .eq('invoice_id', factura!.id)
        .order('line_no')
      if (error) throw error
      return data as {
        id: string; line_no: number; sku: string | null; description: string
        variant: string | null; quantity: number; unit_price_net: number
        net_total: number; gross_total: number
      }[]
    },
  })

  const d = doc.data
  const [corrigiendo, setCorrigiendo] = useState(false)

  return (
    <Modal open={!!factura} onClose={onClose} wide
      title={factura
        ? `${DOC_LABEL[d?.doc_type ?? factura.doc_type ?? 'factura'] ?? ''} ${factura.doc_number}`
        : ''}>
      {factura && (
        <div className="space-y-4">
          {doc.isLoading && <Skeleton className="h-20" />}

          {d && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Campo k="Cliente" v={d.cliente}
                  bajo={d.razon_social && d.razon_social.trim().toLowerCase() !== d.cliente.trim().toLowerCase()
                        ? d.razon_social : d.rut} />
                <Campo k="Emitida" v={dateShort(d.issued_at)} />
                <Campo k="Vence" v={dateShort(d.due_date)} />
                <Campo k="Saldo" v={money(d.saldo)} />
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                <span className={`badge ${PAYMENT_STATUS_STYLE[d.payment_status]}`}>
                  {PAYMENT_STATUS_LABEL[d.payment_status]}
                </span>
                {d.estado_corregido && (
                  <span className="text-amber-700">
                    estado puesto a mano: {d.estado_forzado_motivo}
                  </span>
                )}
                {d.ultimo_pago ? (
                  <>
                    <span className="text-slate-600">
                      Pagada el <span className="font-medium text-slate-800">{dateShort(d.ultimo_pago)}</span>
                      {d.n_pagos > 1 && ` · ${d.n_pagos} pagos desde ${dateShort(d.primer_pago)}`}
                    </span>
                    {d.dias_en_pagar !== null && (
                      <span className="text-slate-500">{d.dias_en_pagar} días desde la emisión</span>
                    )}
                    {d.metodos && <span className="text-slate-400">{d.metodos}</span>}
                    {d.referencias && <span className="text-slate-400">ref {d.referencias}</span>}
                    {d.nota_credito_aplicada > 0 && (
                      <span className="text-emerald-700">
                        + {money(d.nota_credito_aplicada)} anulados con {d.notas_credito ?? 'nota de crédito'}
                      </span>
                    )}
                  </>
                ) : d.saldada_con_nota ? (
                  <span className="text-slate-600">
                    Anulada con {d.notas_credito ?? 'nota de crédito'} por{' '}
                    <span className="font-medium text-slate-800">{money(d.nota_credito_aplicada)}</span>
                    <span className="ml-1 text-slate-400">· no entró plata</span>
                  </span>
                ) : (
                  <span className="text-slate-500">
                    Sin pagos registrados
                    {d.dias_esperando !== null && ` · ${d.dias_esperando} días esperando`}
                    {(d.dias_atraso ?? 0) > 0 && (
                      <span className="ml-1 font-medium text-red-600">{d.dias_atraso} días de atraso</span>
                    )}
                  </span>
                )}
              </div>
            </>
          )}

          {items.isLoading && <Skeleton className="h-32" />}
          {items.data && items.data.length === 0 && (
            <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">
              Esta factura se importó sin el detalle de productos, así que solo se conocen sus totales.
            </p>
          )}

          {!!items.data?.length && (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Producto</th>
                    <th className="px-3 py-2 text-right">Cantidad</th>
                    <th className="px-3 py-2 text-right">Precio neto</th>
                    <th className="px-3 py-2 text-right">Neto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.data.map((i) => (
                    <tr key={i.id}>
                      <td className="px-3 py-2">
                        {i.description}
                        {i.variant && <span className="ml-1 text-xs text-slate-400">{i.variant}</span>}
                        {i.sku && <span className="ml-1 text-xs text-slate-300">{i.sku}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(i.quantity)} kg</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(i.unit_price_net)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{money(i.net_total)}</td>
                    </tr>
                  ))}
                </tbody>
                {d && (
                  <tfoot className="bg-slate-50 text-sm">
                    <tr>
                      <td className="px-3 py-2 text-right text-slate-500" colSpan={3}>Neto</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(d.net_amount)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-right text-slate-500" colSpan={3}>IVA</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(d.tax_amount)}</td>
                    </tr>
                    <tr>
                      <td className="px-3 py-2 text-right font-medium" colSpan={3}>Total</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(d.total)}</td>
                    </tr>
                    {Number(d.amount_paid) > 0 && (
                      <tr>
                        <td className="px-3 py-2 text-right text-slate-500" colSpan={3}>Pagado</td>
                        <td className="px-3 py-2 text-right tabular-nums text-emerald-600">
                          − {money(d.amount_paid)}
                        </td>
                      </tr>
                    )}
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* Solo las facturas propias se corrigen: un pedido o un saldo
              inicial no tienen imputaciones que revisar por acá. */}
          <button type="button" className="btn-secondary w-full sm:w-auto"
            onClick={() => setCorrigiendo(true)}>
            <Pencil className="h-4 w-4" /> Corregir el estado o los cobros
          </button>
        </div>
      )}

      <CorregirFactura invoiceId={corrigiendo ? (factura?.id ?? null) : null}
        onClose={() => setCorrigiendo(false)} />
    </Modal>
  )
}

function Campo({ k, v, bajo }: { k: string; v: string; bajo?: string | null }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] tracking-wide text-slate-500 uppercase">{k}</p>
      <p className="mt-0.5 font-medium text-slate-900">{v}</p>
      {bajo && <p className="text-xs text-slate-400">{bajo}</p>}
    </div>
  )
}
