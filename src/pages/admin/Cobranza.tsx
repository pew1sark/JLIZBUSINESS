import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowRightLeft, CalendarClock, Check, Clock, Download, Inbox, Link2, MessageCircle,
  RotateCcw, Search, Timer, Trash2, Users, Wallet, X,
} from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import type {
  AvisoPago, ComportamientoPago, CuentaPorCobrar, EstadoCuentaCliente, FacturaConPago,
  Imputacion, PagoCartola, PagoDetalle, PagoSinImputar, PaymentMethod,
} from '../../lib/types'
import { PAYMENT_METHOD_LABEL, PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE } from '../../lib/constants'
import { dateShort, dateTime, money, moneyShort } from '../../lib/format'
import { descargarCsv } from '../../lib/csv'
import { FiltroPeriodo, Paginador, ThOrden } from '../../components/Filtros'
import { ordenar, useOrden } from '../../lib/orden'
import { nombreMes, rangoDe, type Periodo } from '../../lib/periodo'
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

type Pestana = 'clientes' | 'facturas' | 'documentos' | 'comportamiento' | 'pagos' | 'avisos'

type OrdenFactura = { campo: ColFactura; dir: 'asc' | 'desc' }
type ColComport =
  | 'cliente' | 'dias_promedio' | 'mediana' | 'exceso' | 'a_tiempo'
  | 'ultimos90' | 'abiertas' | 'ultima_factura' | 'ultimo_pago' | 'facturado'
type OrdenComport = { campo: ColComport; dir: 'asc' | 'desc' }

type FiltroComport = 'todos' | 'con_deuda' | 'al_dia' | 'fuera_plazo' | 'empeorando'

const FILTRO_COMPORT: Record<FiltroComport, string> = {
  todos: 'Todos',
  con_deuda: 'Con deuda abierta',
  al_dia: 'Al día',
  fuera_plazo: 'Se pasan del plazo',
  empeorando: 'Empeorando',
}

export function Cobranza() {
  const qc = useQueryClient()
  const [pestana, setPestana] = useState<Pestana>('clientes')
  const [buscar, setBuscar] = useState('')
  const [periodo, setPeriodo] = useState<Periodo>(() => rangoDe('todo'))
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState(50)
  const [cartola, setCartola] = useState<string | null>(null)
  const [cobrar, setCobrar] = useState<{ customer_id: string; cliente: string } | null>(null)
  const [reimputar, setReimputar] = useState<PagoSinImputar | null>(null)
  // En la pestaña de facturas el período puede leerse de dos formas: cuándo se
  // emitió o cuándo se pagó. Son preguntas distintas ("qué facturé en marzo"
  // contra "qué me pagaron en marzo") y las dos se hacen igual de seguido.
  const [ejeFecha, setEjeFecha] = useState<'emision' | 'pago'>('emision')
  const [estadoFactura, setEstadoFactura] = useState<'todas' | 'pagadas' | 'impagas'>('todas')
  const [clienteFactura, setClienteFactura] = useState('')
  const ordFactura = useOrden<ColFactura>('emitida')
  const ordComport = useOrden<ColComport>('dias_promedio')
  const [filtroComport, setFiltroComport] = useState<FiltroComport>('todos')

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

  // Todas las facturas, pagadas incluidas. Es la vista que faltaba: al pagarse,
  // una factura desaparecía de v_cuentas_por_cobrar y con ella la fecha de pago.
  const facturas = useQuery({
    queryKey: ['cob-facturas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_facturas_con_pago').select('*')
        .order('issued_at', { ascending: false })
        .order('doc_number', { ascending: false })
        .limit(5000)
      if (error) throw error
      return data as FacturaConPago[]
    },
  })

  const comportamiento = useQuery({
    queryKey: ['cob-comportamiento'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_comportamiento_pago_cliente').select('*')
        .order('dias_promedio', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as ComportamientoPago[]
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
    for (const k of ['cob-clientes', 'cob-documentos', 'cob-facturas', 'cob-comportamiento',
                     'cob-sin-imputar', 'cob-pagos-detalle', 'cob-avisos',
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

  // El filtro de documentos corre sobre la fecha de VENCIMIENTO: en
  // cobranza la pregunta es cuándo hay que cobrar, no cuándo se vendió.
  const documentosFiltrados = (documentos.data ?? []).filter((d) => {
    const f = d.due_date?.slice(0, 10)
    if ((periodo.desde || periodo.hasta) && !f) return false
    if (periodo.desde && f && f < periodo.desde) return false
    if (periodo.hasta && f && f > periodo.hasta) return false
    return !q || d.cliente.toLowerCase().includes(q)
      || (d.doc_number ?? '').includes(q)
      || d.code.toLowerCase().includes(q)
  })

  // Las facturas se filtran por el eje que se haya elegido: la fecha de
  // emisión o la del pago. Con eje "pago", lo que nunca se pagó no aparece.
  const facturasFiltradas = useMemo(() => {
    const filtradas = (facturas.data ?? []).filter((f) => {
      if (estadoFactura === 'pagadas' && f.payment_status !== 'pagado') return false
      if (estadoFactura === 'impagas' && f.payment_status === 'pagado') return false
      if (clienteFactura && f.customer_id !== clienteFactura) return false

      const hayRango = !!(periodo.desde || periodo.hasta)
      const fecha = ejeFecha === 'pago' ? f.ultimo_pago : f.issued_at
      // Con el eje en la fecha de pago, una factura sin pagar no tiene fecha que
      // comparar: cae fuera de cualquier rango, pero sigue apareciendo si no hay rango.
      if (hayRango) {
        if (!fecha) return false
        if (periodo.desde && fecha < periodo.desde) return false
        if (periodo.hasta && fecha > periodo.hasta) return false
      }

      return !q || f.cliente.toLowerCase().includes(q) || f.doc_number.toLowerCase().includes(q)
    })
    return ordenar(filtradas, ordFactura.orden, (f, c) => ({
      doc: f.doc_number,
      cliente: f.cliente,
      emitida: f.issued_at,
      vence: f.due_date,
      total: Number(f.total),
      saldo: Number(f.saldo),
      pago: f.ultimo_pago,
      dias: f.dias_en_pagar ?? f.dias_esperando,
      estado: f.payment_status,
    })[c])
  }, [facturas.data, estadoFactura, clienteFactura, ejeFecha, periodo.desde, periodo.hasta, q, ordFactura.orden])

  const resumenFacturas = useMemo(() => {
    const f = facturasFiltradas
    const pagadas = f.filter((x) => x.payment_status === 'pagado')
    const dias = pagadas.map((x) => x.dias_en_pagar).filter((d): d is number => d !== null)
    return {
      total: f.reduce((a, x) => a + Number(x.total), 0),
      cobrado: f.reduce((a, x) => a + Number(x.amount_paid), 0),
      saldo: f.reduce((a, x) => a + Number(x.saldo), 0),
      pagadas: pagadas.length,
      diasPromedio: dias.length ? Math.round(dias.reduce((a, d) => a + d, 0) / dias.length) : null,
    }
  }, [facturasFiltradas])

  const comportamientoFiltrado = useMemo(() => {
    const base = (comportamiento.data ?? [])
      .filter((c) => c.facturas_totales > 0)
      .filter((c) => !q || c.cliente.toLowerCase().includes(q) || (c.rut ?? '').includes(q))
      .filter((c) => {
        if (filtroComport === 'con_deuda')  return c.facturas_abiertas > 0
        if (filtroComport === 'fuera_plazo') return (c.exceso_sobre_plazo ?? 0) > 0
        if (filtroComport === 'al_dia')     return c.facturas_abiertas === 0
        if (filtroComport === 'empeorando') {
          return c.dias_promedio_90d !== null && c.dias_promedio !== null
            && c.dias_promedio_90d - c.dias_promedio >= 3
        }
        return true
      })
    return ordenar(base, ordComport.orden, (c, k) => ({
      cliente: c.cliente,
      dias_promedio: c.dias_promedio,
      mediana: c.dias_mediana === null ? null : Number(c.dias_mediana),
      exceso: c.exceso_sobre_plazo,
      a_tiempo: c.pct_a_tiempo,
      ultimos90: c.dias_promedio_90d,
      abiertas: Number(c.saldo_abierto),
      ultima_factura: c.ultima_factura,
      ultimo_pago: c.ultimo_pago,
      facturado: Number(c.monto_total),
    })[k])
  }, [comportamiento.data, q, filtroComport, ordComport.orden])

  /** Clientes que aparecen en las facturas, para el filtro por cliente. */
  const clientesDeFacturas = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of facturas.data ?? []) m.set(f.customer_id, f.cliente)
    return [...m].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [facturas.data])

  useEffect(() => { setPagina(0) }, [buscar, periodo.desde, periodo.hasta, pestana, ejeFecha, estadoFactura])

  const documentosPagina = documentosFiltrados.slice(pagina * porPagina, (pagina + 1) * porPagina)
  const facturasPagina = facturasFiltradas.slice(pagina * porPagina, (pagina + 1) * porPagina)

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

  function exportarFacturas() {
    const filas: (string | number)[][] = [[
      'Documento', 'Tipo', 'Cliente', 'RUT', 'Emitida', 'Vence', 'Neto', 'IVA', 'Total',
      'Pagado', 'Saldo', 'Estado', 'Fecha de pago', 'N° de pagos', 'Forma de pago',
      'Días en pagar', 'Días vs. plazo', 'Días esperando',
    ]]
    for (const f of facturasFiltradas) {
      filas.push([
        f.doc_number, f.doc_type, f.cliente, f.rut ?? '', f.issued_at, f.due_date ?? '',
        f.net_amount, f.tax_amount, f.total, f.amount_paid, f.saldo, f.payment_status,
        f.ultimo_pago ?? '', f.n_pagos, f.metodos ?? '',
        f.dias_en_pagar ?? '', f.dias_vs_plazo ?? '', f.dias_esperando ?? '',
      ])
    }
    descargarCsv(filas, `facturas-${periodo.desde ?? 'todo'}`)
  }

  function exportarComportamiento() {
    const filas: (string | number)[][] = [[
      'Cliente', 'RUT', 'Plazo pactado', 'Facturas emitidas', 'Monto facturado',
      'Facturas pagadas', 'Monto pagado', 'Días promedio', 'Días mediana', 'Días mínimo',
      'Días máximo', 'Desviación', 'Promedio últimos 90 días', 'Exceso sobre el plazo',
      'Pagadas a tiempo', 'Pagadas fuera de plazo', '% a tiempo',
      'Facturas abiertas', 'Saldo abierto', 'Espera promedio', 'Espera máxima', 'Último pago',
    ]]
    for (const c of comportamientoFiltrado) {
      filas.push([
        c.cliente, c.rut ?? '', c.plazo_pactado, c.facturas_totales, c.monto_total,
        c.facturas_pagadas, c.monto_pagado, c.dias_promedio ?? '', c.dias_mediana ?? '',
        c.dias_minimo ?? '', c.dias_maximo ?? '', c.dias_desviacion ?? '',
        c.dias_promedio_90d ?? '', c.exceso_sobre_plazo ?? '',
        c.a_tiempo, c.fuera_de_plazo, c.pct_a_tiempo ?? '',
        c.facturas_abiertas, c.saldo_abierto, c.espera_promedio ?? '', c.espera_maxima ?? '',
        c.ultimo_pago ?? '',
      ])
    }
    descargarCsv(filas, 'comportamiento-de-pago-por-cliente')
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
            ['facturas', `Facturas${facturasFiltradas.length ? ` (${facturasFiltradas.length})` : ''}`],
            ['documentos', `Por cobrar${documentosFiltrados.length ? ` (${documentosFiltrados.length})` : ''}`],
            ['comportamiento', 'Cómo pagan'],
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

        {(pestana === 'clientes' || pestana === 'documentos'
          || pestana === 'facturas' || pestana === 'comportamiento') && (
          <>
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <input className="input pl-9" placeholder="Buscar cliente, RUT o factura…"
                value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            </div>
            {(pestana === 'documentos' || pestana === 'facturas') && (
              <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
            )}
            <button className="btn-secondary ml-auto"
              onClick={
                pestana === 'clientes' ? exportarCartera
                : pestana === 'facturas' ? exportarFacturas
                : pestana === 'comportamiento' ? exportarComportamiento
                : exportarDocumentos
              }>
              <Download className="h-4 w-4" /> Exportar
            </button>
          </>
        )}
      </div>

      {pestana === 'facturas' && (
        <div className="mb-3 flex flex-wrap items-center gap-4 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">El período se lee por</span>
            {([['emision', 'fecha de emisión'], ['pago', 'fecha de pago']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setEjeFecha(k)}
                className={clsx('rounded-full px-3 py-1 text-xs font-medium',
                  ejeFecha === k ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-200')}>
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Mostrar</span>
            {([['todas', 'Todas'], ['pagadas', 'Pagadas'], ['impagas', 'No pagadas']] as const).map(([k, label]) => (
              <button key={k} onClick={() => setEstadoFactura(k)}
                className={clsx('rounded-full px-3 py-1 text-xs font-medium',
                  estadoFactura === k ? 'bg-navy-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-200')}>
                {label}
              </button>
            ))}
          </div>

          <select className="input w-auto py-1 text-xs" value={clienteFactura}
            onChange={(e) => setClienteFactura(e.target.value)}>
            <option value="">Todos los clientes</option>
            {clientesDeFacturas.map(([id, nombre]) => (
              <option key={id} value={id}>{nombre}</option>
            ))}
          </select>

          <span className="ml-auto text-xs text-slate-500">
            {money(resumenFacturas.total)} facturado · {money(resumenFacturas.cobrado)} cobrado
            {resumenFacturas.saldo > 0 && <> · <span className="font-medium text-amber-600">{money(resumenFacturas.saldo)} por cobrar</span></>}
            {resumenFacturas.diasPromedio !== null && (
              <> · {resumenFacturas.pagadas} pagadas en {resumenFacturas.diasPromedio} días promedio</>
            )}
          </span>
        </div>
      )}

      {pestana === 'clientes' && (
        <TablaClientes filas={clientesFiltrados} cargando={clientes.isLoading}
          onCartola={setCartola} onCobrar={(c) => setCobrar({ customer_id: c.customer_id, cliente: c.cliente })} />
      )}

      {pestana === 'documentos' && (
        <>
          <TablaDocumentos filas={documentosPagina} cargando={documentos.isLoading} />
          {documentosFiltrados.length > 0 && (
            <div className="card mt-3">
              <Paginador total={documentosFiltrados.length} pagina={pagina} porPagina={porPagina}
                onPagina={setPagina} onPorPagina={setPorPagina} />
            </div>
          )}
        </>
      )}

      {pestana === 'facturas' && (
        <>
          <TablaFacturas filas={facturasPagina} cargando={facturas.isLoading}
            ejeFecha={ejeFecha} orden={ordFactura.orden} onOrden={ordFactura.cambiar} />
          {facturasFiltradas.length > 0 && (
            <div className="card mt-3">
              <Paginador total={facturasFiltradas.length} pagina={pagina} porPagina={porPagina}
                onPagina={setPagina} onPorPagina={setPorPagina} />
            </div>
          )}
        </>
      )}

      {pestana === 'comportamiento' && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1">
            {(Object.keys(FILTRO_COMPORT) as FiltroComport[]).map((f) => (
              <button key={f} onClick={() => setFiltroComport(f)}
                className={clsx('rounded-full px-3 py-1 text-xs font-medium',
                  filtroComport === f ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                {FILTRO_COMPORT[f]}
              </button>
            ))}
            <span className="ml-2 text-xs text-slate-400">
              {comportamientoFiltrado.length} cliente(s) · toca un encabezado para ordenar
            </span>
          </div>
          <TablaComportamiento filas={comportamientoFiltrado} cargando={comportamiento.isLoading}
            onCartola={setCartola} orden={ordComport.orden} onOrden={ordComport.cambiar}
            onVerFacturas={(id) => {
              setClienteFactura(id); setEstadoFactura('todas'); setPestana('facturas')
            }} />
        </>
      )}

      {pestana === 'pagos' && (
        <PanelPagos sinImputar={sinImputar.data ?? []} cargando={sinImputar.isLoading}
          onImputar={setReimputar} onHecho={refrescar} />
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
        {filas.map((d) => (
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
     nota_credito: 'Nota de crédito',
     pedido: 'Pedido interno', saldo_inicial: 'Saldo arrastrado' } as Record<string, string>)[t] ?? t

// ---------------------------------------------------------------- todas las facturas
/**
 * El historial completo: pagadas y no pagadas, con el día exacto en que se
 * pagó cada una. La tabla de arriba (`TablaDocumentos`) solo muestra deuda
 * viva; ésta es la que sirve para revisar un mes ya cerrado.
 */
type ColFactura = 'doc' | 'cliente' | 'emitida' | 'vence' | 'total' | 'saldo' | 'pago' | 'dias' | 'estado'

function TablaFacturas({
  filas, cargando, ejeFecha, orden, onOrden,
}: {
  filas: FacturaConPago[]
  cargando: boolean
  ejeFecha: 'emision' | 'pago'
  orden: OrdenFactura
  onOrden: (c: ColFactura, d?: 'asc' | 'desc') => void
}) {
  if (cargando) return <Card><Skeleton className="h-64" /></Card>
  if (filas.length === 0) {
    return (
      <Card>
        <EmptyState title="Sin facturas en este filtro"
          hint={ejeFecha === 'pago'
            ? 'Con el período leído por fecha de pago solo aparecen las facturas que ya se pagaron. Cambia a «fecha de emisión» para ver también las pendientes.'
            : 'Prueba ampliando el período o eligiendo otro mes.'}
          icon={<CalendarClock className="h-8 w-8" />} />
      </Card>
    )
  }

  return (
    <TableWrap>
      <thead className="bg-slate-50">
        <tr>
          <ThOrden campo="doc" orden={orden} onOrden={onOrden}>Documento</ThOrden>
          <ThOrden campo="cliente" orden={orden} onOrden={onOrden} porDefecto="asc">Cliente</ThOrden>
          <ThOrden campo="emitida" orden={orden} onOrden={onOrden}>Emitida</ThOrden>
          <ThOrden campo="vence" orden={orden} onOrden={onOrden}>Vence</ThOrden>
          <ThOrden campo="total" orden={orden} onOrden={onOrden} className="text-right">Total</ThOrden>
          <ThOrden campo="saldo" orden={orden} onOrden={onOrden} className="text-right">Saldo</ThOrden>
          <ThOrden campo="pago" orden={orden} onOrden={onOrden}>Fecha de pago</ThOrden>
          <ThOrden campo="dias" orden={orden} onOrden={onOrden} className="text-right">Días</ThOrden>
          <ThOrden campo="estado" orden={orden} onOrden={onOrden} porDefecto="asc">Estado</ThOrden>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {filas.map((f) => {
          const saldo = Number(f.saldo)
          const esNC = f.doc_type === 'nota_credito'
          return (
            <tr key={f.invoice_id} className="hover:bg-slate-50">
              <td className="td">
                <p className="font-medium text-navy-900">{f.doc_number}</p>
                <p className="text-xs text-slate-400">{etiquetaDoc(f.doc_type)}</p>
              </td>
              <td className="td font-medium text-slate-800">{f.cliente}</td>
              <td className="td text-slate-500">{dateShort(f.issued_at)}</td>
              <td className="td text-slate-500">{dateShort(f.due_date)}</td>
              <td className={clsx('td text-right tabular-nums', esNC && 'text-emerald-600')}>
                {money(f.total)}
              </td>
              <td className={clsx('td text-right tabular-nums',
                saldo > 0 ? 'font-medium text-amber-600' : 'text-slate-400')}>
                {money(saldo)}
              </td>
              <td className="td">
                {f.ultimo_pago ? (
                  <div>
                    <p className="font-medium text-slate-700">{dateShort(f.ultimo_pago)}</p>
                    <p className="text-xs text-slate-400">
                      {f.n_pagos > 1
                        ? `${f.n_pagos} pagos desde ${dateShort(f.primer_pago)}`
                        : (f.metodos ?? '')}
                    </p>
                  </div>
                ) : (
                  <span className="text-slate-300">sin pago</span>
                )}
              </td>
              <td className="td text-right tabular-nums">
                <DiasEnPagar factura={f} />
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
  )
}

/**
 * Cuántos días tardó en pagarse, o cuántos lleva esperando. El color mira el
 * plazo pactado, no el número pelado: 40 días con 45 de plazo está bien.
 */
function DiasEnPagar({ factura: f }: { factura: FacturaConPago }) {
  if (f.dias_en_pagar !== null) {
    const fuera = f.dias_vs_plazo !== null && f.dias_vs_plazo > 0
    return (
      <span className={clsx('font-medium', fuera ? 'text-amber-600' : 'text-emerald-600')}
        title={f.dias_vs_plazo === null ? undefined
          : fuera ? `${f.dias_vs_plazo} días después del vencimiento`
          : `${-f.dias_vs_plazo} días antes del vencimiento`}>
        {f.dias_en_pagar} d
      </span>
    )
  }
  if (f.dias_esperando !== null) {
    const atraso = f.dias_atraso ?? 0
    return (
      <span className={clsx(atraso > 30 ? 'font-medium text-red-600'
        : atraso > 0 ? 'text-amber-600' : 'text-slate-400')}>
        {f.dias_esperando} d
      </span>
    )
  }
  return <span className="text-slate-300">—</span>
}

// ---------------------------------------------------------------- cómo paga cada cliente
/**
 * El resumen que responde "¿cuánto se demora este cliente?". Lo importante no
 * es el promedio solo: un promedio de 35 días con desviación de 3 es un cliente
 * con el que se puede planificar; el mismo promedio con desviación de 25, no.
 */
function TablaComportamiento({
  filas, cargando, onCartola, orden, onOrden, onVerFacturas,
}: {
  filas: ComportamientoPago[]
  cargando: boolean
  onCartola: (id: string) => void
  orden: OrdenComport
  onOrden: (c: ColComport, d?: 'asc' | 'desc') => void
  onVerFacturas: (customerId: string) => void
}) {
  if (cargando) return <Card><Skeleton className="h-64" /></Card>
  if (filas.length === 0) {
    return (
      <Card>
        <EmptyState title="Todavía no hay facturas para medir"
          hint="El promedio de días se calcula sobre facturas ya pagadas."
          icon={<Timer className="h-8 w-8" />} />
      </Card>
    )
  }

  const conDatos = filas.filter((c) => c.dias_promedio !== null)
  const promedioGeneral = conDatos.length
    ? Math.round(conDatos.reduce((a, c) => a + (c.dias_promedio ?? 0) * c.facturas_pagadas, 0)
      / conDatos.reduce((a, c) => a + c.facturas_pagadas, 0))
    : null

  return (
    <>
      {promedioGeneral !== null && (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          En promedio te pagan a los <span className="font-medium text-slate-700">{promedioGeneral} días</span> de
          emitida la factura, sobre {conDatos.reduce((a, c) => a + c.facturas_pagadas, 0)} facturas ya saldadas.
          La columna «vs. plazo» es lo que se demoran de más respecto de lo pactado con cada uno.
        </p>
      )}

      <TableWrap>
        <thead className="bg-slate-50">
          <tr>
            <ThOrden campo="cliente" orden={orden} onOrden={onOrden} porDefecto="asc">Cliente</ThOrden>
            <th className="th text-right">Plazo</th>
            <ThOrden campo="dias_promedio" orden={orden} onOrden={onOrden} className="text-right">Días promedio</ThOrden>
            <ThOrden campo="mediana" orden={orden} onOrden={onOrden} className="text-right">Mediana</ThOrden>
            <th className="th text-right">Rango</th>
            <ThOrden campo="exceso" orden={orden} onOrden={onOrden} className="text-right">vs. plazo</ThOrden>
            <ThOrden campo="a_tiempo" orden={orden} onOrden={onOrden} className="text-right">A tiempo</ThOrden>
            <ThOrden campo="ultimos90" orden={orden} onOrden={onOrden} className="text-right">Últimos 90 d</ThOrden>
            <ThOrden campo="ultima_factura" orden={orden} onOrden={onOrden}>Última factura</ThOrden>
            <ThOrden campo="ultimo_pago" orden={orden} onOrden={onOrden}>Último pago</ThOrden>
            <ThOrden campo="facturado" orden={orden} onOrden={onOrden} className="text-right">Facturado</ThOrden>
            <ThOrden campo="abiertas" orden={orden} onOrden={onOrden} className="text-right">Abiertas</ThOrden>
            <th className="th"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filas.map((c) => {
            const exceso = c.exceso_sobre_plazo
            const tendencia = c.dias_promedio_90d !== null && c.dias_promedio !== null
              ? c.dias_promedio_90d - c.dias_promedio : null
            return (
              <tr key={c.customer_id} className="hover:bg-slate-50">
                <td className="td">
                  <button className="text-left font-medium text-slate-800 hover:text-sea-600 hover:underline"
                    onClick={() => onVerFacturas(c.customer_id)}
                    title="Ver las facturas de este cliente">
                    {c.cliente}
                  </button>
                  <p className="text-xs text-slate-400">
                    {c.facturas_pagadas} de {c.facturas_totales} facturas pagadas
                    {c.rut && ` · ${c.rut}`}
                  </p>
                </td>
                <td className="td text-right tabular-nums text-slate-500">{c.plazo_pactado} d</td>
                <td className="td text-right">
                  {c.dias_promedio === null
                    ? <span className="text-slate-300">—</span>
                    : <span className="text-base font-semibold tabular-nums text-navy-900">{c.dias_promedio} d</span>}
                </td>
                <td className="td text-right tabular-nums text-slate-500">
                  {c.dias_mediana === null ? '—' : `${Math.round(Number(c.dias_mediana))} d`}
                </td>
                <td className="td text-right text-xs tabular-nums text-slate-400">
                  {c.dias_minimo === null ? '—' : `${c.dias_minimo}–${c.dias_maximo}`}
                  {c.dias_desviacion !== null && c.dias_desviacion > 0 && (
                    <span className="block">±{c.dias_desviacion}</span>
                  )}
                </td>
                <td className="td text-right tabular-nums">
                  {exceso === null ? <span className="text-slate-300">—</span>
                    : exceso > 0
                      ? <span className="font-medium text-amber-600">+{exceso} d</span>
                      : <span className="text-emerald-600">{exceso} d</span>}
                </td>
                <td className="td text-right tabular-nums">
                  {c.pct_a_tiempo === null ? <span className="text-slate-300">—</span> : (
                    <span className={clsx(
                      c.pct_a_tiempo >= 80 ? 'text-emerald-600'
                      : c.pct_a_tiempo >= 50 ? 'text-amber-600' : 'text-red-600')}>
                      {c.pct_a_tiempo}%
                    </span>
                  )}
                </td>
                <td className="td text-right tabular-nums text-xs">
                  {c.dias_promedio_90d === null ? <span className="text-slate-300">—</span> : (
                    <span title={tendencia === null ? undefined
                      : tendencia > 0 ? `${tendencia} días más lento que su histórico`
                      : `${-tendencia} días más rápido que su histórico`}>
                      {c.dias_promedio_90d} d
                      {tendencia !== null && Math.abs(tendencia) >= 3 && (
                        <span className={clsx('ml-1', tendencia > 0 ? 'text-red-600' : 'text-emerald-600')}>
                          {tendencia > 0 ? '↑' : '↓'}
                        </span>
                      )}
                    </span>
                  )}
                </td>
                <td className="td text-slate-500">
                  {dateShort(c.ultima_factura)}
                  {c.primera_factura && (
                    <span className="block text-xs text-slate-400">
                      desde {dateShort(c.primera_factura)}
                    </span>
                  )}
                </td>
                <td className="td text-slate-500">
                  {c.ultimo_pago ? dateShort(c.ultimo_pago) : <span className="text-slate-300">nunca</span>}
                </td>
                <td className="td text-right">
                  <p className="tabular-nums text-slate-700">{moneyShort(c.monto_total)}</p>
                  <p className="text-xs text-slate-400">{c.facturas_totales} doc.</p>
                </td>
                <td className="td text-right">
                  {c.facturas_abiertas === 0
                    ? <span className="text-slate-300">—</span>
                    : (
                      <div>
                        <p className="tabular-nums text-slate-700">{moneyShort(c.saldo_abierto)}</p>
                        <p className="text-xs text-slate-400">
                          {c.facturas_abiertas} doc. · {c.espera_maxima} d máx.
                        </p>
                      </div>
                    )}
                </td>
                <td className="td text-right">
                  <button className="text-xs font-medium text-sea-600 hover:underline"
                    onClick={() => onCartola(c.customer_id)}>
                    Cartola
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </TableWrap>
    </>
  )
}

// ---------------------------------------------------------------- informe de fechas de pago
/**
 * Una fila por cada "este día entró plata y cubrió esta factura". Es el nivel
 * de detalle que pide el contador y el que permite reconstruir una discusión
 * con un cliente: no basta con saber que la factura está pagada, hay que poder
 * decir qué día, con qué transferencia y con cuántos días de desfase.
 */
function InformeFechasPago() {
  const [mes, setMes] = useState<string>('')
  const [buscar, setBuscar] = useState('')
  const [abierto, setAbierto] = useState(false)

  const meses = useQuery({
    queryKey: ['cob-meses-pago'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_meses_actividad').select('mes, cobros').gt('cobros', 0)
        .order('mes', { ascending: false })
      if (error) throw error
      return data as { mes: string; cobros: number }[]
    },
  })

  const detalle = useQuery({
    queryKey: ['cob-pagos-detalle', mes],
    enabled: abierto,
    queryFn: async () => {
      let q = supabase.from('v_pagos_detalle').select('*')
        .order('fecha_pago', { ascending: false }).limit(3000)
      if (mes) q = q.eq('mes_pago', mes)
      const { data, error } = await q
      if (error) throw error
      return data as PagoDetalle[]
    },
  })

  const q = buscar.trim().toLowerCase()
  const filas = (detalle.data ?? []).filter(
    (d) => !q || d.cliente.toLowerCase().includes(q) || (d.documento ?? '').toLowerCase().includes(q),
  )

  const total = filas.reduce((a, d) => a + Number(d.monto_imputado ?? 0), 0)
  const conPlazo = filas.filter((d) => d.dias_desde_emision !== null)
  const promedio = conPlazo.length
    ? Math.round(conPlazo.reduce((a, d) => a + (d.dias_desde_emision ?? 0), 0) / conPlazo.length)
    : null

  function exportar() {
    const f: (string | number)[][] = [[
      'Fecha de pago', 'Cobro', 'Cliente', 'RUT', 'Documento', 'Emitido', 'Vence',
      'Total del documento', 'Monto imputado', 'Monto del cobro', 'Forma de pago',
      'N° de operación', 'Días desde la emisión', 'Días vs. vencimiento', 'Nota',
    ]]
    for (const d of filas) {
      f.push([
        d.fecha_pago, d.pago_code, d.cliente, d.rut ?? '', d.documento ?? '',
        d.emitido ?? '', d.vence ?? '', d.total_documento ?? '', d.monto_imputado ?? '',
        d.monto_pago, d.metodo, d.reference ?? '',
        d.dias_desde_emision ?? '', d.dias_vs_vencimiento ?? '', d.notes ?? '',
      ])
    }
    descargarCsv(f, `fechas-de-pago-${mes || 'todo'}`)
  }

  return (
    <Card>
      <CardHeader
        title="Informe detallado de fechas de pago"
        action={
          <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setAbierto((v) => !v)}>
            {abierto ? 'Ocultar' : 'Ver informe'}
          </button>
        }
      />

      {!abierto && (
        <p className="px-5 py-3 text-sm text-slate-500">
          Qué día se pagó cada factura, con qué transferencia y con cuántos días de desfase
          respecto de la emisión y del vencimiento. Se puede filtrar por mes y exportar.
        </p>
      )}

      {abierto && (
        <>
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
            <select className="input w-auto" value={mes} onChange={(e) => setMes(e.target.value)}>
              <option value="">Todos los meses</option>
              {(meses.data ?? []).map((m) => (
                <option key={m.mes} value={m.mes}>
                  {nombreMes(m.mes)} ({m.cobros} cobros)
                </option>
              ))}
            </select>

            <div className="relative flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <input className="input pl-9" placeholder="Cliente o documento…"
                value={buscar} onChange={(e) => setBuscar(e.target.value)} />
            </div>

            <span className="text-xs text-slate-500">
              {filas.length} imputación(es) · {money(total)}
              {promedio !== null && ` · ${promedio} días promedio desde la emisión`}
            </span>

            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={exportar}
              disabled={filas.length === 0}>
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          </div>

          {detalle.isLoading && <Skeleton className="m-5 h-40" />}
          {detalle.isError && <div className="p-5"><ErrorState error={detalle.error} /></div>}

          {!detalle.isLoading && filas.length === 0 && (
            <EmptyState title="Sin pagos en este filtro"
              hint="Prueba con otro mes o limpia la búsqueda." />
          )}

          {filas.length > 0 && (
            <div className="max-h-[32rem] overflow-y-auto">
              <TableWrap>
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    <th className="th">Fecha de pago</th>
                    <th className="th">Cliente</th>
                    <th className="th">Documento</th>
                    <th className="th">Emitido</th>
                    <th className="th">Vence</th>
                    <th className="th text-right">Imputado</th>
                    <th className="th text-right">Días</th>
                    <th className="th">Forma de pago</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filas.map((d, i) => (
                    <tr key={`${d.payment_id}-${d.documento ?? i}`} className="hover:bg-slate-50">
                      <td className="td">
                        <p className="font-medium text-navy-900">{dateShort(d.fecha_pago)}</p>
                        <p className="text-xs text-slate-400">{d.pago_code}</p>
                      </td>
                      <td className="td font-medium text-slate-800">{d.cliente}</td>
                      <td className="td">
                        {d.documento ?? <span className="text-amber-600">sin imputar</span>}
                      </td>
                      <td className="td text-slate-500">{dateShort(d.emitido)}</td>
                      <td className="td text-slate-500">{dateShort(d.vence)}</td>
                      <td className="td text-right tabular-nums">
                        {d.monto_imputado === null ? money(d.monto_pago) : money(d.monto_imputado)}
                      </td>
                      <td className="td text-right tabular-nums">
                        {d.dias_desde_emision === null ? <span className="text-slate-300">—</span> : (
                          <span title={d.dias_vs_vencimiento === null ? undefined
                            : d.dias_vs_vencimiento > 0
                              ? `${d.dias_vs_vencimiento} días después del vencimiento`
                              : `${-d.dias_vs_vencimiento} días antes del vencimiento`}
                            className={clsx('font-medium',
                              (d.dias_vs_vencimiento ?? 0) > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                            {d.dias_desde_emision} d
                          </span>
                        )}
                      </td>
                      <td className="td text-xs text-slate-500">
                        {PAYMENT_METHOD_LABEL[d.metodo as PaymentMethod] ?? d.metodo}
                        {d.reference && <span className="block text-slate-400">ref {d.reference}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------- pagos
function PanelPagos({
  sinImputar, cargando, onImputar, onHecho,
}: {
  sinImputar: PagoSinImputar[]
  cargando: boolean
  onImputar: (p: PagoSinImputar) => void
  onHecho: () => void
}) {
  const [reiniciar, setReiniciar] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const anular = useMutation({
    mutationFn: async ({ id, motivo }: { id: string; motivo: string }) => {
      const { error } = await supabase.rpc('void_payment', { _payment_id: id, _reason: motivo })
      if (error) throw error
    },
    onSuccess: onHecho,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })
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
      {error && <ErrorState error={error} />}

      <InformeFechasPago />

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
                <button
                  className="btn-secondary px-2.5 py-1.5 text-xs"
                  title="Anular este cobro y devolver las facturas a su saldo anterior"
                  disabled={anular.isPending}
                  onClick={() => {
                    const motivo = window.prompt(
                      `Anular el cobro de ${p.customers?.name ?? ''} por ${money(p.amount)}.\n` +
                      'Las facturas que cubrió vuelven a quedar con su saldo anterior.\n\n' +
                      '¿Por qué se anula?',
                    )
                    if (motivo) anular.mutate({ id: p.id, motivo })
                  }}>
                  <Trash2 className="h-3.5 w-3.5" /> Anular
                </button>
              </div>
            )
          })}
        </div>

        {(pagos.data?.length ?? 0) > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
            <p className="flex-1 text-xs text-slate-500">
              ¿Estabas probando? Puedes borrar todos los cobros de una vez y dejar la cartera
              como estaba. No toca facturas, clientes ni productos.
            </p>
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setReiniciar(true)}>
              <RotateCcw className="h-3.5 w-3.5" /> Reiniciar cobranza
            </button>
          </div>
        )}
      </Card>

      {reiniciar && (
        <ModalReiniciar onClose={() => setReiniciar(false)}
          onHecho={() => { setReiniciar(false); onHecho() }} />
      )}
    </div>
  )
}

/**
 * Borrar cobros es irreversible, así que primero se simula y se muestra
 * exactamente qué se va a borrar. Recién después se habilita el botón,
 * y solo si se escribe la frase completa.
 */
function ModalReiniciar({ onClose, onHecho }: { onClose: () => void; onHecho: () => void }) {
  const [frase, setFrase] = useState('')
  const [error, setError] = useState<string | null>(null)

  const previo = useQuery({
    queryKey: ['reset-preview'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('reset_collections', {
        _confirm: 'REINICIAR COBRANZA', _customer_id: null, _dry_run: true,
      })
      if (error) throw error
      return data as {
        pagos: number; monto: number; imputaciones: number; documentos_afectados: number
        avisos_a_reabrir: number
      }
    },
  })

  const ejecutar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('reset_collections', {
        _confirm: 'REINICIAR COBRANZA', _customer_id: null, _dry_run: false,
      })
      if (error) throw error
    },
    onSuccess: onHecho,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const listo = frase.trim().toUpperCase() === 'REINICIAR COBRANZA'

  return (
    <Modal open onClose={onClose} title="Reiniciar la cobranza"
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-danger" disabled={!listo || ejecutar.isPending}
            onClick={() => ejecutar.mutate()}>
            {ejecutar.isPending ? 'Borrando…' : 'Borrar los cobros'}
          </button>
        </>
      }>
      <div className="space-y-4">
        {error && <ErrorState error={error} />}
        {previo.isLoading && <Skeleton className="h-24" />}
        {previo.isError && <ErrorState error={previo.error} />}

        {previo.data && (
          <>
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm">
              <p className="font-medium text-red-900">Se va a borrar:</p>
              <ul className="mt-2 space-y-1 text-red-800">
                <li>· {previo.data.pagos} cobro(s) por {money(previo.data.monto)}</li>
                <li>· {previo.data.imputaciones} imputación(es)</li>
                <li>· {previo.data.documentos_afectados} factura(s) vuelven a su saldo anterior</li>
                {previo.data.avisos_a_reabrir > 0 && (
                  <li>· {previo.data.avisos_a_reabrir} aviso(s) del portal vuelven a «pendiente»</li>
                )}
              </ul>
            </div>

            <p className="text-sm text-slate-600">
              Las facturas, los clientes y los productos <span className="font-medium">no se tocan</span>.
              Queda registrado en Auditoría quién lo hizo y cuándo.
            </p>

            {previo.data.pagos === 0 ? (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                No hay cobros registrados: no hay nada que reiniciar.
              </p>
            ) : (
              <label className="block">
                <span className="label">Para confirmar, escribe: REINICIAR COBRANZA</span>
                <input className="input" value={frase} placeholder="REINICIAR COBRANZA"
                  onChange={(e) => setFrase(e.target.value)} />
              </label>
            )}
          </>
        )}
      </div>
    </Modal>
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

// ---------------------------------------------------------------- selector de facturas
// El corazón del cobro: elegir qué documentos cubre el dinero que entró.
// Ordena por fecha de emisión (la más antigua primero, que es el orden en
// que se cobra) y deja filtrar, porque un cliente con 55 facturas abiertas
// no se maneja con una lista plana.

type Orden = 'emision' | 'vencimiento' | 'monto'
type Filtro = 'todas' | 'vencidas' | 'graves' | 'por_vencer' | 'abonadas' | 'pagadas'

const FILTRO_LABEL: Record<Filtro, string> = {
  todas: 'Por cobrar',
  vencidas: 'Vencidas',
  graves: '+30 días',
  por_vencer: 'Por vencer',
  abonadas: 'Con abono',
  pagadas: 'Ya pagadas',
}

/** Días que faltan para el vencimiento, o cuántos lleva vencida. */
function diasHasta(fecha: string | null): number | null {
  if (!fecha) return null
  const [a, m, d] = fecha.split('-').map(Number)
  const vence = new Date(a, m - 1, d).getTime()
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  return Math.round((vence - hoy.getTime()) / 86_400_000)
}

function Vencimiento({ doc }: { doc: CuentaPorCobrar }) {
  const dias = diasHasta(doc.due_date)
  if (dias === null) return <span className="text-slate-400">sin plazo</span>
  if (dias < 0) {
    return (
      <span className={clsx('font-medium', dias < -30 ? 'text-red-700' : 'text-red-600')}>
        {-dias} {-dias === 1 ? 'día' : 'días'} vencida
      </span>
    )
  }
  if (dias === 0) return <span className="font-medium text-orange-600">vence hoy</span>
  return <span className={dias <= 7 ? 'text-amber-600' : 'text-slate-500'}>en {dias} días</span>
}

function SelectorFacturas({
  documentos, historial, cargando, reparto, setReparto, disponible,
}: {
  documentos: CuentaPorCobrar[]
  /** Todas las facturas del cliente, pagadas incluidas. Sirve para consultar
   *  mientras se registra el cobro: el cliente suele preguntar por una que ya pagó. */
  historial: FacturaConPago[]
  cargando: boolean
  reparto: Record<string, string>
  setReparto: (f: (r: Record<string, string>) => Record<string, string>) => void
  disponible: number
}) {
  const [orden, setOrden] = useState<Orden>('emision')
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [buscar, setBuscar] = useState('')
  const [mes, setMes] = useState('')

  /** Meses en que este cliente tiene facturas, para no ofrecer meses vacíos. */
  const mesesDisponibles = useMemo(() => {
    const set = new Set<string>()
    for (const d of documentos) set.add(d.issued_at.slice(0, 7))
    for (const h of historial) set.add(h.mes_emision)
    return [...set].sort().reverse()
  }, [documentos, historial])

  const pagadas = useMemo(
    () => historial.filter((h) => h.payment_status === 'pagado'),
    [historial],
  )

  const visibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    const filtradas = documentos.filter((d) => {
      if (q && !(d.doc_number ?? d.code).toLowerCase().includes(q)) return false
      if (mes && d.issued_at.slice(0, 7) !== mes) return false
      if (filtro === 'vencidas') return d.dias_atraso > 0
      if (filtro === 'graves') return d.dias_atraso > 30
      if (filtro === 'por_vencer') return d.dias_atraso === 0
      if (filtro === 'abonadas') return Number(d.amount_paid) > 0
      return true
    })
    const orden_fn: Record<Orden, (a: CuentaPorCobrar, b: CuentaPorCobrar) => number> = {
      emision: (a, b) => a.issued_at.localeCompare(b.issued_at),
      vencimiento: (a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'),
      monto: (a, b) => Number(b.saldo) - Number(a.saldo),
    }
    return [...filtradas].sort(orden_fn[orden])
  }, [documentos, buscar, filtro, orden, mes])

  /** Las pagadas se muestran solo para consulta: no se les puede imputar nada. */
  const pagadasVisibles = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    return pagadas
      .filter((h) => (!q || h.doc_number.toLowerCase().includes(q)) && (!mes || h.mes_emision === mes))
      .sort((a, b) => (b.ultimo_pago ?? '').localeCompare(a.ultimo_pago ?? ''))
  }, [pagadas, buscar, mes])

  const saldoVisible = visibles.reduce((a, d) => a + Number(d.saldo), 0)
  const seleccionadas = Object.keys(reparto).filter((k) => Number(reparto[k]) > 0).length

  /** Reparte lo disponible entre las facturas visibles, en el orden en que se ven. */
  function repartir() {
    let quedan = disponible
    const nuevo: Record<string, string> = {}
    for (const d of visibles) {
      if (quedan <= 0) break
      const aplica = Math.min(quedan, Number(d.saldo))
      nuevo[`${d.origen}:${d.ref_id}`] = String(Math.round(aplica))
      quedan -= aplica
    }
    setReparto(() => nuevo)
  }

  function marcarTodas() {
    const nuevo: Record<string, string> = {}
    for (const d of visibles) nuevo[`${d.origen}:${d.ref_id}`] = String(Math.round(Number(d.saldo)))
    setReparto((r) => ({ ...r, ...nuevo }))
  }

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="space-y-2 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:max-w-[200px]">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
            <input className="input pl-9" placeholder="N° de factura…" value={buscar}
              onChange={(e) => setBuscar(e.target.value)} />
          </div>
          <select className="input w-auto" value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
            <option value="emision">Más antigua primero</option>
            <option value="vencimiento">Por vencimiento</option>
            <option value="monto">Mayor saldo primero</option>
          </select>
          <select className="input w-auto" value={mes} onChange={(e) => setMes(e.target.value)}>
            <option value="">Todos los meses</option>
            {mesesDisponibles.map((m) => (
              <option key={m} value={m}>{nombreMes(m)}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {(Object.keys(FILTRO_LABEL) as Filtro[]).map((f) => {
            const n = f === 'pagadas' ? pagadas.length : documentos.filter((d) =>
              f === 'vencidas' ? d.dias_atraso > 0
              : f === 'graves' ? d.dias_atraso > 30
              : f === 'por_vencer' ? d.dias_atraso === 0
              : f === 'abonadas' ? Number(d.amount_paid) > 0
              : true).length
            if (n === 0 && f !== 'todas') return null
            return (
              <button key={f} type="button" onClick={() => setFiltro(f)}
                className={clsx('rounded-full px-3 py-1 text-xs font-medium',
                  filtro === f ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
                {FILTRO_LABEL[f]} <span className="opacity-60">{n}</span>
              </button>
            )
          })}
        </div>

        {filtro === 'pagadas' ? (
          <p className="text-xs text-slate-500">
            {pagadasVisibles.length} factura(s) ya pagada(s){mes && ` en ${nombreMes(mes)}`}.
            Se muestran solo para consultar la fecha de pago; no se les puede imputar nada.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-500">
              {visibles.length} documento(s) · {money(saldoVisible)}
            </span>
            <button type="button" className="text-sea-600 hover:underline"
              onClick={repartir} disabled={disponible <= 0}>
              Repartir {money(disponible)} en este orden
            </button>
            <button type="button" className="text-sea-600 hover:underline" onClick={marcarTodas}>
              Marcar todas
            </button>
            {seleccionadas > 0 && (
              <button type="button" className="text-slate-500 hover:underline"
                onClick={() => setReparto(() => ({}))}>
                Limpiar ({seleccionadas})
              </button>
            )}
          </div>
        )}
      </div>

      <div className="max-h-[22rem] overflow-y-auto">
        {cargando && <Skeleton className="m-4 h-24" />}

        {!cargando && filtro === 'pagadas' && pagadasVisibles.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-400">
            Este cliente todavía no tiene facturas pagadas{mes && ` en ${nombreMes(mes)}`}
          </p>
        )}

        {filtro === 'pagadas' && pagadasVisibles.map((h) => (
          <div key={h.invoice_id}
            className="flex items-center gap-3 border-b border-slate-50 px-4 py-2.5 opacity-90">
            <Check className="h-4 w-4 shrink-0 text-emerald-500" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-800">{h.doc_number}</p>
              <p className="text-xs text-slate-400">
                Emitida {dateShort(h.issued_at)} · pagada {dateShort(h.ultimo_pago)}
                {h.dias_en_pagar !== null && ` · ${h.dias_en_pagar} días`}
                {h.n_pagos > 1 && ` · ${h.n_pagos} pagos`}
              </p>
            </div>
            <p className="shrink-0 text-sm tabular-nums text-slate-500">{money(h.total)}</p>
          </div>
        ))}

        {!cargando && filtro !== 'pagadas' && visibles.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-slate-400">
            {documentos.length === 0
              ? 'Este cliente no tiene documentos pendientes'
              : 'Ningún documento calza con el filtro'}
          </p>
        )}

        {filtro !== 'pagadas' && visibles.map((d) => {
          const key = `${d.origen}:${d.ref_id}`
          const marcada = !!reparto[key]
          const parcial = Number(d.amount_paid) > 0
          return (
            <label key={key}
              className={clsx('flex cursor-pointer items-center gap-3 border-b border-slate-50 px-4 py-2.5',
                marcada ? 'bg-sea-50/60' : 'hover:bg-slate-50')}>
              <input type="checkbox" className="h-4 w-4 shrink-0" checked={marcada}
                onChange={(e) => setReparto((r) => {
                  const n = { ...r }
                  if (e.target.checked) n[key] = String(Math.round(Number(d.saldo)))
                  else delete n[key]
                  return n
                })} />

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">
                  {d.doc_number ?? d.code}
                  {parcial && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      abonada
                    </span>
                  )}
                </p>
                <p className="text-xs text-slate-400">
                  Emitida {dateShort(d.issued_at)} · vence {dateShort(d.due_date)} · <Vencimiento doc={d} />
                </p>
              </div>

              <div className="hidden text-right sm:block">
                <p className="text-sm tabular-nums text-slate-700">{money(d.saldo)}</p>
                {parcial && (
                  <p className="text-[11px] text-slate-400">de {money(d.total)}</p>
                )}
              </div>

              <input type="number" min={0} max={Number(d.saldo)} placeholder="0"
                className="input w-28 shrink-0 text-right text-sm"
                onClick={(e) => e.preventDefault()}
                value={reparto[key] ?? ''}
                onChange={(e) => setReparto((r) => ({ ...r, [key]: e.target.value }))} />
            </label>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Una línea con cómo paga este cliente, para tenerla a la vista mientras se
 * registra el cobro: si históricamente paga a 50 días y el plazo es 30, eso
 * cambia la conversación que viene después.
 */
function ResumenPagoCliente({ customerId }: { customerId: string }) {
  const c = useQuery({
    queryKey: ['cob-comportamiento-cliente', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_comportamiento_pago_cliente').select('*')
        .eq('customer_id', customerId).maybeSingle()
      if (error) throw error
      return data as ComportamientoPago | null
    },
  })

  const d = c.data
  if (!d || d.dias_promedio === null) return null

  const exceso = d.exceso_sobre_plazo ?? 0
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-slate-600">
        <Timer className="h-3.5 w-3.5" /> Cómo paga
      </span>
      <span className="text-slate-500">
        Promedio <span className="font-semibold text-navy-900">{d.dias_promedio} días</span>
        {' '}sobre {d.facturas_pagadas} facturas pagadas
      </span>
      <span className="text-slate-500">
        Plazo pactado {d.plazo_pactado} d
        {exceso > 0 && <span className="ml-1 font-medium text-amber-600">(+{exceso} d)</span>}
        {exceso < 0 && <span className="ml-1 text-emerald-600">({exceso} d)</span>}
      </span>
      {d.dias_minimo !== null && (
        <span className="text-slate-400">Entre {d.dias_minimo} y {d.dias_maximo} días</span>
      )}
      {d.pct_a_tiempo !== null && (
        <span className={clsx('font-medium',
          d.pct_a_tiempo >= 80 ? 'text-emerald-600'
          : d.pct_a_tiempo >= 50 ? 'text-amber-600' : 'text-red-600')}>
          {d.pct_a_tiempo}% dentro del plazo
        </span>
      )}
      {d.ultimo_pago && (
        <span className="text-slate-400">Último pago {dateShort(d.ultimo_pago)}</span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- panel del cliente
/** Cómo está la cuenta del cliente, antes de decidir qué se cobra. */
function PanelCliente({ c }: { c: EstadoCuentaCliente }) {
  const tramos = [
    { label: 'Por vencer', valor: Number(c.por_vencer), clase: 'bg-emerald-500' },
    { label: '1-15 días', valor: Number(c.atraso_1_15), clase: 'bg-amber-400' },
    { label: '16-30 días', valor: Number(c.atraso_16_30), clase: 'bg-orange-500' },
    { label: '31-60 días', valor: Number(c.atraso_31_60), clase: 'bg-red-500' },
    { label: '+60 días', valor: Number(c.atraso_60_mas), clase: 'bg-red-800' },
  ].filter((t) => t.valor > 0)

  const total = Number(c.deuda_total) || 1
  const aFavor = Number(c.nota_credito) + Number(c.pago_a_cuenta)

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Dato label="Deuda total" valor={money(c.deuda_total)} />
        <Dato label="Vencido" valor={money(c.vencido)} tono={Number(c.vencido) > 0 ? 'malo' : undefined} />
        <Dato label="A favor" valor={aFavor > 0 ? money(aFavor) : '—'} tono={aFavor > 0 ? 'bueno' : undefined} />
        <Dato label="Documentos" valor={String(c.documentos)} />
      </div>

      {tramos.length > 0 && (
        <div className="mt-3">
          <div className="flex h-2 overflow-hidden rounded-full bg-slate-200">
            {tramos.map((t) => (
              <div key={t.label} className={t.clase} style={{ width: `${(t.valor / total) * 100}%` }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {tramos.map((t) => (
              <span key={t.label} className="flex items-center gap-1.5 text-slate-600">
                <span className={clsx('h-2 w-2 rounded-full', t.clase)} />
                {t.label} <span className="tabular-nums font-medium">{money(t.valor)}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 pt-2 text-xs text-slate-500">
        <span>Plazo {c.payment_terms_days} días</span>
        {c.peor_atraso > 0 && (
          <span className="text-red-600">Peor atraso {c.peor_atraso} días</span>
        )}
        {c.vence_primero && <span>Vence primero {dateShort(c.vence_primero)}</span>}
        <span>Último pago {c.ultimo_pago ? dateShort(c.ultimo_pago) : 'sin registros'}</span>
        {c.sobre_limite && (
          <span className="font-medium text-red-600">Sobre el límite de crédito</span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- barra de imputación
function BarraImputacion({ monto, imputado }: { monto: number; imputado: number }) {
  const resto = monto - imputado
  const pctImputado = monto > 0 ? Math.min((imputado / monto) * 100, 100) : 0
  return (
    <div className="rounded-lg bg-navy-900 px-4 py-3 text-white">
      <div className="flex items-center justify-between text-sm">
        <span className="text-navy-200">Pago {money(monto)}</span>
        <span className="tabular-nums">
          Imputado {money(imputado)}
          {Math.abs(resto) > 0.5 && (
            <span className={resto > 0 ? 'text-amber-300' : 'text-red-300'}>
              {' · '}{resto > 0 ? `${money(resto)} a cuenta` : `${money(-resto)} de más`}
            </span>
          )}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-700">
        <div className={clsx('h-full', resto < -0.5 ? 'bg-red-400' : 'bg-sea-400')}
          style={{ width: `${pctImputado}%` }} />
      </div>
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
  const [notas, setNotas] = useState('')
  const [reparto, setReparto] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const cliente = clientes.find((c) => c.customer_id === customerId)

  const docs = useQuery({
    queryKey: ['cob-docs-cliente', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_por_cobrar').select('*').eq('customer_id', customerId)
        .order('issued_at', { ascending: true })
      if (error) throw error
      return data as CuentaPorCobrar[]
    },
  })

  // El historial completo del cliente. Se consulta acá mismo porque la
  // conversación al registrar un pago casi siempre incluye "¿y la de marzo?".
  const historial = useQuery({
    queryKey: ['cob-historial-cliente', customerId],
    enabled: !!customerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_facturas_con_pago').select('*').eq('customer_id', customerId)
        .order('issued_at', { ascending: false }).limit(2000)
      if (error) throw error
      return data as FacturaConPago[]
    },
  })

  const montoNum = Number(monto) || 0
  const imputado = Object.values(reparto).reduce((a, v) => a + (Number(v) || 0), 0)
  const resto = montoNum - imputado

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
        _notes: notas.trim() || null,
        _allocations: allocations.length ? allocations : null,
        _auto: false,
      })
      if (error) throw error
      return data
    },
    onSuccess: onHecho,
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const listo = !!customerId && montoNum > 0 && resto >= -0.5

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
          <label className="block sm:col-span-2">
            <span className="label">Cliente</span>
            {/* Se listan todos, no solo los que deben: a un cliente al día
                igual hay que poder abrirle la ficha para revisar sus pagos. */}
            <select className="input" value={customerId}
              onChange={(e) => { setCustomerId(e.target.value); setReparto({}) }}>
              <option value="">Selecciona…</option>
              <optgroup label="Con deuda">
                {clientes.filter((c) => Number(c.deuda_total) > 0).map((c) => (
                  <option key={c.customer_id} value={c.customer_id}>
                    {c.cliente} — debe {money(c.deuda_total)} en {c.documentos} doc.
                  </option>
                ))}
              </optgroup>
              <optgroup label="Al día">
                {clientes.filter((c) => Number(c.deuda_total) <= 0).map((c) => (
                  <option key={c.customer_id} value={c.customer_id}>{c.cliente}</option>
                ))}
              </optgroup>
            </select>
          </label>

          <label className="block">
            <span className="label">Monto recibido</span>
            <input className="input" type="number" min={0} value={monto} placeholder="0"
              onChange={(e) => setMonto(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Fecha del pago</span>
            <input className="input" type="date" value={fecha}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setFecha(e.target.value)} />
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
            <span className="label">N° de operación</span>
            <input className="input" value={referencia} placeholder="Opcional"
              onChange={(e) => setReferencia(e.target.value)} />
          </label>
        </div>

        {cliente && <PanelCliente c={cliente} />}

        {customerId && (
          <>
            <BarraImputacion monto={montoNum} imputado={imputado} />
            <ResumenPagoCliente customerId={customerId} />
            <SelectorFacturas documentos={docs.data ?? []} historial={historial.data ?? []}
              cargando={docs.isLoading}
              reparto={reparto} setReparto={setReparto}
              disponible={montoNum} />
          </>
        )}

        <label className="block">
          <span className="label">Nota interna</span>
          <input className="input" value={notas} placeholder="Opcional"
            onChange={(e) => setNotas(e.target.value)} />
        </label>

        {resto > 0.5 && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Quedan {money(resto)} sin asignar. Se guardan como saldo a favor del cliente
            y quedan en la pestaña de Pagos para imputar cuando se sepa a qué factura van.
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

  const cliente = useQuery({
    queryKey: ['estado-cuenta', pago.customer_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_estado_cuenta_cliente').select('*').eq('customer_id', pago.customer_id).single()
      if (error) throw error
      return data as EstadoCuentaCliente
    },
  })

  const docs = useQuery({
    queryKey: ['cob-docs-cliente', pago.customer_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_por_cobrar').select('*').eq('customer_id', pago.customer_id)
        .order('issued_at', { ascending: true })
      if (error) throw error
      return data as CuentaPorCobrar[]
    },
  })

  const historial = useQuery({
    queryKey: ['cob-historial-cliente', pago.customer_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_facturas_con_pago').select('*').eq('customer_id', pago.customer_id)
        .order('issued_at', { ascending: false }).limit(2000)
      if (error) throw error
      return data as FacturaConPago[]
    },
  })

  const imputado = Object.values(reparto).reduce((a, v) => a + (Number(v) || 0), 0)
  const resto = Number(pago.amount) - imputado

  const guardar = useMutation({
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
          <button className="btn-primary" disabled={imputado <= 0 || resto < -0.5 || guardar.isPending}
            onClick={() => guardar.mutate()}>
            Guardar imputación
          </button>
        </>
      }>
      <div className="space-y-4">
        {error && <ErrorState error={error} />}

        <p className="text-sm text-slate-500">
          {pago.code} · {dateShort(pago.paid_at)} · {PAYMENT_METHOD_LABEL[pago.method]}
          {pago.reference && ` · ref ${pago.reference}`}
        </p>

        {cliente.data && <PanelCliente c={cliente.data} />}

        <BarraImputacion monto={Number(pago.amount)} imputado={imputado} />

        <SelectorFacturas documentos={docs.data ?? []} historial={historial.data ?? []}
          cargando={docs.isLoading}
          reparto={reparto} setReparto={setReparto}
          disponible={Number(pago.amount)} />

        {resto < -0.5 && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
            Estás asignando {money(-resto)} más de lo que tiene el pago.
          </p>
        )}
      </div>
    </Modal>
  )
}
