import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Receipt, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOperacion } from '../../lib/queries'
import type { Invoice, Order, PaymentMethod } from '../../lib/types'
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_STYLE, PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE,
} from '../../lib/constants'
import { dateShort, money, moneyShort } from '../../lib/format'
import { descargarCsv } from '../../lib/csv'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, StatCard, TableWrap } from '../../components/ui'

type Rango = 'hoy' | 'semana' | 'mes' | 'todo'

/**
 * Las facturas se emiten en el sistema de facturación electrónica y se importan;
 * los pedidos nacen dentro de la plataforma. Son dos flujos distintos y esta
 * pantalla muestra los dos, con las facturas primero porque son el grueso.
 */
type Fuente = 'facturas' | 'pedidos'

interface FacturaFila extends Invoice {
  customers: { id: string; name: string; comuna: string | null } | null
}

const DOC_LABEL: Record<string, string> = {
  factura: 'Factura', boleta: 'Boleta',
  nota_credito: 'Nota de crédito', nota_debito: 'Nota de débito',
}

export function Ventas() {
  const qc = useQueryClient()
  const operacion = useOperacion()
  const [rango, setRango] = useState<Rango>('mes')
  const [fuente, setFuente] = useState<Fuente>('facturas')
  const [verFactura, setVerFactura] = useState<FacturaFila | null>(null)
  const [soloDeuda, setSoloDeuda] = useState(false)
  const [cobrar, setCobrar] = useState<Order | null>(null)
  const [factura, setFactura] = useState<Order | null>(null)

  const desde = useMemo(() => {
    const d = new Date()
    if (rango === 'hoy') d.setHours(0, 0, 0, 0)
    else if (rango === 'semana') d.setDate(d.getDate() - 7)
    else if (rango === 'mes') d.setDate(1)
    else return null
    return d.toISOString()
  }, [rango])

  const desdeFecha = useMemo(() => (desde ? desde.slice(0, 10) : null), [desde])

  const ventas = useQuery({
    queryKey: ['ventas', rango],
    queryFn: async () => {
      let q = supabase
        .from('orders')
        .select('*, customers(id, name, customer_type, phone, address, comuna)')
        .neq('status', 'cancelado')
        .order('order_date', { ascending: false })
        .limit(400)
      if (desde) q = q.gte('order_date', desde)
      const { data, error } = await q
      if (error) throw error
      return data as Order[]
    },
  })

  const facturas = useQuery({
    queryKey: ['facturas-emitidas', rango],
    queryFn: async () => {
      let q = supabase
        .from('invoices')
        .select('*, customers(id, name, comuna)')
        .order('issued_at', { ascending: false })
        .order('doc_number', { ascending: false })
        .limit(1000)
      if (desdeFecha) q = q.gte('issued_at', desdeFecha)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as FacturaFila[]
    },
  })

  const filtradas = useMemo(
    () => (ventas.data ?? []).filter((o) => (soloDeuda ? o.payment_status !== 'pagado' : true)),
    [ventas.data, soloDeuda],
  )

  const facturasFiltradas = useMemo(
    () => (facturas.data ?? []).filter((f) => (soloDeuda ? f.payment_status !== 'pagado' : true)),
    [facturas.data, soloDeuda],
  )

  const totalesFactura = useMemo(() => {
    const f = facturasFiltradas
    const neto = f.reduce((n, x) => n + Number(x.net_amount), 0)
    const ivaMonto = f.reduce((n, x) => n + Number(x.tax_amount), 0)
    const bruto = f.reduce((n, x) => n + Number(x.total), 0)
    const cobrado = f.reduce((n, x) => n + Number(x.amount_paid), 0)
    return { neto, ivaMonto, bruto, cobrado, pendiente: bruto - cobrado }
  }, [facturasFiltradas])

  const iva = Number(operacion.data?.iva ?? 19)
  const totales = useMemo(() => {
    const neto = filtradas.reduce((n, o) => n + Number(o.total), 0)
    const costo = filtradas.reduce((n, o) => n + Number(o.cost_total), 0)
    const cobrado = filtradas.reduce((n, o) => n + Number(o.amount_paid), 0)
    return { neto, costo, cobrado, pendiente: neto - cobrado, margen: neto - costo }
  }, [filtradas])

  const registrarPago = useMutation({
    mutationFn: async ({ orden, monto, metodo, referencia }: {
      orden: Order; monto: number; metodo: PaymentMethod; referencia: string
    }) => {
      const { error } = await supabase.from('payments').insert({
        direction: 'cobro',
        order_id: orden.id,
        customer_id: orden.customer_id,
        amount: monto,
        method: metodo,
        reference: referencia || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setCobrar(null)
      qc.invalidateQueries({ queryKey: ['ventas'] })
      qc.invalidateQueries({ queryKey: ['customer-balance'] })
      qc.invalidateQueries({ queryKey: ['dashboard-kpis'] })
    },
  })

  const guardarFactura = useMutation({
    mutationFn: async ({ orden, numero }: { orden: Order; numero: string }) => {
      const { error } = await supabase
        .from('orders')
        .update({
          invoice_number: numero.trim() || null,
          invoice_status: numero.trim() ? 'emitida' : 'pendiente',
          invoice_issued_at: numero.trim() ? new Date().toISOString() : null,
        })
        .eq('id', orden.id)
      if (error) throw error
    },
    onSuccess: () => {
      setFactura(null)
      qc.invalidateQueries({ queryKey: ['ventas'] })
    },
  })

  function exportarFacturas() {
    const filas: (string | number)[][] = [[
      'Documento', 'Tipo', 'Cliente', 'Emitida', 'Vence', 'Neto', 'IVA', 'Total', 'Pagado', 'Saldo', 'Estado',
    ]]
    for (const f of facturasFiltradas) {
      filas.push([
        f.doc_number, DOC_LABEL[f.doc_type] ?? f.doc_type, f.customers?.name ?? '',
        f.issued_at, f.due_date ?? '', f.net_amount, f.tax_amount, f.total,
        f.amount_paid, Number(f.total) - Number(f.amount_paid), f.payment_status,
      ])
    }
    descargarCsv(filas, `facturas-${rango}`)
  }

  function exportar() {
    const filas = [['Pedido', 'Fecha', 'Cliente', 'Estado', 'Neto', 'IVA', 'Total con IVA', 'Pagado', 'Saldo', 'Factura']]
    for (const o of filtradas) {
      const ivaMonto = Math.round(Number(o.total) * (iva / 100))
      filas.push([
        o.code, dateShort(o.order_date), o.customers?.name ?? '', ORDER_STATUS_LABEL[o.status],
        String(o.total), String(ivaMonto), String(Number(o.total) + ivaMonto),
        String(o.amount_paid), String(Number(o.total) - Number(o.amount_paid)), o.invoice_number ?? '',
      ])
    }
    const csv = filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `ventas-${rango}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <PageHeader
        title="Ventas"
        subtitle="Facturas emitidas, pedidos internos y cobros del período"
        actions={
          <>
            <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm">
              {(['hoy', 'semana', 'mes', 'todo'] as Rango[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRango(r)}
                  className={`rounded-md px-3 py-1 font-medium capitalize ${rango === r ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <button onClick={fuente === 'facturas' ? exportarFacturas : exportar} className="btn-secondary">
              <Download className="h-4 w-4" /> CSV
            </button>
          </>
        }
      />

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm sm:w-fit">
        {([
          ['facturas', `Facturas emitidas${facturas.data?.length ? ` (${facturas.data.length})` : ''}`],
          ['pedidos', `Pedidos internos${ventas.data?.length ? ` (${ventas.data.length})` : ''}`],
        ] as [Fuente, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setFuente(k)}
            className={`flex-1 rounded-md px-4 py-1.5 font-medium sm:flex-none ${
              fuente === k ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {fuente === 'facturas' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Venta neta" value={moneyShort(totalesFactura.neto)}
            hint={`${facturasFiltradas.length} documentos`} />
          <StatCard label="IVA" value={moneyShort(totalesFactura.ivaMonto)} />
          <StatCard label="Total facturado" value={moneyShort(totalesFactura.bruto)} />
          <StatCard label="Cobrado" value={moneyShort(totalesFactura.cobrado)} />
          <StatCard label="Por cobrar" value={moneyShort(totalesFactura.pendiente)}
            tone={totalesFactura.pendiente > 0 ? 'warning' : 'default'} />
        </div>
      ) : (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Venta neta" value={moneyShort(totales.neto)} hint={`${filtradas.length} pedidos`} />
        <StatCard label={`Total con IVA ${iva}%`} value={moneyShort(totales.neto * (1 + iva / 100))} />
        <StatCard label="Margen" value={moneyShort(totales.margen)} hint={totales.neto > 0 ? `${Math.round((totales.margen / totales.neto) * 100)}%` : '—'} tone="positive" />
        <StatCard label="Cobrado" value={moneyShort(totales.cobrado)} />
        <StatCard label="Por cobrar" value={moneyShort(totales.pendiente)} tone={totales.pendiente > 0 ? 'warning' : 'default'} />
      </div>
      )}

      {fuente === 'facturas' && (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Las facturas se emiten en el sistema de facturación electrónica y se importan acá.
          Como la planilla de ventas no trae costos, en esta vista no se calcula margen: eso
          se ve en <span className="font-medium">Finanzas → Rentabilidad</span>.
        </p>
      )}

      <label className="mt-3 mb-2 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={soloDeuda} onChange={(e) => setSoloDeuda(e.target.checked)} className="rounded border-slate-300" />
        Ver solo lo que está pendiente de cobro
      </label>

      {fuente === 'facturas' && (
        <>
          {facturas.isError && <ErrorState error={facturas.error} />}
          {facturas.isLoading && <Skeleton className="h-64" />}
          {!facturas.isLoading && facturasFiltradas.length === 0 && (
            <Card>
              <EmptyState title="Sin facturas en este período"
                hint="Prueba cambiando el rango a «todo», o importa el detalle de ventas del mes."
                icon={<Receipt className="h-8 w-8" />} />
            </Card>
          )}
          {facturasFiltradas.length > 0 && (
            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Documento</th>
                  <th className="th">Cliente</th>
                  <th className="th">Emitida</th>
                  <th className="th">Vence</th>
                  <th className="th text-right">Neto</th>
                  <th className="th text-right">Total</th>
                  <th className="th text-right">Saldo</th>
                  <th className="th">Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {facturasFiltradas.map((f) => {
                  const saldo = Number(f.total) - Number(f.amount_paid)
                  const esNC = f.doc_type === 'nota_credito'
                  return (
                    <tr key={f.id} className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setVerFactura(f)}>
                      <td className="td">
                        <p className="font-medium text-navy-900">{f.doc_number}</p>
                        <p className="text-xs text-slate-400">{DOC_LABEL[f.doc_type] ?? f.doc_type}</p>
                      </td>
                      <td className="td font-medium text-slate-800">{f.customers?.name}</td>
                      <td className="td text-slate-500">{dateShort(f.issued_at)}</td>
                      <td className="td text-slate-500">{dateShort(f.due_date)}</td>
                      <td className="td text-right tabular-nums text-slate-500">{money(f.net_amount)}</td>
                      <td className={`td text-right tabular-nums ${esNC ? 'text-emerald-600' : ''}`}>
                        {money(f.total)}
                      </td>
                      <td className={`td text-right tabular-nums ${saldo > 0 ? 'font-medium text-amber-600' : 'text-slate-400'}`}>
                        {money(saldo)}
                      </td>
                      <td className="td">
                        <span className={`badge ${PAYMENT_STATUS_STYLE[f.payment_status]}`}>
                          {PAYMENT_STATUS_LABEL[f.payment_status]}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </TableWrap>
          )}
        </>
      )}

      {fuente === 'pedidos' && (
        <>
      {ventas.isError && <ErrorState error={ventas.error} />}
      {ventas.isLoading && <Skeleton className="h-64" />}
      {!ventas.isLoading && filtradas.length === 0 && (
        <Card><EmptyState title="Sin pedidos en este período" /></Card>
      )}

      {filtradas.length > 0 && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Pedido</th>
              <th className="th">Cliente</th>
              <th className="th">Fecha</th>
              <th className="th">Estado</th>
              <th className="th">Neto</th>
              <th className="th">Saldo</th>
              <th className="th">Pago</th>
              <th className="th">Factura</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtradas.map((o) => {
              const saldo = Number(o.total) - Number(o.amount_paid)
              return (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="td font-mono text-xs">{o.code}</td>
                  <td className="td font-medium text-slate-800">{o.customers?.name}</td>
                  <td className="td text-slate-500">{dateShort(o.order_date)}</td>
                  <td className="td">
                    <span className={`badge ${ORDER_STATUS_STYLE[o.status]}`}>{ORDER_STATUS_LABEL[o.status]}</span>
                  </td>
                  <td className="td tabular-nums">{money(o.total)}</td>
                  <td className={`td tabular-nums ${saldo > 0 ? 'font-medium text-amber-600' : 'text-slate-400'}`}>
                    {money(saldo)}
                  </td>
                  <td className="td">
                    <span className={`badge ${PAYMENT_STATUS_STYLE[o.payment_status]}`}>
                      {PAYMENT_STATUS_LABEL[o.payment_status]}
                    </span>
                  </td>
                  <td className="td">
                    <button
                      onClick={() => setFactura(o)}
                      className="text-xs font-medium text-navy-600 hover:underline"
                    >
                      {o.invoice_number ?? 'Registrar'}
                    </button>
                  </td>
                  <td className="td text-right">
                    {saldo > 0 && (
                      <button onClick={() => setCobrar(o)} className="btn-accent px-3 py-1.5 text-xs">
                        <Wallet className="h-3.5 w-3.5" /> Cobrar
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      )}
        </>
      )}

      <DetalleFactura factura={verFactura} onClose={() => setVerFactura(null)} />
      <CobroModal orden={cobrar} onClose={() => setCobrar(null)} onGuardar={registrarPago.mutate} pendiente={registrarPago.isPending} error={registrarPago.error} />
      <FacturaModal orden={factura} onClose={() => setFactura(null)} onGuardar={guardarFactura.mutate} pendiente={guardarFactura.isPending} />
    </>
  )
}

/** El detalle de la factura: qué llevó el cliente y a qué precio. */
function DetalleFactura({ factura, onClose }: { factura: FacturaFila | null; onClose: () => void }) {
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

  return (
    <Modal open={!!factura} onClose={onClose} wide
      title={factura ? `${DOC_LABEL[factura.doc_type] ?? ''} ${factura.doc_number}` : ''}>
      {factura && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Campo k="Cliente" v={factura.customers?.name ?? '—'} />
            <Campo k="Emitida" v={dateShort(factura.issued_at)} />
            <Campo k="Vence" v={dateShort(factura.due_date)} />
            <Campo k="Saldo" v={money(Number(factura.total) - Number(factura.amount_paid))} />
          </div>

          {items.isLoading && <Skeleton className="h-32" />}
          {items.data && (
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
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(i.quantity)} kg</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(i.unit_price_net)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">{money(i.net_total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 text-sm">
                  <tr>
                    <td className="px-3 py-2 text-right text-slate-500" colSpan={3}>Neto</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(factura.net_amount)}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-right text-slate-500" colSpan={3}>IVA</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(factura.tax_amount)}</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 text-right font-medium" colSpan={3}>Total</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(factura.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function Campo({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] tracking-wide text-slate-500 uppercase">{k}</p>
      <p className="mt-0.5 font-medium text-slate-900">{v}</p>
    </div>
  )
}

function CobroModal({
  orden, onClose, onGuardar, pendiente, error,
}: {
  orden: Order | null
  onClose: () => void
  onGuardar: (v: { orden: Order; monto: number; metodo: PaymentMethod; referencia: string }) => void
  pendiente: boolean
  error: unknown
}) {
  const saldo = orden ? Number(orden.total) - Number(orden.amount_paid) : 0
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia')
  const [referencia, setReferencia] = useState('')

  return (
    <Modal
      open={!!orden}
      onClose={onClose}
      title={`Registrar cobro · ${orden?.customers?.name ?? ''}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button
            onClick={() => orden && onGuardar({ orden, monto: Number(monto) || saldo, metodo, referencia })}
            disabled={pendiente}
            className="btn-primary"
          >
            Registrar
          </button>
        </>
      }
    >
      {orden && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="text-slate-600">Pedido {orden.code}</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">Saldo {money(saldo)}</p>
          </div>
          <div>
            <label className="label">Monto</label>
            <input className="input" type="number" placeholder={String(saldo)} value={monto} onChange={(e) => setMonto(e.target.value)} />
            <p className="mt-1 text-xs text-slate-400">Si lo dejas vacío se registra el saldo completo.</p>
          </div>
          <div>
            <label className="label">Método</label>
            <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value as PaymentMethod)}>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Referencia</label>
            <input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="N° de transferencia" />
          </div>
          {!!error && <ErrorState error={error} />}
        </div>
      )}
    </Modal>
  )
}

function FacturaModal({
  orden, onClose, onGuardar, pendiente,
}: {
  orden: Order | null
  onClose: () => void
  onGuardar: (v: { orden: Order; numero: string }) => void
  pendiente: boolean
}) {
  const [numero, setNumero] = useState('')

  return (
    <Modal
      open={!!orden}
      onClose={onClose}
      title="Número de factura"
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => orden && onGuardar({ orden, numero })} disabled={pendiente} className="btn-primary">
            Guardar
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Folio emitido en Bsale</label>
          <input
            className="input"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder={orden?.invoice_number ?? 'Ej: 1245'}
          />
        </div>
        <p className="flex items-start gap-2 text-xs text-slate-500">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Por ahora el sistema registra el folio que emites en Bsale. La emisión automática queda
          para la Fase 5, cuando conectemos su cuenta.
        </p>
      </div>
    </Modal>
  )
}
