import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileText, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOperacion } from '../../lib/queries'
import type { Order, PaymentMethod } from '../../lib/types'
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_STYLE, PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE,
} from '../../lib/constants'
import { dateShort, money, moneyShort } from '../../lib/format'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, StatCard, TableWrap } from '../../components/ui'

type Rango = 'hoy' | 'semana' | 'mes' | 'todo'

export function Ventas() {
  const qc = useQueryClient()
  const operacion = useOperacion()
  const [rango, setRango] = useState<Rango>('mes')
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

  const filtradas = useMemo(
    () => (ventas.data ?? []).filter((o) => (soloDeuda ? o.payment_status !== 'pagado' : true)),
    [ventas.data, soloDeuda],
  )

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
        subtitle="Facturación, cobros y margen por período"
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
            <button onClick={exportar} className="btn-secondary">
              <Download className="h-4 w-4" /> CSV
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Venta neta" value={moneyShort(totales.neto)} hint={`${filtradas.length} pedidos`} />
        <StatCard label={`Total con IVA ${iva}%`} value={moneyShort(totales.neto * (1 + iva / 100))} />
        <StatCard label="Margen" value={moneyShort(totales.margen)} hint={totales.neto > 0 ? `${Math.round((totales.margen / totales.neto) * 100)}%` : '—'} tone="positive" />
        <StatCard label="Cobrado" value={moneyShort(totales.cobrado)} />
        <StatCard label="Por cobrar" value={moneyShort(totales.pendiente)} tone={totales.pendiente > 0 ? 'warning' : 'default'} />
      </div>

      <label className="mt-3 mb-2 flex cursor-pointer items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={soloDeuda} onChange={(e) => setSoloDeuda(e.target.checked)} className="rounded border-slate-300" />
        Ver solo lo que está pendiente de cobro
      </label>

      {ventas.isError && <ErrorState error={ventas.error} />}
      {ventas.isLoading && <Skeleton className="h-64" />}
      {!ventas.isLoading && filtradas.length === 0 && (
        <Card><EmptyState title="Sin ventas en este período" /></Card>
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

      <CobroModal orden={cobrar} onClose={() => setCobrar(null)} onGuardar={registrarPago.mutate} pendiente={registrarPago.isPending} error={registrarPago.error} />
      <FacturaModal orden={factura} onClose={() => setFactura(null)} onGuardar={guardarFactura.mutate} pendiente={guardarFactura.isPending} />
    </>
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
