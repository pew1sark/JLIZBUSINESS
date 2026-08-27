import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Download, FileText, MessageCircle, Search, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import type { PaymentMethod } from '../../lib/types'
import { PAYMENT_METHOD_LABEL } from '../../lib/constants'
import { dateShort, money, moneyShort, pct } from '../../lib/format'
import { descargarCsv } from '../../lib/csv'
import { FiltroPeriodo } from '../../components/Filtros'
import { rangoDe, type Periodo } from '../../lib/periodo'
import { ReporteCobro } from '../../components/ReporteCobro'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Pestanas, Skeleton, StatCard, TableWrap } from '../../components/ui'

interface Kpis {
  venta_mes: number
  venta_costeada: number
  cobertura_costo_pct: number
  costo_mes: number
  margen_bruto: number
  margen_bruto_pct: number
  costos_fijos_mes: number
  costos_fijos_proporcional: number
  resultado_estimado: number
  punto_equilibrio_venta: number
  por_cobrar: number
  vencido: number
  por_pagar: number
  cobrado_mes: number
  notas_credito_mes: number
  pagado_mes: number
}

interface Cobrar {
  origen: 'pedido' | 'saldo_inicial'
  ref_id: string
  order_id: string | null
  code: string
  customer_id: string
  cliente: string
  issued_at: string
  whatsapp: string | null
  phone: string | null
  due_date: string | null
  total: number
  amount_paid: number
  saldo: number
  dias_atraso: number
  tramo: 'sin_plazo' | 'al_dia' | 'atraso_leve' | 'atraso_medio' | 'atraso_grave'
  invoice_number: string | null
}

interface Pagar {
  origen: 'compra' | 'nota_credito' | 'saldo_inicial'
  ref_id: string
  purchase_id: string | null
  code: string
  proveedor: string
  issued_at: string
  due_date: string | null
  saldo: number
  /** Bruto del documento: es lo que se le paga al proveedor, con IVA. */
  total: number
  /** Neto de la mercadería, que es la base del costeo. No es lo que se paga. */
  neto_mercaderia: number
  net_amount: number | null
  exempt_amount: number
  tax_amount: number
  invoice_number: string | null
  document_url: string | null
  dte_type: number | null
  amount_paid: number
  dias_atraso: number
}

interface Margen {
  producto?: string
  cliente?: string
  kilos: number
  venta: number
  costo: number
  margen: number
  margen_pct: number
  pedidos?: number
}

/** Tipos de documento tributario que llegan del SII vía Bsale. */
const DTE_LABEL: Record<number, string> = {
  33: 'Factura afecta',
  34: 'Factura exenta',
  61: 'Nota de crédito',
}

const TRAMO: Record<Cobrar['tramo'], { label: string; clase: string }> = {
  sin_plazo: { label: 'Sin plazo', clase: 'bg-slate-100 text-slate-600' },
  al_dia: { label: 'Al día', clase: 'bg-emerald-100 text-emerald-700' },
  atraso_leve: { label: 'Atraso leve', clase: 'bg-amber-100 text-amber-800' },
  atraso_medio: { label: 'Atraso medio', clase: 'bg-orange-100 text-orange-800' },
  atraso_grave: { label: 'Atraso grave', clase: 'bg-red-100 text-red-700' },
}

type Pestana = 'cobranza' | 'pagos' | 'rentabilidad'

export function Finanzas() {
  const qc = useQueryClient()
  const [pestana, setPestana] = useState<Pestana>('cobranza')
  const [cobrar, setCobrar] = useState<Cobrar | null>(null)
  const [pagar, setPagar] = useState<Pagar | null>(null)
  // Cobranza se hace por cliente, no documento por documento: el reporte junta
  // todo lo que le debe uno solo y arma el mensaje de una vez.
  const [reporte, setReporte] = useState<{ id: string; nombre: string } | null>(null)
  const [buscar, setBuscar] = useState('')
  const [periodo, setPeriodo] = useState<Periodo>(() => rangoDe('todo'))

  const kpis = useQuery({
    queryKey: ['finance-kpis'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('finance_kpis')
      if (error) throw error
      return data as Kpis
    },
  })

  const porCobrar = useQuery({
    queryKey: ['cuentas-cobrar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_por_cobrar')
        .select('*')
        .order('dias_atraso', { ascending: false })
      if (error) throw error
      return data as Cobrar[]
    },
  })

  const porPagar = useQuery({
    queryKey: ['cuentas-pagar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_por_pagar')
        .select('*')
        .order('dias_atraso', { ascending: false })
      if (error) throw error
      return data as Pagar[]
    },
  })


  // Cobranza y pagos comparten buscador y período: son la misma pregunta
  // ("qué debo / qué me deben") mirada desde los dos lados.
  const { desde, hasta } = periodo
  const cobrarFiltrado = useMemo(() => {
    const t = buscar.trim().toLowerCase()
    return (porCobrar.data ?? []).filter((c) => {
      const f = c.due_date?.slice(0, 10)
      if ((desde || hasta) && !f) return false
      if (desde && f && f < desde) return false
      if (hasta && f && f > hasta) return false
      return !t || c.cliente.toLowerCase().includes(t)
        || (c.invoice_number ?? '').toLowerCase().includes(t)
        || c.code.toLowerCase().includes(t)
    })
  }, [porCobrar.data, buscar, desde, hasta])

  const pagarFiltrado = useMemo(() => {
    const t = buscar.trim().toLowerCase()
    return (porPagar.data ?? []).filter((p) => {
      const f = p.issued_at?.slice(0, 10)
      if ((desde || hasta) && !f) return false
      if (desde && f && f < desde) return false
      if (hasta && f && f > hasta) return false
      return !t || p.proveedor.toLowerCase().includes(t) || p.code.toLowerCase().includes(t)
    })
  }, [porPagar.data, buscar, desde, hasta])

  // El neto de mercadería no es lo que se paga: hay que sumarle el IVA y lo que
  // viene en la misma factura sin ser mercadería. Los tres números juntos
  // explican de dónde sale el total, que es la pregunta al pagar.
  const totalesPagar = useMemo(() => {
    const p = pagarFiltrado
    const neto = p.reduce((a, x) => a + Number(x.neto_mercaderia ?? 0), 0)
    const iva = p.reduce((a, x) => a + Number(x.tax_amount ?? 0), 0)
    const bruto = p.reduce((a, x) => a + Number(x.total), 0)
    return { neto, iva, bruto, otros: bruto - iva - neto }
  }, [pagarFiltrado])

  const totalesCobrar = useMemo(() => {
    const c = cobrarFiltrado
    const venc = c.filter((x) => x.dias_atraso > 0)
    return {
      documentos: c.length,
      clientes: new Set(c.map((x) => x.customer_id)).size,
      facturado: c.reduce((a, x) => a + Number(x.total), 0),
      cobrado: c.reduce((a, x) => a + Number(x.amount_paid), 0),
      saldo: c.reduce((a, x) => a + Number(x.saldo), 0),
      vencido: venc.reduce((a, x) => a + Number(x.saldo), 0),
      docsVencidos: venc.length,
      grave: c.filter((x) => x.dias_atraso > 30).reduce((a, x) => a + Number(x.saldo), 0),
    }
  }, [cobrarFiltrado])

  // Con un filtro puesto, los saldos de arriba muestran lo filtrado. El resto
  // de las tarjetas es del mes y no depende del filtro, por eso van separadas.
  const filtrando = !!buscar.trim() || !!periodo.desde || !!periodo.hasta

  // Para el reporte se toma TODA la deuda del cliente, no la filtrada: el
  // mensaje que se le manda tiene que estar completo aunque en pantalla se
  // esté mirando un mes.
  const docsDelReporte = useMemo(() => {
    if (!reporte) return []
    return (porCobrar.data ?? [])
      .filter((c) => c.customer_id === reporte.id)
      .map((c) => ({
        documento: c.invoice_number ?? c.code,
        issued_at: c.issued_at,
        due_date: c.due_date,
        total: Number(c.total),
        saldo: Number(c.saldo),
        dias_atraso: c.dias_atraso,
      }))
  }, [porCobrar.data, reporte])

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['finance-kpis'] })
    qc.invalidateQueries({ queryKey: ['cuentas-cobrar'] })
    qc.invalidateQueries({ queryKey: ['cuentas-pagar'] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis'] })
  }

  const k = kpis.data
  // Sin costos cargados no hay margen que mostrar: cualquier resultado sería inventado.
  // Y con cobertura baja, el resultado del mes tampoco es una pérdida real:
  // es costo que falta. Por eso el aviso de pérdida exige cobertura suficiente.
  const cobertura = k?.cobertura_costo_pct ?? 0
  const sinCosto = cobertura === 0
  const costoParcial = !sinCosto && cobertura < 95
  const margenFiable = cobertura >= 80
  const enPerdida = margenFiable && (k?.resultado_estimado ?? 0) < 0

  function exportarCobranza() {
    const filas = [['Pedido', 'Cliente', 'Vence', 'Total', 'Pagado', 'Saldo', 'Días de atraso', 'Factura']]
    for (const c of cobrarFiltrado) {
      filas.push([c.code, c.cliente, c.due_date ?? '', String(c.total), String(c.amount_paid),
        String(c.saldo), String(c.dias_atraso), c.invoice_number ?? ''])
    }
    descargarCsv(filas, 'cuentas-por-cobrar')
  }

  function exportarPagos() {
    const filas: (string | number)[][] = [[
      'Proveedor', 'Documento', 'N° de factura', 'Tipo', 'Fecha', 'Vence',
      'Neto de mercadería', 'Neto afecto', 'Exento', 'IVA', 'Total del documento',
      'Pagado', 'Saldo', 'Días de atraso', 'Enlace al documento',
    ]]
    for (const p of pagarFiltrado) {
      filas.push([
        p.proveedor, p.code, p.invoice_number ?? '',
        p.origen === 'nota_credito' ? 'Nota de crédito' : DTE_LABEL[p.dte_type ?? 0] ?? '',
        p.issued_at, p.due_date ?? '',
        p.neto_mercaderia, p.net_amount ?? '', p.exempt_amount, p.tax_amount, p.total,
        p.amount_paid, p.saldo, p.dias_atraso, p.document_url ?? '',
      ])
    }
    descargarCsv(filas, `cuentas-por-pagar-${periodo.desde ?? 'todo'}`)
  }

  return (
    <>
      <PageHeader
        title="Finanzas"
        subtitle="Cobranza, pagos a proveedores y rentabilidad real del mes"
      />

      {kpis.isError && <ErrorState error={kpis.error} />}
      {kpis.isLoading && <Skeleton className="h-24" />}

      {k && (
        <>
          <p className="mb-2 text-xs font-medium tracking-wide text-slate-400 uppercase">
            Del mes en curso · los dos últimos siguen el filtro
          </p>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <StatCard label="Venta del mes" value={moneyShort(k.venta_mes)}
              hint={k.notas_credito_mes > 0
                ? `ya descontados ${moneyShort(k.notas_credito_mes)} en notas de crédito`
                : undefined}
              icon={<TrendingUp className="h-4 w-4" />} />
            <StatCard
              label="Margen bruto"
              value={sinCosto ? '—' : pct(k.margen_bruto_pct)}
              hint={sinCosto ? 'falta cargar el costo' : money(k.margen_bruto)}
              tone={sinCosto ? 'default' : k.margen_bruto_pct >= 25 ? 'positive' : 'warning'}
            />
            <StatCard label="Costos fijos al día" value={moneyShort(k.costos_fijos_proporcional)} hint={`de ${moneyShort(k.costos_fijos_mes)} al mes`} />
            <StatCard
              label="Resultado estimado"
              value={margenFiable ? moneyShort(k.resultado_estimado) : '—'}
              hint={margenFiable ? undefined
                    : sinCosto ? 'no calculable' : `solo ${pct(cobertura)} con costo`}
              tone={!margenFiable ? 'default' : enPerdida ? 'danger' : 'positive'}
              icon={enPerdida ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
            />
            <StatCard
              label={filtrando ? 'Por cobrar (filtrado)' : 'Por cobrar'}
              value={money(filtrando ? totalesCobrar.saldo : k.por_cobrar)}
              hint={filtrando
                ? `${money(totalesCobrar.vencido)} vencido · total ${moneyShort(k.por_cobrar)}`
                : `${moneyShort(k.vencido)} vencido`}
              tone={(filtrando ? totalesCobrar.vencido : k.vencido) > 0 ? 'danger' : 'default'} />
            <StatCard
              label={filtrando ? 'Por pagar (filtrado)' : 'Por pagar'}
              value={money(filtrando ? totalesPagar.bruto : k.por_pagar)}
              hint={filtrando ? `total ${moneyShort(k.por_pagar)}` : 'con IVA incluido'}
              tone={(filtrando ? totalesPagar.bruto : k.por_pagar) > 0 ? 'warning' : 'default'}
              icon={<Wallet className="h-4 w-4" />} />
          </div>

          {sinCosto && (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <p className="font-medium text-slate-800">
                  El margen del mes no se puede calcular todavía
                </p>
                <p className="text-slate-600">
                  Se facturaron {money(k.venta_mes)}, pero ninguna de esas ventas tiene el costo
                  cargado, así que cualquier margen o resultado sería inventado. El costo entra
                  al registrar las compras del período en <span className="font-medium">Compras</span>.
                </p>
              </div>
            </div>
          )}

          {costoParcial && (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900">Margen calculado sobre parte del mes</p>
                <p className="text-amber-800/80">
                  Solo {pct(k.cobertura_costo_pct)} de la venta del mes tiene costo cargado
                  ({money(k.venta_costeada)} de {money(k.venta_mes)}). El margen que se muestra
                  corresponde a esa parte, y por eso el resultado del mes no se calcula: lo que
                  falta es costo, no ganancia. El costo entra al registrar las compras en
                  <span className="font-medium"> Compras</span>.
                </p>
              </div>
            </div>
          )}

          {enPerdida && (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div>
                <p className="font-medium text-red-900">
                  El margen del mes no alcanza a cubrir los costos fijos
                </p>
                <p className="text-red-800/80">
                  Con un margen de {pct(k.margen_bruto_pct)} se necesitan {money(k.punto_equilibrio_venta)} de
                  venta mensual para llegar a cero. Van {money(k.venta_mes)}.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-4 mb-3">
        <Pestanas
          valor={pestana}
          onChange={setPestana}
          opciones={[
            { id: 'cobranza', label: 'Cobranza', badge: cobrarFiltrado.length || '' },
            { id: 'pagos', label: 'Pagos a proveedores', badge: pagarFiltrado.length || '' },
            { id: 'rentabilidad', label: 'Rentabilidad' },
          ]}
        />
      </div>

      {(pestana === 'cobranza' || pestana === 'pagos') && (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input className="input pl-9"
              placeholder={pestana === 'cobranza' ? 'Buscar cliente, factura o código…' : 'Buscar proveedor o código…'}
              value={buscar} onChange={(e) => setBuscar(e.target.value)} />
          </div>
          <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
          <span className="text-xs text-slate-400">
            {pestana === 'cobranza'
              ? `${cobrarFiltrado.length} de ${porCobrar.data?.length ?? 0}`
              : `${pagarFiltrado.length} de ${porPagar.data?.length ?? 0}`}
          </span>
          {pestana === 'pagos' && (
            <button onClick={exportarPagos} className="btn-secondary ml-auto">
              <Download className="h-4 w-4" /> Exportar CSV
            </button>
          )}
        </div>
      )}

      {pestana === 'cobranza' && (
        <>
          <div className="mb-3 flex justify-end">
            <button onClick={exportarCobranza} className="btn-secondary">
              <Download className="h-4 w-4" /> Exportar CSV
            </button>
          </div>
          {porCobrar.isLoading && <Skeleton className="h-56" />}
          {cobrarFiltrado.length === 0 && !porCobrar.isLoading && (
            <Card><EmptyState title="No hay nada pendiente de cobro" /></Card>
          )}

          {!!cobrarFiltrado.length && (
            <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Facturado" value={money(totalesCobrar.facturado)}
                hint={`${totalesCobrar.documentos} doc. · ${totalesCobrar.clientes} clientes`} />
              <StatCard label="Cobrado" value={money(totalesCobrar.cobrado)}
                hint="abonos ya imputados" />
              <StatCard label="Por cobrar" value={money(totalesCobrar.saldo)} tone="warning"
                hint="saldo de lo que se ve en pantalla" />
              <StatCard label="Vencido" value={money(totalesCobrar.vencido)}
                tone={totalesCobrar.vencido > 0 ? 'danger' : 'positive'}
                hint={totalesCobrar.grave > 0
                  ? `${money(totalesCobrar.grave)} con más de 30 días`
                  : `${totalesCobrar.docsVencidos} documentos`} />
            </div>
          )}

          {!!cobrarFiltrado.length && (
            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Cliente</th>
                  <th className="th">Pedido</th>
                  <th className="th">Vence</th>
                  <th className="th">Saldo</th>
                  <th className="th">Estado</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cobrarFiltrado.map((c) => (
                  <tr key={c.ref_id} className="hover:bg-slate-50">
                    <td className="td">
                      <button
                        className="text-left font-medium text-slate-900 hover:text-sea-600 hover:underline"
                        onClick={() => setReporte({ id: c.customer_id, nombre: c.cliente })}
                        title="Armar el reporte de cobro de este cliente">
                        {c.cliente}
                      </button>
                    </td>
                    <td className="td">
                      <p className="font-mono text-xs">{c.code}</p>
                      {c.origen === 'saldo_inicial' && (
                        <span className="badge bg-slate-100 text-slate-500">saldo anterior</span>
                      )}
                      {c.invoice_number && <p className="text-xs text-slate-400">factura {c.invoice_number}</p>}
                    </td>
                    <td className="td text-slate-500">{dateShort(c.due_date)}</td>
                    <td className="td tabular-nums font-medium">{money(c.saldo)}</td>
                    <td className="td">
                      <span className={`badge ${TRAMO[c.tramo].clase}`}>
                        {TRAMO[c.tramo].label}
                        {c.dias_atraso > 0 && ` · ${c.dias_atraso}d`}
                      </span>
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      {c.whatsapp && (
                        <a
                          href={mensajeCobranza(c)}
                          target="_blank"
                          rel="noreferrer"
                          title="Enviar recordatorio por WhatsApp"
                          className="mr-1 inline-flex rounded-lg p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      )}
                      <button onClick={() => setCobrar(c)} className="btn-accent px-3 py-1.5 text-xs">
                        Registrar cobro
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <Card className="mt-3 p-4 text-xs text-slate-500">
            Toca el nombre de un cliente para armar el reporte de cobro con todas sus facturas
            vencidas y enviárselo al encargado de pagos. El botón de WhatsApp de cada fila manda
            el recordatorio de ese documento suelto. Tú decides si enviarlo — el sistema no manda
            nada solo.
          </Card>
        </>
      )}

      {pestana === 'pagos' && (
        <>
          {porPagar.isLoading && <Skeleton className="h-48" />}
          {pagarFiltrado.length === 0 && !porPagar.isLoading && (
            <Card><EmptyState title="No hay compras pendientes de pago" /></Card>
          )}
          {!!pagarFiltrado.length && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <StatCard label="Neto de mercadería" value={money(totalesPagar.neto)}
                  hint="Es el costo, no lo que se paga" />
                <StatCard label="Otros conceptos" value={money(totalesPagar.otros)}
                  hint="Peajes, combustible y servicios de la misma factura" />
                <StatCard label="IVA" value={money(totalesPagar.iva)}
                  hint="Crédito fiscal del período" />
                <StatCard label="Total a pagar" value={money(totalesPagar.bruto)}
                  tone="warning" hint={`${pagarFiltrado.length} documentos`} />
              </div>

              <TableWrap>
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">Proveedor</th>
                    <th className="th">Documento</th>
                    <th className="th">Fecha</th>
                    <th className="th text-right">Neto</th>
                    <th className="th text-right">Exento</th>
                    <th className="th text-right">IVA</th>
                    <th className="th text-right">Total</th>
                    <th className="th text-right">Saldo</th>
                    <th className="th">Atraso</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagarFiltrado.map((p) => {
                    const nc = p.origen === 'nota_credito'
                    return (
                      <tr key={p.ref_id} className={clsx('hover:bg-slate-50', nc && 'bg-emerald-50/40')}>
                        <td className="td font-medium text-slate-900">{p.proveedor}</td>
                        <td className="td">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs">{p.invoice_number ?? p.code}</span>
                            {p.document_url && (
                              <a href={p.document_url} target="_blank" rel="noreferrer"
                                title="Abrir la factura del proveedor"
                                className="text-sea-600 hover:text-sea-700"
                                onClick={(e) => e.stopPropagation()}>
                                <FileText className="h-3.5 w-3.5" />
                              </a>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">
                            {nc ? 'Nota de crédito'
                              : p.origen === 'saldo_inicial' ? 'Saldo anterior'
                              : DTE_LABEL[p.dte_type ?? 0] ?? p.code}
                          </p>
                        </td>
                        <td className="td text-slate-500">{dateShort(p.issued_at)}</td>
                        <td className="td text-right tabular-nums text-slate-500">
                          {p.net_amount === null ? '—' : money(p.net_amount)}
                        </td>
                        <td className="td text-right tabular-nums text-slate-400">
                          {Number(p.exempt_amount) === 0 ? '—' : money(p.exempt_amount)}
                        </td>
                        <td className="td text-right tabular-nums text-slate-500">
                          {Number(p.tax_amount) === 0 ? '—' : money(p.tax_amount)}
                        </td>
                        <td className={clsx('td text-right font-medium tabular-nums',
                          nc ? 'text-emerald-600' : 'text-slate-800')}>
                          {money(p.total)}
                        </td>
                        <td className="td text-right font-medium tabular-nums">{money(p.saldo)}</td>
                        <td className="td">
                          {nc ? <span className="badge bg-emerald-100 text-emerald-700">a favor</span>
                            : p.dias_atraso > 0
                              ? <span className="badge bg-red-100 text-red-700">{p.dias_atraso} días</span>
                              : <span className="badge bg-emerald-100 text-emerald-700">Al día</span>}
                        </td>
                        <td className="td text-right">
                          {!nc && (
                            <button onClick={() => setPagar(p)} className="btn-secondary px-3 py-1.5 text-xs">
                              Registrar pago
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </TableWrap>

              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                El <span className="font-medium">total</span> es el bruto del documento: es lo que se le
                transfiere al proveedor. El <span className="font-medium">neto de mercadería</span> es la
                base del costo del pescado y no incluye el IVA ni los conceptos que vienen en la misma
                factura sin ser mercadería.
              </p>
            </>
          )}
        </>
      )}

      {pestana === 'rentabilidad' && <Rentabilidad />}

      {reporte && (
        <Modal open onClose={() => setReporte(null)} wide
          title={`Reporte de cobro · ${reporte.nombre}`}>
          <ReporteCobro
            customerId={reporte.id}
            cliente={reporte.nombre}
            deudaTotal={docsDelReporte.reduce((a, d) => a + d.saldo, 0)}
            whatsappCliente={
              (porCobrar.data ?? []).find((c) => c.customer_id === reporte.id)?.whatsapp
              ?? (porCobrar.data ?? []).find((c) => c.customer_id === reporte.id)?.phone
            }
            documentos={docsDelReporte}
          />
        </Modal>
      )}

      <CobroModal cobrar={cobrar} onClose={() => setCobrar(null)} onListo={refrescar} />
      <PagoModal pagar={pagar} onClose={() => setPagar(null)} onListo={refrescar} />
    </>
  )
}

function Rentabilidad() {
  const [dias, setDias] = useState(30)
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
  const hasta = new Date().toISOString().slice(0, 10)

  const productos = useQuery({
    queryKey: ['margen-producto', dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('margin_by_product', { _desde: desde, _hasta: hasta })
      if (error) throw error
      return data as Margen[]
    },
  })

  const clientes = useQuery({
    queryKey: ['margen-cliente', dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('margin_by_customer', { _desde: desde, _hasta: hasta })
      if (error) throw error
      return data as Margen[]
    },
  })

  return (
    <>
      <div className="mb-3 flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm sm:w-fit">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDias(d)}
            className={`rounded-md px-4 py-1.5 font-medium ${dias === d ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500'}`}
          >
            {d} días
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TablaMargen
          titulo="Margen por producto"
          columna="Producto"
          filas={productos.data ?? []}
          cargando={productos.isLoading}
          campo="producto"
        />
        <TablaMargen
          titulo="Margen por cliente"
          columna="Cliente"
          filas={clientes.data ?? []}
          cargando={clientes.isLoading}
          campo="cliente"
        />
      </div>

      <Card className="mt-4 p-4 text-xs text-slate-500">
        El costo usado es el costo real de los lotes que salieron en cada pedido: incluye el flete y
        los costos de compra prorrateados, y en los productos procesados el costo del pescado entero
        que entró al fileteo. No es una estimación sobre el precio de lista del proveedor.
      </Card>
    </>
  )
}

function TablaMargen({
  titulo, columna, filas, cargando, campo,
}: { titulo: string; columna: string; filas: Margen[]; cargando: boolean; campo: 'producto' | 'cliente' }) {
  function exportar() {
    const cabecera = [columna, 'Kilos', 'Venta', 'Costo', 'Margen', 'Margen %']
    const datos = filas.map((f) => [
      String(f[campo] ?? ''), String(f.kilos), String(f.venta), String(f.costo),
      String(f.margen), String(f.margen_pct),
    ])
    descargarCsv([cabecera, ...datos], `margen-por-${campo}`)
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
        <button onClick={exportar} className="text-xs font-medium text-navy-600 hover:underline">
          Exportar CSV
        </button>
      </div>
      {cargando && <Skeleton className="m-4 h-40" />}
      {!cargando && filas.length === 0 && <EmptyState title="Sin ventas en el período" />}
      {filas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">{columna}</th>
                <th className="th">Venta</th>
                <th className="th">Margen</th>
                <th className="th">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.slice(0, 12).map((f, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="td">
                    <p className="font-medium text-slate-800">{f[campo]}</p>
                    <p className="text-xs text-slate-400">{Math.round(Number(f.kilos))} kg</p>
                  </td>
                  <td className="td tabular-nums">{moneyShort(f.venta)}</td>
                  <td className={`td tabular-nums ${Number(f.margen) < 0 ? 'text-red-600' : ''}`}>
                    {moneyShort(f.margen)}
                  </td>
                  <td className="td">
                    <span className={`badge ${Number(f.margen_pct) >= 25 ? 'bg-emerald-100 text-emerald-700' : Number(f.margen_pct) >= 10 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>
                      {pct(f.margen_pct)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function CobroModal({
  cobrar, onClose, onListo,
}: { cobrar: Cobrar | null; onClose: () => void; onListo: () => void }) {
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia')
  const [referencia, setReferencia] = useState('')

  const guardar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('register_collection', {
        _origen: cobrar!.origen,
        _ref_id: cobrar!.ref_id,
        _amount: Number(monto) || cobrar!.saldo,
        _method: metodo,
        _reference: referencia.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      onListo()
      onClose()
      setMonto('')
      setReferencia('')
    },
  })

  return (
    <Modal
      open={!!cobrar}
      onClose={onClose}
      title={`Cobro · ${cobrar?.cliente ?? ''}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => guardar.mutate()} disabled={guardar.isPending} className="btn-primary">
            Registrar cobro
          </button>
        </>
      }
    >
      {cobrar && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-sm text-slate-600">{cobrar.code}</p>
            <p className="text-lg font-semibold text-slate-900">Saldo {money(cobrar.saldo)}</p>
            {cobrar.dias_atraso > 0 && (
              <p className="text-xs text-red-600">{cobrar.dias_atraso} días de atraso</p>
            )}
          </div>
          <div>
            <label className="label">Monto</label>
            <input className="input" type="number" placeholder={String(cobrar.saldo)} value={monto} onChange={(e) => setMonto(e.target.value)} />
            <p className="mt-1 text-xs text-slate-400">Vacío = saldo completo</p>
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
          {guardar.isError && <ErrorState error={guardar.error} />}
        </div>
      )}
    </Modal>
  )
}

/**
 * Registrar un pago a proveedor. Antes solo pedía monto, método y referencia,
 * y la fecha quedaba en la de hoy: un pago hecho el viernes y cargado el lunes
 * descuadraba contra la cartola del banco. Ahora pide la fecha real y muestra
 * de qué está compuesto el total, que es lo que se revisa antes de transferir.
 */
function PagoModal({
  pagar, onClose, onListo,
}: { pagar: Pagar | null; onClose: () => void; onListo: () => void }) {
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia')
  const [referencia, setReferencia] = useState('')
  const [fecha, setFecha] = useState(() => new Date().toISOString().slice(0, 10))
  const [notas, setNotas] = useState('')

  // Al abrir el modal con otra compra, la fecha vuelve a hoy y se limpia
  // lo escrito: arrastrar el monto de la compra anterior es un error caro.
  const refAnterior = useRef<string | null>(null)
  useEffect(() => {
    if (pagar && pagar.ref_id !== refAnterior.current) {
      refAnterior.current = pagar.ref_id
      setMonto(''); setReferencia(''); setNotas('')
      setFecha(new Date().toISOString().slice(0, 10))
    }
  }, [pagar])

  const pagos = useQuery({
    queryKey: ['pagos-de-compra', pagar?.purchase_id],
    enabled: !!pagar?.purchase_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payments')
        .select('id, code, amount, method, paid_at, reference, notes')
        .eq('purchase_id', pagar!.purchase_id).eq('direction', 'pago')
        .order('paid_at', { ascending: false })
      if (error) throw error
      return data as { id: string; code: string; amount: number; method: PaymentMethod
        paid_at: string; reference: string | null; notes: string | null }[]
    },
  })

  const montoNum = Number(monto) || 0
  const saldo = Number(pagar?.saldo ?? 0)
  const excede = montoNum > saldo + 0.5

  const guardar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('register_payment_out', {
        _origen: pagar!.origen,
        _ref_id: pagar!.ref_id,
        _amount: montoNum || saldo,
        _method: metodo,
        _reference: referencia.trim() || null,
        _paid_at: new Date(`${fecha}T12:00:00`).toISOString(),
        _notes: notas.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      onListo()
      onClose()
      setMonto(''); setReferencia(''); setNotas('')
    },
  })

  return (
    <Modal
      open={!!pagar}
      onClose={onClose}
      wide
      title={`Pago a ${pagar?.proveedor ?? ''}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => guardar.mutate()}
            disabled={guardar.isPending || excede || (montoNum <= 0 && saldo <= 0)}
            className="btn-primary">
            {guardar.isPending ? 'Guardando…' : `Registrar ${money(montoNum || saldo)}`}
          </button>
        </>
      }
    >
      {pagar && (
        <div className="space-y-4">
          {/* De qué está compuesto lo que se va a pagar */}
          <div className="rounded-lg border border-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
              <div>
                <p className="text-sm font-medium text-navy-900">
                  {pagar.invoice_number ? `Factura ${pagar.invoice_number}` : pagar.code}
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {DTE_LABEL[pagar.dte_type ?? 0] ?? 'Sin documento tributario'}
                  </span>
                </p>
                <p className="text-xs text-slate-400">
                  {pagar.code} · emitida {dateShort(pagar.issued_at)}
                  {pagar.due_date && ` · vence ${dateShort(pagar.due_date)}`}
                  {pagar.dias_atraso > 0 && (
                    <span className="ml-1 font-medium text-red-600">{pagar.dias_atraso} días de atraso</span>
                  )}
                </p>
              </div>
              {pagar.document_url && (
                <a href={pagar.document_url} target="_blank" rel="noreferrer"
                  className="btn-secondary px-3 py-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5" /> Ver la factura
                </a>
              )}
            </div>

            <dl className="divide-y divide-slate-50 px-4 py-1 text-sm">
              <Linea k="Neto de mercadería" v={money(pagar.neto_mercaderia)} />
              {Number(pagar.total) - Number(pagar.tax_amount) - Number(pagar.neto_mercaderia) !== 0 && (
                <Linea k="Otros conceptos de la factura"
                  v={money(Number(pagar.total) - Number(pagar.tax_amount) - Number(pagar.neto_mercaderia))}
                  nota="Peajes, combustible o servicios que vienen en el mismo documento" />
              )}
              {Number(pagar.exempt_amount) !== 0 && <Linea k="Exento" v={money(pagar.exempt_amount)} />}
              <Linea k="IVA" v={Number(pagar.tax_amount) === 0 ? 'sin IVA' : money(pagar.tax_amount)} />
              <Linea k="Total del documento" v={money(pagar.total)} fuerte />
              {Number(pagar.amount_paid) > 0 && (
                <Linea k="Ya pagado" v={`− ${money(pagar.amount_paid)}`} />
              )}
              <Linea k="Saldo por pagar" v={money(saldo)} fuerte />
            </dl>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Monto</span>
              <input className="input" type="number" min={0} placeholder={String(Math.round(saldo))}
                value={monto} onChange={(e) => setMonto(e.target.value)} />
              <button type="button" className="mt-1 text-xs text-sea-600 hover:underline"
                onClick={() => setMonto(String(Math.round(saldo)))}>
                Pagar el saldo completo ({money(saldo)})
              </button>
            </label>
            <label className="block">
              <span className="label">Fecha del pago</span>
              <input className="input" type="date" value={fecha}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setFecha(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Forma de pago</span>
              <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value as PaymentMethod)}>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">N° de operación</span>
              <input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)}
                placeholder="Transferencia, cheque o documento" />
            </label>
          </div>

          <label className="block">
            <span className="label">Nota interna</span>
            <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)}
              placeholder="Opcional: quién autorizó, de qué cuenta salió…" />
          </label>

          {excede && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
              Estás pagando {money(montoNum - saldo)} más que el saldo del documento.
            </p>
          )}

          {!!pagos.data?.length && (
            <div className="rounded-lg border border-slate-200">
              <p className="border-b border-slate-100 px-4 py-2 text-xs font-medium text-slate-500">
                Pagos ya registrados en este documento
              </p>
              <div className="divide-y divide-slate-50">
                {pagos.data.map((x) => (
                  <div key={x.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                    <div>
                      <p className="text-slate-700">{dateShort(x.paid_at)}</p>
                      <p className="text-xs text-slate-400">
                        {x.code} · {PAYMENT_METHOD_LABEL[x.method]}
                        {x.reference && ` · ref ${x.reference}`}
                      </p>
                    </div>
                    <p className="tabular-nums font-medium">{money(x.amount)}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {guardar.isError && <ErrorState error={guardar.error} />}
        </div>
      )}
    </Modal>
  )
}

function Linea({ k, v, nota, fuerte }: { k: string; v: string; nota?: string; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className={clsx('text-slate-500', fuerte && 'font-medium text-slate-700')}>
        {k}
        {nota && <span className="block text-xs text-slate-400">{nota}</span>}
      </dt>
      <dd className={clsx('shrink-0 tabular-nums', fuerte ? 'font-semibold text-navy-900' : 'text-slate-600')}>
        {v}
      </dd>
    </div>
  )
}

function mensajeCobranza(c: Cobrar) {
  const texto =
    `Hola ${c.cliente}, te escribimos de Pescadería Bilagay.\n\n` +
    `Tienes un saldo pendiente de ${money(c.saldo)} del pedido ${c.code}` +
    (c.invoice_number ? ` (factura ${c.invoice_number})` : '') +
    (c.due_date ? `, con vencimiento el ${dateShort(c.due_date)}` : '') +
    (c.dias_atraso > 0 ? `, con ${c.dias_atraso} días de atraso` : '') +
    `.\n\nCualquier duda nos avisas. ¡Gracias!`
  return `https://wa.me/${(c.whatsapp ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
}

