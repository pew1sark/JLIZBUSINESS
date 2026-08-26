import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowRightLeft, Check, Clock, Download, Inbox, Link2, MessageCircle,
  Search, Users, Wallet, X,
} from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import type {
  AvisoPago, CuentaPorCobrar, EstadoCuentaCliente, Imputacion, PagoCartola, PagoSinImputar, PaymentMethod,
} from '../../lib/types'
import { PAYMENT_METHOD_LABEL } from '../../lib/constants'
import { dateShort, dateTime, money, moneyShort } from '../../lib/format'
import { descargarCsv } from '../../lib/csv'
import {
  Card, CardHeader, EmptyState, ErrorState, Modal, PageHeader, Skeleton, StatCard, TableWrap,
} from '../../components/ui'

const TRAMO: Record<string, { label: string; clase: string }> = {
  sin_plazo: { label: 'Sin plazo', clase: 'bg-slate-100 text-slate-600' },
  al_dia: { label: 'Al día', clase: 'bg-emerald-100 text-emerald-700' },
  atraso_leve: { label: '1 a 15 días', clase: 'bg-amber-100 text-amber-800' },
  atraso_medio: { label: '16 a 30 días', clase: 'bg-orange-100 text-orange-800' },
  atraso_grave: { label: 'Más de 30 días', clase: 'bg-red-100 text-red-700' },
}

type Pestana = 'clientes' | 'documentos' | 'pagos' | 'avisos'

export function Cobranza() {
  const qc = useQueryClient()
  const [pestana, setPestana] = useState<Pestana>('clientes')
  const [buscar, setBuscar] = useState('')
  const [cartola, setCartola] = useState<string | null>(null)
  const [cobrar, setCobrar] = useState<{ customer_id: string; cliente: string } | null>(null)
  const [reimputar, setReimputar] = useState<PagoSinImputar | null>(null)

  const clientes = useQuery({
    queryKey: ['cob-clientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_estado_cuenta_cliente').select('*').order('saldo_neto', { ascending: false })
      if (error) throw error
      return data as EstadoCuentaCliente[]
    },
  })

  const documentos = useQuery({
    queryKey: ['cob-documentos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_por_cobrar').select('*')
        .order('dias_atraso', { ascending: false }).limit(2000)
      if (error) throw error
      return data as CuentaPorCobrar[]
    },
  })

  const sinImputar = useQuery({
    queryKey: ['cob-sin-imputar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_pagos_sin_imputar').select('*').order('paid_at', { ascending: false })
      if (error) throw error
      return data as PagoSinImputar[]
    },
  })

  const avisos = useQuery({
    queryKey: ['cob-avisos'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payment_reports').select('*, customers(name)')
        .order('created_at', { ascending: false }).limit(200)
      if (error) throw error
      return data as AvisoPago[]
    },
  })

  function refrescar() {
    for (const k of ['cob-clientes', 'cob-documentos', 'cob-sin-imputar', 'cob-avisos',
                     'finance-kpis', 'cuentas-cobrar', 'dashboard-kpis']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }

  const resumen = useMemo(() => {
    const cs = clientes.data ?? []
    return {
      deuda: cs.reduce((a, c) => a + Number(c.deuda_total), 0),
      vencido: cs.reduce((a, c) => a + Number(c.vencido), 0),
      porVencer: cs.reduce((a, c) => a + Number(c.por_vencer), 0),
      grave: cs.reduce((a, c) => a + Number(c.atraso_31_60) + Number(c.atraso_60_mas), 0),
      credito: cs.reduce((a, c) => a + Number(c.nota_credito) + Number(c.pago_a_cuenta), 0),
      conDeuda: cs.filter((c) => Number(c.deuda_total) > 0).length,
    }
  }, [clientes.data])

  const avisosPendientes = (avisos.data ?? []).filter((a) => a.status === 'pendiente').length
  const q = buscar.trim().toLowerCase()

  const clientesFiltrados = (clientes.data ?? []).filter(
    (c) => Number(c.deuda_total) > 0 || Number(c.nota_credito) > 0 || Number(c.pago_a_cuenta) > 0,
  ).filter((c) => !q || c.cliente.toLowerCase().includes(q) || (c.rut ?? '').includes(q))

  const documentosFiltrados = (documentos.data ?? []).filter(
    (d) => !q || d.cliente.toLowerCase().includes(q) || (d.doc_number ?? '').includes(q),
  )

  function exportarCartera() {
    const filas: (string | number)[][] = [[
      'Cliente', 'RUT', 'Documentos', 'Deuda total', 'Por vencer', '1-15 días', '16-30 días',
      '31-60 días', '+60 días', 'Peor atraso', 'Nota de crédito', 'Pago a cuenta', 'Saldo neto',
    ]]
    for (const c of clientesFiltrados) {
      filas.push([c.cliente, c.rut ?? '', c.documentos, c.deuda_total, c.por_vencer, c.atraso_1_15,
        c.atraso_16_30, c.atraso_31_60, c.atraso_60_mas, c.peor_atraso, c.nota_credito,
        c.pago_a_cuenta, c.saldo_neto])
    }
    descargarCsv(filas, 'cartera-por-cliente')
  }

  function exportarDocumentos() {
    const filas: (string | number)[][] = [[
      'Documento', 'Tipo', 'Cliente', 'Emitida', 'Vence', 'Total', 'Pagado', 'Saldo', 'Días de atraso',
    ]]
    for (const d of documentosFiltrados) {
      filas.push([d.doc_number ?? d.code, d.doc_type, d.cliente, d.issued_at, d.due_date ?? '',
        d.total, d.amount_paid, d.saldo, d.dias_atraso])
    }
    descargarCsv(filas, 'documentos-por-cobrar')
  }

  return (
    <>
      <PageHeader
        title="Cobranza"
        subtitle="Qué debe cada cliente, desde cuándo, y qué factura cubrió cada pago"
        actions={
          <button className="btn-primary" onClick={() => setCobrar({ customer_id: '', cliente: '' })}>
            <Wallet className="h-4 w-4" /> Registrar pago
          </button>
        }
      />

      {clientes.isError && <ErrorState error={clientes.error} />}
      {clientes.isLoading && <Skeleton className="h-24" />}

      {clientes.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Deuda total" value={moneyShort(resumen.deuda)}
            hint={`${resumen.conDeuda} clientes`} icon={<Users className="h-4 w-4" />} />
          <StatCard label="Vencido" value={moneyShort(resumen.vencido)}
            tone={resumen.vencido > 0 ? 'danger' : 'positive'}
            hint={`${pctDe(resumen.vencido, resumen.deuda)} de la cartera`}
            icon={<AlertTriangle className="h-4 w-4" />} />
          <StatCard label="Más de 30 días" value={moneyShort(resumen.grave)}
            tone={resumen.grave > 0 ? 'danger' : 'default'} hint="Riesgo real de incobrable" />
          <StatCard label="Por vencer" value={moneyShort(resumen.porVencer)} tone="default"
            hint="Todavía dentro del plazo" icon={<Clock className="h-4 w-4" />} />
          <StatCard label="A favor del cliente" value={moneyShort(resumen.credito)}
            hint="Notas de crédito y pagos sin imputar" tone={resumen.credito > 0 ? 'warning' : 'default'} />
        </div>
      )}

      <div className="mt-4 mb-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm">
          {([
            ['clientes', `Por cliente${clientesFiltrados.length ? ` (${clientesFiltrados.length})` : ''}`],
            ['documentos', `Documentos${documentosFiltrados.length ? ` (${documentosFiltrados.length})` : ''}`],
            ['pagos', `Pagos${sinImputar.data?.length ? ` · ${sinImputar.data.length} sin imputar` : ''}`],
            ['avisos', `Avisos del portal${avisosPendientes ? ` (${avisosPendientes})` : ''}`],
          ] as [Pestana, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setPestana(k)}
              className={clsx('rounded-md px-4 py-1.5 font-medium',
                pestana === k ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500')}>
              {label}
            </button>
          ))}
        </div>

        {(pestana === 'clientes' || pestana === 'documentos') && (
          <>
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <input className="input pl-9" placeholder="Buscar cliente, RUT o factura…"
                value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            </div>
            <button className="btn-secondary ml-auto"
              onClick={pestana === 'clientes' ? exportarCartera : exportarDocumentos}>
              <Download className="h-4 w-4" /> Exportar
            </button>
          </>
        )}
      </div>

      {pestana === 'clientes' && (
        <TablaClientes filas={clientesFiltrados} cargando={clientes.isLoading}
          onCartola={setCartola} onCobrar={(c) => setCobrar({ customer_id: c.customer_id, cliente: c.cliente })} />
      )}

      {pestana === 'documentos' && (
        <TablaDocumentos filas={documentosFiltrados} cargando={documentos.isLoading} />
      )}

      {pestana === 'pagos' && (
        <PanelPagos sinImputar={sinImputar.data ?? []} cargando={sinImputar.isLoading}
          onImputar={setReimputar} />
      )}

      {pestana === 'avisos' && (
        <PanelAvisos avisos={avisos.data ?? []} cargando={avisos.isLoading} onHecho={refrescar} />
      )}

      {cartola && <ModalCartola customerId={cartola} onClose={() => setCartola(null)} />}

      {cobrar && (
        <ModalCobrar inicial={cobrar} clientes={clientes.data ?? []}
          onClose={() => setCobrar(null)} onHecho={() => { setCobrar(null); refrescar() }} />
      )}

      {reimputar && (
        <ModalImputar pago={reimputar} onClose={() => setReimputar(null)}
          onHecho={() => { setReimputar(null); refrescar() }} />
      )}
    </>
  )
}

const pctDe = (parte: number, total: number) =>
  total > 0 ? `${Math.round((parte / total) * 100)}%` : '0%'

// ---------------------------------------------------------------- clientes
function TablaClientes({
  filas, cargando, onCartola, onCobrar,
}: {
  filas: EstadoCuentaCliente[]
  cargando: boolean
  onCartola: (id: string) => void
  onCobrar: (c: EstadoCuentaCliente) => void
}) {
  if (cargando) return <Skeleton className="h-64" />
  if (!filas.length) {
    return (
      <Card>
        <EmptyState title="Nadie debe nada" hint="Toda la cartera está cobrada." icon={<Check className="h-8 w-8" />} />
      </Card>
    )
  }
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className="th">Cliente</th>
          <th className="th text-right">Docs</th>
          <th className="th text-right">Por vencer</th>
          <th className="th text-right">1-15 d</th>
          <th className="th text-right">16-30 d</th>
          <th className="th text-right">31-60 d</th>
          <th className="th text-right">+60 d</th>
          <th className="th text-right">A favor</th>
          <th className="th text-right">Saldo neto</th>
          <th className="th"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {filas.map((c) => {
          const aFavor = Number(c.nota_credito) + Number(c.pago_a_cuenta)
          return (
            <tr key={c.customer_id} className="hover:bg-slate-50">
              <td className="td">
                <button onClick={() => onCartola(c.customer_id)}
                  className="text-left font-medium text-navy-900 hover:text-sea-600">
                  {c.cliente}
                </button>
                <p className="text-xs text-slate-400">
                  {c.rut} · {c.payment_terms_days} días
                  {c.peor_atraso > 0 && (
                    <span className="ml-1 text-red-600">· {c.peor_atraso} días de atraso</span>
                  )}
                </p>
              </td>
              <td className="td text-right tabular-nums text-slate-500">{c.documentos}</td>
              <td className="td text-right tabular-nums text-slate-500">{corto(c.por_vencer)}</td>
              <td className="td text-right tabular-nums text-amber-700">{corto(c.atraso_1_15)}</td>
              <td className="td text-right tabular-nums text-orange-700">{corto(c.atraso_16_30)}</td>
              <td className="td text-right tabular-nums font-medium text-red-600">{corto(c.atraso_31_60)}</td>
              <td className="td text-right tabular-nums font-semibold text-red-700">{corto(c.atraso_60_mas)}</td>
              <td className="td text-right tabular-nums text-emerald-600">{aFavor > 0 ? corto(aFavor) : '—'}</td>
              <td className="td text-right font-semibold tabular-nums">{money(c.saldo_neto)}</td>
              <td className="td">
                <div className="flex justify-end gap-1">
                  <button onClick={() => onCobrar(c)} className="btn-secondary px-2 py-1 text-xs">
                    Cobrar
                  </button>
                  {c.whatsapp && (
                    <a className="btn-secondary px-2 py-1 text-xs" target="_blank" rel="noreferrer"
                      href={linkWhatsapp(c)} title="Enviar recordatorio">
                      <MessageCircle className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </TableWrap>
  )
}

const corto = (v: number) => (Number(v) > 0 ? moneyShort(v) : '—')

function linkWhatsapp(c: EstadoCuentaCliente) {
  const tel = (c.whatsapp ?? '').replace(/\D/g, '')
  const texto =
    `Hola ${c.cliente}: le escribimos de Pescadería Bilagay. ` +
    `Tiene ${c.documentos} documento(s) pendientes por ${money(c.deuda_total)}` +
    (Number(c.vencido) > 0 ? `, de los cuales ${money(c.vencido)} ya están vencidos` : '') +
    `. Cualquier duda quedamos atentos. Gracias.`
  return `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`
}

// ---------------------------------------------------------------- documentos
function TablaDocumentos({ filas, cargando }: { filas: CuentaPorCobrar[]; cargando: boolean }) {
  if (cargando) return <Skeleton className="h-64" />
  if (!filas.length) {
    return <Card><EmptyState title="Sin documentos por cobrar" /></Card>
  }
  return (
    <TableWrap>
      <thead>
        <tr>
          <th className="th">Documento</th>
          <th className="th">Cliente</th>
          <th className="th">Emitida</th>
          <th className="th">Vence</th>
          <th className="th text-right">Total</th>
          <th className="th text-right">Pagado</th>
          <th className="th text-right">Saldo</th>
          <th className="th">Estado</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {filas.slice(0, 500).map((d) => (
          <tr key={`${d.origen}-${d.ref_id}`} className="hover:bg-slate-50">
            <td className="td">
              <p className="font-medium text-navy-900">{d.doc_number ?? d.code}</p>
              <p className="text-xs text-slate-400">{etiquetaDoc(d.doc_type)}</p>
            </td>
            <td className="td text-slate-600">{d.cliente}</td>
            <td className="td text-slate-500">{dateShort(d.issued_at)}</td>
            <td className="td text-slate-500">{dateShort(d.due_date)}</td>
            <td className="td text-right tabular-nums text-slate-500">{money(d.total)}</td>
            <td className="td text-right tabular-nums text-slate-500">
              {Number(d.amount_paid) > 0 ? money(d.amount_paid) : '—'}
            </td>
            <td className="td text-right font-semibold tabular-nums">{money(d.saldo)}</td>
            <td className="td">
              <span className={clsx('badge', TRAMO[d.tramo]?.clase)}>
                {TRAMO[d.tramo]?.label}
                {d.dias_atraso > 0 && ` · ${d.dias_atraso}d`}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  )
}

const etiquetaDoc = (t: string) =>
  ({ factura: 'Factura', boleta: 'Boleta', nota_debito: 'Nota de débito',
     pedido: 'Pedido interno', saldo_inicial: 'Saldo arrastrado' } as Record<string, string>)[t] ?? t

// ---------------------------------------------------------------- pagos
function PanelPagos({
  sinImputar, cargando, onImputar,
}: {
  sinImputar: PagoSinImputar[]
  cargando: boolean
  onImputar: (p: PagoSinImputar) => void
}) {
  const pagos = useQuery({
    queryKey: ['cob-pagos-recientes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('id, code, amount, method, paid_at, reference, notes, customers(name), payment_allocations(amount)')
        .eq('direction', 'cobro').order('paid_at', { ascending: false }).limit(100)
      if (error) throw error
      return data as unknown as {
        id: string; code: string; amount: number; method: PaymentMethod; paid_at: string
        reference: string | null; notes: string | null
        customers: { name: string } | null
        payment_allocations: { amount: number }[]
      }[]
    },
  })

  if (cargando) return <Skeleton className="h-64" />

  return (
    <div className="space-y-4">
      {sinImputar.length > 0 && (
        <Card>
          <CardHeader title={`${sinImputar.length} pago(s) sin imputar`} />
          <div className="border-t border-amber-200 bg-amber-50/60 px-5 py-3 text-sm text-amber-900">
            Es plata que ya entró pero que todavía no está asignada a ninguna factura.
            Mientras siga acá, la deuda del cliente se ve más alta de lo que realmente es.
          </div>
          <div className="divide-y divide-slate-100">
            {sinImputar.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-navy-900">{p.cliente}</p>
                  <p className="text-xs text-slate-400">
                    {p.code} · {dateShort(p.paid_at)} · {PAYMENT_METHOD_LABEL[p.method]}
                    {p.reference && ` · ref ${p.reference}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums text-amber-700">{money(p.sin_imputar)}</p>
                  <p className="text-xs text-slate-400">de {money(p.amount)}</p>
                </div>
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => onImputar(p)}>
                  <ArrowRightLeft className="h-3.5 w-3.5" /> Imputar
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Últimos cobros registrados" />
        {pagos.isLoading && <Skeleton className="m-5 h-32" />}
        {pagos.data?.length === 0 && (
          <EmptyState title="Todavía no hay cobros registrados"
            hint="Cuando registres el primer pago aparecerá acá con las facturas que cubrió." />
        )}
        <div className="divide-y divide-slate-100">
          {(pagos.data ?? []).map((p) => {
            const imputado = (p.payment_allocations ?? []).reduce((a, x) => a + Number(x.amount), 0)
            const resto = Number(p.amount) - imputado
            return (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-navy-900">{p.customers?.name ?? '—'}</p>
                  <p className="text-xs text-slate-400">
                    {p.code} · {dateTime(p.paid_at)} · {PAYMENT_METHOD_LABEL[p.method]}
                    {p.reference && ` · ref ${p.reference}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums">{money(p.amount)}</p>
                  <p className="text-xs text-slate-400">
                    {(p.payment_allocations ?? []).length} documento(s)
                    {resto > 0.5 && <span className="text-amber-600"> · {money(resto)} sin imputar</span>}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------- avisos del portal
function PanelAvisos({
  avisos, cargando, onHecho,
}: {
  avisos: AvisoPago[]
  cargando: boolean
  onHecho: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const confirmar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('confirm_payment_report', { _report_id: id, _auto: true })
      if (error) throw error
    },
    onSuccess: onHecho,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const rechazar = useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await supabase.rpc('reject_payment_report', { _report_id: id, _notes: motivo })
      if (error) throw error
    },
    onSuccess: onHecho,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  if (cargando) return <Skeleton className="h-64" />
  if (!avisos.length) {
    return (
      <Card>
        <EmptyState title="Sin avisos de pago"
          hint="Cuando un cliente informe una transferencia desde su portal, aparecerá acá para que la confirmes."
          icon={<Inbox className="h-8 w-8" />} />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader title="Transferencias informadas por los clientes" />
      {error && <div className="mx-5 mt-3"><ErrorState error={error} /></div>}
      <div className="border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
        Al confirmar, el pago se registra y se imputa a las facturas más antiguas del cliente.
        Después puedes cambiar la imputación desde la pestaña de Pagos.
      </div>
      <div className="divide-y divide-slate-100">
        {avisos.map((a) => (
          <div key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-navy-900">{a.customers?.name ?? '—'}</p>
              <p className="text-xs text-slate-400">
                {a.code} · pagó el {dateShort(a.paid_at)} · {PAYMENT_METHOD_LABEL[a.method]}
                {a.reference && ` · ref ${a.reference}`} · avisó {dateTime(a.created_at)}
              </p>
              {a.notes && <p className="mt-1 text-xs text-slate-500 italic">"{a.notes}"</p>}
            </div>
            <p className="font-semibold tabular-nums">{money(a.amount)}</p>
            {a.status === 'pendiente' ? (
              <div className="flex gap-1">
                <button className="btn-primary px-3 py-1.5 text-xs"
                  disabled={confirmar.isPending}
                  onClick={() => confirmar.mutate(a.id)}>
                  <Check className="h-3.5 w-3.5" /> Confirmar
                </button>
                <button className="btn-secondary px-3 py-1.5 text-xs"
                  disabled={rechazar.isPending}
                  onClick={() => {
                    const motivo = window.prompt('¿Por qué se rechaza este aviso?')
                    if (motivo) rechazar.mutate({ id: a.id, motivo })
                  }}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <span className={clsx('badge', a.status === 'confirmado'
                ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600')}>
                {a.status === 'confirmado' ? 'Confirmado' : 'Rechazado'}
              </span>
            )}
          </div>
        ))}
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------- cartola
function ModalCartola({
  customerId, onClose,
}: {
  customerId: string
  onClose: () => void
}) {
  const [enlace, setEnlace] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const cartola = useQuery({
    queryKey: ['cartola', customerId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('customer_statement', { _customer_id: customerId })
      if (error) throw error
      return data as {
        ok: boolean
        cliente: EstadoCuentaCliente
        documentos: CuentaPorCobrar[]
        pagos: PagoCartola[]
        notas_credito: { doc_number: string; issued_at: string; disponible: number }[]
      }
    },
  })

  const generar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('portal_link', { _customer_id: customerId })
      if (error) throw error
      return data as { ok: boolean; token: string }
    },
    onSuccess: (d) => setEnlace(`${window.location.origin}${window.location.pathname}#/portal/${d.token}`),
  })

  const c = cartola.data?.cliente

  return (
    <Modal open onClose={onClose} wide title={c?.cliente ?? 'Cartola del cliente'}>
      {cartola.isLoading && <Skeleton className="h-64" />}
      {cartola.isError && <ErrorState error={cartola.error} />}

      {cartola.data && c && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Dato label="Deuda total" valor={money(c.deuda_total)} />
            <Dato label="Vencido" valor={money(c.vencido)} tono={Number(c.vencido) > 0 ? 'malo' : undefined} />
            <Dato label="A favor" valor={money(Number(c.nota_credito) + Number(c.pago_a_cuenta))}
              tono={Number(c.nota_credito) + Number(c.pago_a_cuenta) > 0 ? 'bueno' : undefined} />
            <Dato label="Saldo neto" valor={money(c.saldo_neto)} />
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link2 className="h-4 w-4 text-slate-400" />
              <p className="flex-1 text-sm text-slate-600">
                Portal de pagos del cliente — enlace personal para enviar por WhatsApp
              </p>
              <button className="btn-secondary px-3 py-1.5 text-xs" disabled={generar.isPending}
                onClick={() => generar.mutate()}>
                {enlace ? 'Regenerar' : 'Generar enlace'}
              </button>
            </div>
            {enlace && (
              <div className="mt-2 flex items-center gap-2">
                <input readOnly value={enlace} className="input flex-1 text-xs" />
                <button className="btn-secondary px-3 py-1.5 text-xs"
                  onClick={() => {
                    navigator.clipboard.writeText(enlace)
                    setCopiado(true)
                    setTimeout(() => setCopiado(false), 1800)
                  }}>
                  {copiado ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            )}
          </div>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">
              Documentos pendientes ({cartola.data.documentos.length})
            </h4>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Documento</th>
                    <th className="px-3 py-2 text-left">Vence</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2 text-right">Saldo</th>
                    <th className="px-3 py-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {cartola.data.documentos.map((d) => (
                    <tr key={`${d.origen}-${d.ref_id}`}>
                      <td className="px-3 py-2 font-medium">{d.doc_number ?? d.code}</td>
                      <td className="px-3 py-2 text-slate-500">{dateShort(d.due_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(d.total)}</td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">{money(d.saldo)}</td>
                      <td className="px-3 py-2">
                        <span className={clsx('badge', TRAMO[d.tramo]?.clase)}>
                          {d.dias_atraso > 0 ? `${d.dias_atraso} días` : TRAMO[d.tramo]?.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!cartola.data.documentos.length && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Sin deuda pendiente</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {cartola.data.notas_credito.length > 0 && (
            <section>
              <h4 className="mb-2 text-sm font-semibold text-slate-700">Notas de crédito a favor</h4>
              <div className="space-y-1">
                {cartola.data.notas_credito.map((n) => (
                  <div key={n.doc_number} className="flex justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm">
                    <span>NC {n.doc_number} · {dateShort(n.issued_at)}</span>
                    <span className="font-medium tabular-nums text-emerald-700">{money(n.disponible)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <h4 className="mb-2 text-sm font-semibold text-slate-700">
              Pagos recibidos ({cartola.data.pagos.length})
            </h4>
            {!cartola.data.pagos.length && (
              <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">
                Este cliente todavía no tiene pagos registrados
              </p>
            )}
            <div className="space-y-2">
              {cartola.data.pagos.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{dateShort(p.paid_at)} · {PAYMENT_METHOD_LABEL[p.method]}</span>
                    <span className="font-semibold tabular-nums">{money(p.amount)}</span>
                  </div>
                  {p.aplicado_a.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">
                      Cubrió: {p.aplicado_a.map((a) => `${a.documento} (${money(a.amount)})`).join(' · ')}
                    </p>
                  )}
                  {Number(p.sin_imputar) > 0.5 && (
                    <p className="mt-1 text-xs text-amber-600">
                      {money(p.sin_imputar)} todavía sin imputar
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </Modal>
  )
}

function Dato({ label, valor, tono }: { label: string; valor: string; tono?: 'bueno' | 'malo' }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <p className="text-[11px] tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={clsx('mt-0.5 font-semibold tabular-nums',
        tono === 'malo' ? 'text-red-600' : tono === 'bueno' ? 'text-emerald-600' : 'text-slate-900')}>
        {valor}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------- registrar cobro
function ModalCobrar({
  inicial, clientes, onClose, onHecho,
}: {
  inicial: { customer_id: string; cliente: string }
  clientes: EstadoCuentaCliente[]
  onClose: () => void
  onHecho: () => void
}) {
  const [customerId, setCustomerId] = useState(inicial.customer_id)
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [referencia, setReferencia] = useState('')
  const [modo, setModo] = useState<'auto' | 'manual'>('auto')
  const [reparto, setReparto] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const docs = useQuery({
    queryKey: ['cob-docs-cliente', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_por_cobrar').select('*').eq('customer_id', customerId)
        .order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data as CuentaPorCobrar[]
    },
  })

  const montoNum = Number(monto) || 0
  const imputado = Object.values(reparto).reduce((a, v) => a + (Number(v) || 0), 0)
  const resto = montoNum - imputado

  // Reparte el monto entre las facturas más antiguas, que es la regla por defecto.
  function repartirAutomatico() {
    let quedan = montoNum
    const nuevo: Record<string, string> = {}
    for (const d of docs.data ?? []) {
      if (quedan <= 0) break
      const aplica = Math.min(quedan, Number(d.saldo))
      nuevo[`${d.origen}:${d.ref_id}`] = String(Math.round(aplica))
      quedan -= aplica
    }
    setReparto(nuevo)
    setModo('manual')
  }

  const guardar = useMutation({
    mutationFn: async () => {
      const allocations: Imputacion[] = Object.entries(reparto)
        .filter(([, v]) => Number(v) > 0)
        .map(([k, v]) => {
          const [kind, id] = k.split(':')
          return { kind: kind as Imputacion['kind'], id, amount: Number(v) }
        })

      const { data, error } = await supabase.rpc('register_customer_payment', {
        _customer_id: customerId,
        _amount: montoNum,
        _method: metodo,
        _paid_at: new Date(`${fecha}T12:00:00`).toISOString(),
        _reference: referencia.trim() || null,
        _notes: null,
        _allocations: modo === 'manual' ? allocations : null,
        _auto: modo === 'auto',
      })
      if (error) throw error
      return data
    },
    onSuccess: onHecho,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const listo = !!customerId && montoNum > 0 && (modo === 'auto' || imputado <= montoNum + 0.5)

  return (
    <Modal open onClose={onClose} wide title="Registrar un cobro"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!listo || guardar.isPending}
            onClick={() => guardar.mutate()}>
            {guardar.isPending ? 'Guardando…' : 'Registrar cobro'}
          </button>
        </>
      }>
      <div className="space-y-4">
        {error && <ErrorState error={error} />}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Cliente</span>
            <select className="input" value={customerId}
              onChange={(e) => { setCustomerId(e.target.value); setReparto({}) }}>
              <option value="">Selecciona…</option>
              {clientes.map((c) => (
                <option key={c.customer_id} value={c.customer_id}>
                  {c.cliente} — debe {money(c.deuda_total)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Monto recibido</span>
            <input className="input" type="number" min={0} value={monto} placeholder="0"
              onChange={(e) => setMonto(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Forma de pago</span>
            <select className="input" value={metodo}
              onChange={(e) => setMetodo(e.target.value as PaymentMethod)}>
              {(Object.keys(PAYMENT_METHOD_LABEL) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="label">Fecha del pago</span>
            <input className="input" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">Referencia o número de operación</span>
            <input className="input" value={referencia} placeholder="Opcional"
              onChange={(e) => setReferencia(e.target.value)} />
          </label>
        </div>

        <div className="rounded-lg border border-slate-200">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
            <p className="flex-1 text-sm font-medium text-slate-700">¿Qué facturas cubre este pago?</p>
            <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 text-xs">
              <button onClick={() => { setModo('auto'); setReparto({}) }}
                className={clsx('rounded px-3 py-1', modo === 'auto' ? 'bg-white shadow-sm' : 'text-slate-500')}>
                Las más antiguas
              </button>
              <button onClick={() => setModo('manual')}
                className={clsx('rounded px-3 py-1', modo === 'manual' ? 'bg-white shadow-sm' : 'text-slate-500')}>
                Elegir yo
              </button>
            </div>
          </div>

          {modo === 'auto' ? (
            <p className="px-4 py-4 text-sm text-slate-500">
              El pago se va a aplicar a las facturas con vencimiento más antiguo hasta agotar el monto.
              Si sobra, queda como saldo a favor del cliente y lo puedes imputar después.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 text-xs">
                <button className="text-sea-600 hover:underline" onClick={repartirAutomatico}
                  disabled={!montoNum}>
                  Repartir automáticamente desde la más antigua
                </button>
                <span className={clsx('tabular-nums',
                  resto < -0.5 ? 'font-medium text-red-600' : 'text-slate-500')}>
                  Imputado {money(imputado)} · resto {money(resto)}
                </span>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {docs.isLoading && <Skeleton className="m-4 h-24" />}
                {docs.data?.length === 0 && (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">
                    Este cliente no tiene documentos pendientes
                  </p>
                )}
                {(docs.data ?? []).map((d) => {
                  const key = `${d.origen}:${d.ref_id}`
                  return (
                    <div key={key} className="flex items-center gap-3 border-b border-slate-50 px-4 py-2 text-sm">
                      <input type="checkbox" className="h-4 w-4"
                        checked={!!reparto[key]}
                        onChange={(e) => setReparto((r) => {
                          const n = { ...r }
                          if (e.target.checked) n[key] = String(Math.round(Number(d.saldo)))
                          else delete n[key]
                          return n
                        })} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-800">{d.doc_number ?? d.code}</p>
                        <p className="text-xs text-slate-400">
                          vence {dateShort(d.due_date)}
                          {d.dias_atraso > 0 && ` · ${d.dias_atraso} días de atraso`}
                          {' · saldo '}{money(d.saldo)}
                        </p>
                      </div>
                      <input type="number" min={0} max={Number(d.saldo)}
                        className="input w-32 text-right" placeholder="0"
                        value={reparto[key] ?? ''}
                        onChange={(e) => setReparto((r) => ({ ...r, [key]: e.target.value }))} />
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {resto > 0.5 && modo === 'manual' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Quedan {money(resto)} sin asignar. Se guardan como saldo a favor del cliente
            y quedan listados en la pestaña de Pagos para imputar cuando se sepa a qué factura van.
          </p>
        )}
        {resto < -0.5 && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            Estás asignando {money(-resto)} más de lo que se recibió.
          </p>
        )}
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------- imputar un pago existente
function ModalImputar({
  pago, onClose, onHecho,
}: {
  pago: PagoSinImputar
  onClose: () => void
  onHecho: () => void
}) {
  const [reparto, setReparto] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const docs = useQuery({
    queryKey: ['cob-docs-cliente', pago.customer_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_por_cobrar').select('*').eq('customer_id', pago.customer_id)
        .order('due_date', { ascending: true, nullsFirst: false })
      if (error) throw error
      return data as CuentaPorCobrar[]
    },
  })

  const imputado = Object.values(reparto).reduce((a, v) => a + (Number(v) || 0), 0)
  const resto = Number(pago.amount) - imputado

  const auto = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('auto_allocate_payment', { _payment_id: pago.id })
      if (error) throw error
    },
    onSuccess: onHecho,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const manual = useMutation({
    mutationFn: async () => {
      const allocations: Imputacion[] = Object.entries(reparto)
        .filter(([, v]) => Number(v) > 0)
        .map(([k, v]) => {
          const [kind, id] = k.split(':')
          return { kind: kind as Imputacion['kind'], id, amount: Number(v) }
        })
      const { error } = await supabase.rpc('allocate_payment', {
        _payment_id: pago.id, _allocations: allocations,
      })
      if (error) throw error
    },
    onSuccess: onHecho,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  return (
    <Modal open onClose={onClose} wide title={`Imputar el pago de ${pago.cliente}`}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-secondary" disabled={auto.isPending} onClick={() => auto.mutate()}>
            Aplicar a las más antiguas
          </button>
          <button className="btn-primary" disabled={imputado <= 0 || resto < -0.5 || manual.isPending}
            onClick={() => manual.mutate()}>
            Guardar imputación
          </button>
        </>
      }>
      <div className="space-y-3">
        {error && <ErrorState error={error} />}

        <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
          <div>
            <p className="text-sm text-slate-500">{pago.code} · {dateShort(pago.paid_at)}</p>
            <p className="font-semibold">{money(pago.amount)}</p>
          </div>
          <div className="text-right text-sm">
            <p className="text-slate-500">Sin imputar</p>
            <p className="font-semibold tabular-nums text-amber-700">{money(resto)}</p>
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-200">
          {docs.isLoading && <Skeleton className="m-4 h-24" />}
          {docs.data?.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-400">
              Este cliente no tiene documentos pendientes. El pago queda como saldo a favor.
            </p>
          )}
          {(docs.data ?? []).map((d) => {
            const key = `${d.origen}:${d.ref_id}`
            return (
              <div key={key} className="flex items-center gap-3 border-b border-slate-50 px-4 py-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={!!reparto[key]}
                  onChange={(e) => setReparto((r) => {
                    const n = { ...r }
                    if (e.target.checked) {
                      n[key] = String(Math.round(Math.min(Number(d.saldo), Math.max(resto, 0) + Number(r[key] ?? 0))))
                    } else delete n[key]
                    return n
                  })} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-800">{d.doc_number ?? d.code}</p>
                  <p className="text-xs text-slate-400">
                    vence {dateShort(d.due_date)}
                    {d.dias_atraso > 0 && ` · ${d.dias_atraso} días de atraso`}
                    {' · saldo '}{money(d.saldo)}
                  </p>
                </div>
                <input type="number" min={0} max={Number(d.saldo)} className="input w-32 text-right"
                  placeholder="0" value={reparto[key] ?? ''}
                  onChange={(e) => setReparto((r) => ({ ...r, [key]: e.target.value }))} />
              </div>
            )
          })}
        </div>

        {resto < -0.5 && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            Estás asignando {money(-resto)} más de lo que tiene el pago.
          </p>
        )}
      </div>
    </Modal>
  )
}
