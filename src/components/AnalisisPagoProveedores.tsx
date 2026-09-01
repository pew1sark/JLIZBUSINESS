import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { AlertTriangle, CalendarClock, Download, Search, Timer, Wallet } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { dateShort, money, moneyShort } from '../lib/format'
import { descargarCsv } from '../lib/csv'
import { nombreMes, rangoDe, type Periodo } from '../lib/periodo'
import { FiltroPeriodo, ThOrden } from './Filtros'
import { useOrden, ordenar } from '../lib/orden'
import {
  dias, evolucionMensual, rankingProveedores, resumenPagos,
  type PagoProveedor, type ProveedorPagos,
} from '../lib/pagos'
import { Card, CardHeader, EmptyState, ErrorState, Skeleton, StatCard, TableWrap, NombreEntidad } from './ui'

type ColRanking =
  | 'proveedor' | 'deuda' | 'facturado' | 'documentos' | 'plazo' | 'pago_real' | 'atraso' | 'a_tiempo'

type FiltroTramo = 'todos' | 'por_vencer' | 'vencida' | 'programada' | 'pagada'

const TRAMO_LABEL: Record<FiltroTramo, string> = {
  todos: 'Todos los documentos',
  por_vencer: 'Solo por vencer',
  vencida: 'Solo vencidas',
  programada: 'Solo pago programado',
  pagada: 'Solo pagadas',
}

/**
 * ANÁLISIS DE PAGOS A PROVEEDORES
 *
 * Responde la pregunta que la pantalla de cuentas por pagar no respondía: no
 * cuánto se debe, sino a qué plazo se compró, cuándo hay que pagar y qué tan
 * lejos del plazo se está pagando de verdad.
 *
 * El promedio de plazo es ponderado por monto, no simple. Una factura de
 * $5.000.000 a 40 días junto a una de $2.000.000 a 10 días dan 31,43 días de
 * financiamiento real, no 25: el promedio simple trata igual a las dos y
 * esconde que casi toda la plata está a 40.
 */
export function AnalisisPagoProveedores() {
  const datos = useQuery({
    queryKey: ['pago-proveedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_pago_proveedores').select('*')
        .order('emitida', { ascending: false })
        .limit(5000)
      if (error) throw error
      return data as PagoProveedor[]
    },
  })

  if (datos.isError) return <ErrorState error={datos.error} />
  if (datos.isLoading) return <Skeleton className="h-96" />
  return <PanelAnalisisPagos filas={datos.data ?? []} />
}

/** La pantalla propiamente tal, separada de la consulta para poder probarla con datos fijos. */
function PanelAnalisisPagos({ filas: todas }: { filas: PagoProveedor[] }) {
  const [periodo, setPeriodo] = useState<Periodo>(() => rangoDe('anio'))
  const [proveedor, setProveedor] = useState('')
  const [tramo, setTramo] = useState<FiltroTramo>('todos')
  const [buscar, setBuscar] = useState('')
  const orden = useOrden<ColRanking>('deuda')

  /** El filtro de período mira la fecha de emisión del documento de compra. */
  const filas = useMemo(() => {
    const t = buscar.trim().toLowerCase()
    return todas.filter((f) => {
      if (periodo.desde && f.emitida < periodo.desde) return false
      if (periodo.hasta && f.emitida > periodo.hasta) return false
      if (proveedor && f.supplier_id !== proveedor) return false
      if (tramo !== 'todos' && f.tramo !== tramo) return false
      if (t && !f.proveedor.toLowerCase().includes(t)
            && !(f.razon_social ?? '').toLowerCase().includes(t)
            && !(f.rut ?? '').toLowerCase().includes(t)
            && !(f.invoice_number ?? '').toLowerCase().includes(t)) return false
      return true
    })
  }, [todas, periodo.desde, periodo.hasta, proveedor, tramo, buscar])

  const r = useMemo(() => resumenPagos(filas), [filas])
  const meses = useMemo(() => evolucionMensual(filas), [filas])
  const ranking = useMemo(() => rankingProveedores(filas), [filas])

  const rankingOrdenado = useMemo(() => ordenar(ranking, orden.orden, (p, c) => ({
    proveedor: p.proveedor,
    deuda: p.deuda,
    facturado: p.facturado,
    documentos: p.documentos,
    plazo: p.plazoPonderado,
    pago_real: p.pagoReal,
    atraso: p.atraso,
    a_tiempo: p.pctATiempo,
  })[c]), [ranking, orden.orden])

  /** Para el selector: todos los proveedores del período, no solo los filtrados. */
  const proveedores = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of todas) {
      if (periodo.desde && f.emitida < periodo.desde) continue
      if (periodo.hasta && f.emitida > periodo.hasta) continue
      m.set(f.supplier_id, f.proveedor)
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [todas, periodo.desde, periodo.hasta])

  const serie = useMemo(() => meses.map((m) => ({
    mes: `${nombreMes(m.mes).slice(0, 3)} ${m.mes.slice(2, 4)}`,
    mesCompleto: m.mes,
    Comprado: Math.round(m.facturado),
    'Plazo pactado': m.plazoPonderado === null ? null : Math.round(m.plazoPonderado * 10) / 10,
    'Pago real': m.pagoReal === null ? null : Math.round(m.pagoReal * 10) / 10,
  })), [meses])

  function exportar() {
    const cab: (string | number)[][] = [[
      'Proveedor', 'Razón social', 'RUT', 'Documentos', 'Facturado', 'Deuda', 'Vencidas',
      'Monto vencido', 'Plazo pactado (pond.)', 'Pago real', 'Atraso', '% a tiempo',
      'Última compra', 'Último pago',
    ]]
    for (const p of rankingOrdenado) {
      cab.push([p.proveedor, p.razon_social ?? '', p.rut ?? '', p.documentos,
        Math.round(p.facturado), Math.round(p.deuda), p.vencidas, Math.round(p.montoVencido),
        p.plazoPonderado === null ? '' : p.plazoPonderado.toFixed(2),
        p.pagoReal === null ? '' : p.pagoReal.toFixed(2),
        p.atraso === null ? '' : p.atraso.toFixed(2),
        p.pctATiempo ?? '', p.ultimaCompra ?? '', p.ultimoPago ?? ''])
    }
    descargarCsv(cab, `pagos-a-proveedores-${periodo.desde ?? 'todo'}`)
  }

  const pctEstimado = r.pagadas.docs ? Math.round((100 * r.estimadas) / r.pagadas.docs) : 0

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------ filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
        <select className="input w-auto max-w-[16rem]" value={proveedor}
          onChange={(e) => setProveedor(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {proveedores.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
        </select>
        <select className="input w-auto" value={tramo}
          onChange={(e) => setTramo(e.target.value as FiltroTramo)}>
          {Object.entries(TRAMO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar proveedor, RUT o factura…"
            value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <button onClick={exportar} className="btn-secondary"><Download className="h-4 w-4" /> CSV</button>
      </div>

      {filas.length === 0 ? (
        <Card>
          <EmptyState title="Sin compras en este filtro"
            hint="Prueba ampliando el período o quitando el proveedor." />
        </Card>
      ) : (
        <>
          {/* ------------------------------------------------ resumen ejecutivo */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Deuda pendiente" value={money(r.deuda)}
              tone={r.deuda > 0 ? 'warning' : 'default'}
              icon={<Wallet className="h-4 w-4" />}
              hint={`${r.porVencer.docs + r.vencidas.docs} documentos abiertos`} />
            <StatCard label="Plazo promedio ponderado"
              value={dias(r.plazoPonderado)}
              icon={<CalendarClock className="h-4 w-4" />}
              hint={`Promedio simple ${dias(r.plazoSimple)} · ponderado por monto`} />
            <StatCard label="Pago real promedio" value={dias(r.pagoReal)}
              icon={<Timer className="h-4 w-4" />}
              hint={r.pagadas.docs ? `${r.pagadas.docs} facturas ya pagadas` : 'Sin pagos en el período'} />
            <StatCard label="Días promedio de atraso"
              value={dias(r.atraso, true)}
              tone={r.atraso === null ? 'default' : r.atraso > 0 ? 'danger' : 'positive'}
              icon={<AlertTriangle className="h-4 w-4" />}
              hint={r.pctATiempo === null ? 'Sin facturas pagadas para medir'
                : `${r.pctATiempo}% se pagó dentro del plazo`} />
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Por vencer" value={money(r.porVencer.monto)}
              hint={`${r.porVencer.docs} facturas todavía en plazo`} />
            <StatCard label="Vencidas" value={money(r.vencidas.monto)}
              tone={r.vencidas.monto > 0 ? 'danger' : 'default'}
              hint={`${r.vencidas.docs} facturas pasadas de fecha`} />
            <StatCard label="Comprado en el período" value={money(r.facturado)}
              hint={`${r.documentos} documentos · IVA ${money(r.iva)}`} />
            {r.programadas.docs > 0 ? (
              <StatCard label="Pago programado" value={money(r.programadas.monto)}
                hint={`${r.programadas.docs} facturas con fecha de pago futura`} />
            ) : (
              <StatCard label="Notas de crédito" value={money(Math.abs(r.notasCredito.monto))}
                tone={r.notasCredito.docs ? 'positive' : 'default'}
                hint={`${r.notasCredito.docs} documentos que bajan la deuda`} />
            )}
          </div>

          {r.programadas.docs > 0 && (
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">
              <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
              {r.programadas.docs} facturas por {money(r.programadas.monto)} tienen un pago registrado con
              fecha futura: la plata todavía no sale. Quedan fuera del pago real promedio y del atraso para
              no mejorar el mes en curso con algo que aún no ocurre.
            </p>
          )}

          {/* Un promedio de atraso de cero no significa que se pague puntual si
              la fecha de pago se reconstruyó a plazo fijo. Decirlo evita que el
              número se lea como un logro operacional. */}
          {r.estimadas > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
              {pctEstimado}% de las facturas pagadas del período ({r.estimadas} de {r.pagadas.docs},
              {' '}{money(r.montoEstimado)}) tiene la fecha de pago reconstruida a plazo fijo en la carga
              histórica, no comprobada contra la cartola del banco. El pago real promedio y el atraso de
              esos meses reflejan ese supuesto, no el comportamiento medido.
            </p>
          )}

          {/* ----------------------------------------------- evolución mensual */}
          <Card>
            <CardHeader title="Evolución mensual del comportamiento de pago" />
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false} axisLine={false} />
                  <YAxis yAxisId="monto" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false}
                    axisLine={false} tickFormatter={(v) => moneyShort(v as number)} width={55} />
                  <YAxis yAxisId="dias" orientation="right" tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false} axisLine={false} width={42}
                    tickFormatter={(v) => `${v} d`} />
                  <Tooltip
                    formatter={(v, n) => n === 'Comprado' ? money(v as number) : `${v} días`}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="monto" dataKey="Comprado" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="dias" type="monotone" dataKey="Plazo pactado" stroke="#64748b"
                    strokeDasharray="4 4" strokeWidth={2} dot={false} connectNulls />
                  <Line yAxisId="dias" type="monotone" dataKey="Pago real" stroke="#1eafa7"
                    strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Mes</th>
                  <th className="th text-right">Documentos</th>
                  <th className="th text-right">Comprado</th>
                  <th className="th text-right">Plazo pactado</th>
                  <th className="th text-right">Pago real</th>
                  <th className="th text-right">Atraso</th>
                  <th className="th text-right">A tiempo</th>
                  <th className="th text-right">Deuda abierta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {meses.map((m) => (
                  <tr key={m.mes} className="hover:bg-slate-50">
                    <td className="td font-medium text-slate-700 capitalize">
                      {nombreMes(m.mes)}
                      {m.estimadas > 0 && (
                        <span className="ml-1.5 text-[11px] font-normal text-amber-600">
                          {m.estimadas === m.pagadas ? 'estimado' : `${m.estimadas} estimados`}
                        </span>
                      )}
                      {m.programadas > 0 && (
                        <span className="ml-1.5 text-[11px] font-normal text-sky-600">
                          {m.programadas} programados
                        </span>
                      )}
                    </td>
                    <td className="td text-right tabular-nums text-slate-500">{m.documentos}</td>
                    <td className="td text-right tabular-nums">{money(m.facturado)}</td>
                    <td className="td text-right tabular-nums text-slate-500">{dias(m.plazoPonderado)}</td>
                    <td className="td text-right tabular-nums font-medium">{dias(m.pagoReal)}</td>
                    <td className={clsx('td text-right tabular-nums',
                      m.atraso === null ? 'text-slate-300'
                      : m.atraso > 0 ? 'font-medium text-red-600' : 'text-emerald-600')}>
                      {dias(m.atraso, true)}
                    </td>
                    <td className="td text-right tabular-nums text-slate-500">
                      {m.pctATiempo === null ? '—' : `${m.pctATiempo}%`}
                    </td>
                    <td className={clsx('td text-right tabular-nums',
                      m.deuda > 0 ? 'text-amber-700' : 'text-slate-400')}>
                      {money(m.deuda)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>

          {/* ------------------------------------------------------- ranking */}
          <Card>
            <CardHeader title={`Proveedores (${ranking.length})`}
              action={<span className="text-xs text-slate-400">toca un encabezado para ordenar</span>} />
            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <ThOrden campo="proveedor" orden={orden.orden} onOrden={orden.cambiar} porDefecto="asc">
                    Proveedor
                  </ThOrden>
                  <ThOrden campo="documentos" orden={orden.orden} onOrden={orden.cambiar} className="text-right">
                    Facturas
                  </ThOrden>
                  <ThOrden campo="facturado" orden={orden.orden} onOrden={orden.cambiar} className="text-right">
                    Comprado
                  </ThOrden>
                  <ThOrden campo="deuda" orden={orden.orden} onOrden={orden.cambiar} className="text-right">
                    Deuda
                  </ThOrden>
                  <ThOrden campo="plazo" orden={orden.orden} onOrden={orden.cambiar} className="text-right">
                    Plazo pactado
                  </ThOrden>
                  <ThOrden campo="pago_real" orden={orden.orden} onOrden={orden.cambiar} className="text-right">
                    Pago real
                  </ThOrden>
                  <ThOrden campo="atraso" orden={orden.orden} onOrden={orden.cambiar} className="text-right">
                    Atraso
                  </ThOrden>
                  <ThOrden campo="a_tiempo" orden={orden.orden} onOrden={orden.cambiar} className="text-right">
                    A tiempo
                  </ThOrden>
                  <th className="th">Última compra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rankingOrdenado.map((p) => <FilaProveedor key={p.supplier_id} p={p}
                  onVer={() => setProveedor(p.supplier_id)} />)}
              </tbody>
            </TableWrap>
          </Card>
        </>
      )}
    </div>
  )
}

function FilaProveedor({ p, onVer }: { p: ProveedorPagos; onVer: () => void }) {
  return (
    <tr className="hover:bg-slate-50">
      <td className="td">
        <button className="text-left font-medium text-slate-800 hover:text-sea-600 hover:underline"
          onClick={onVer} title="Filtrar por este proveedor">
          <NombreEntidad nombre={p.proveedor} razonSocial={p.razon_social} rut={p.rut} />
        </button>
      </td>
      <td className="td text-right tabular-nums text-slate-500">
        {p.documentos}
        {p.vencidas > 0 && (
          <span className="block text-[11px] text-red-600">{p.vencidas} vencidas</span>
        )}
      </td>
      <td className="td text-right tabular-nums">{money(p.facturado)}</td>
      <td className={clsx('td text-right tabular-nums font-medium',
        p.deuda > 0 ? 'text-amber-700' : 'text-slate-400')}>
        {money(p.deuda)}
        {p.montoVencido > 0 && (
          <span className="block text-[11px] font-normal text-red-600">
            {money(p.montoVencido)} vencido
          </span>
        )}
      </td>
      <td className="td text-right tabular-nums text-slate-500">{dias(p.plazoPonderado)}</td>
      <td className="td text-right tabular-nums font-medium text-navy-900">{dias(p.pagoReal)}</td>
      <td className={clsx('td text-right tabular-nums',
        p.atraso === null ? 'text-slate-300' : p.atraso > 0 ? 'font-medium text-red-600' : 'text-emerald-600')}>
        {dias(p.atraso, true)}
      </td>
      <td className="td text-right tabular-nums text-slate-500">
        {p.pctATiempo === null ? '—' : `${p.pctATiempo}%`}
      </td>
      <td className="td text-slate-500">
        {dateShort(p.ultimaCompra)}
        {p.ultimoPago && (
          <span className="block text-[11px] text-slate-400">pagó {dateShort(p.ultimoPago)}</span>
        )}
      </td>
    </tr>
  )
}
