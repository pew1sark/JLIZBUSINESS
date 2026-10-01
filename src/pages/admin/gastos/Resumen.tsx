import { useMemo } from 'react'
import clsx from 'clsx'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Pencil } from 'lucide-react'
import { dateShort, money, moneyShort } from '../../../lib/format'
import { type Periodo } from '../../../lib/periodo'
import {
  COLOR_GRUPO, FRANJAS, NOMBRE_GRUPO, TIPO_ABONO_LABEL, franjaHoraria, hoyIso, mesesDelPeriodo,
  type Abono, type ClaveGrupo, type GastoManual, type TipoAbono, type Trabajador,
} from '../../../lib/gastos'
import { Card, CardHeader, EmptyState, Skeleton, StatCard, TableWrap } from '../../../components/ui'
import { useAbonos, useGastosFacturas, useGastosManuales } from './datos'

const GRUPOS: ClaveGrupo[] = ['sueldos', 'fijo', 'variable', 'insumos', 'facturas']
const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']

const tooltipStyle = { fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }

/** Últimos 12 meses que terminan en el mes de `hasta`, como 'YYYY-MM'. */
function doceMeses(hasta: string): string[] {
  const [a, m] = hasta.split('-').map(Number)
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(a, m - 12 + i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

export function Resumen({ periodo, trabajadores, abonos, gastos, facturas, cargando, onEditarGasto, onIr }: {
  periodo: Periodo
  trabajadores: Trabajador[]
  abonos: Abono[]
  gastos: GastoManual[]
  facturas: { fecha: string; categoria: string; monto: number }[]
  cargando: boolean
  onEditarGasto: (g: GastoManual) => void
  onIr: (pestana: 'sueldos' | 'fijos' | 'caja' | 'facturas') => void
}) {
  // ---- totales del período
  const totales = useMemo(() => {
    const t: Record<ClaveGrupo, number> = { sueldos: 0, fijo: 0, variable: 0, insumos: 0, facturas: 0 }
    for (const a of abonos) t.sueldos += Number(a.monto)
    for (const g of gastos) t[g.grupo] += Number(g.monto)
    for (const f of facturas) t.facturas += Number(f.monto)
    return t
  }, [abonos, gastos, facturas])
  const total = GRUPOS.reduce((n, g) => n + totales[g], 0)
  const meses = mesesDelPeriodo(periodo, abonos)

  // ---- serie de 12 meses (consulta propia: no depende del filtro de período)
  const fin = periodo.hasta ?? hoyIso()
  const lista12 = useMemo(() => doceMeses(fin), [fin])
  const desde12 = `${lista12[0]}-01`
  const abonos12 = useAbonos(desde12, fin)
  const gastos12 = useGastosManuales(desde12, fin)
  const facturas12 = useGastosFacturas(desde12, fin)
  const serie = useMemo(() => {
    const filas = new Map(lista12.map((m) => [m, {
      mes: m, etiqueta: `${MES_CORTO[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`,
      sueldos: 0, fijo: 0, variable: 0, insumos: 0, facturas: 0,
    }]))
    for (const a of abonos12.data ?? []) { const f = filas.get(a.periodo.slice(0, 7)); if (f) f.sueldos += Number(a.monto) }
    for (const g of gastos12.data ?? []) { const f = filas.get(g.fecha.slice(0, 7)); if (f) f[g.grupo] += Number(g.monto) }
    for (const x of facturas12.data ?? []) { const f = filas.get(x.fecha.slice(0, 7)); if (f) f.facturas += Number(x.monto) }
    return [...filas.values()]
  }, [abonos12.data, gastos12.data, facturas12.data, lista12])
  const serieVacia = serie.every((f) => GRUPOS.every((g) => f[g] === 0))

  // ---- ranking de categorías (manuales + facturas + sueldos por tipo)
  const ranking = useMemo(() => {
    const m = new Map<string, { grupo: ClaveGrupo; monto: number }>()
    const sumar = (k: string, grupo: ClaveGrupo, v: number) => {
      const x = m.get(`${grupo}|${k}`) ?? { grupo, monto: 0 }
      x.monto += v; m.set(`${grupo}|${k}`, x)
    }
    for (const a of abonos) sumar(TIPO_ABONO_LABEL[a.tipo], 'sueldos', Number(a.monto))
    for (const g of gastos) sumar(g.categoria, g.grupo, Number(g.monto))
    for (const f of facturas) sumar(f.categoria, 'facturas', Number(f.monto))
    return [...m.entries()].map(([k, v]) => ({ nombre: k.split('|')[1], ...v }))
      .sort((a, b) => b.monto - a.monto)
  }, [abonos, gastos, facturas])
  const maxRank = ranking[0]?.monto ?? 1

  // ---- costo por trabajador
  const porTrabajador = useMemo(() => trabajadores
    .filter((t) => t.activo || abonos.some((a) => a.trabajador_id === t.id))
    .map((t) => {
      const lista = abonos.filter((a) => a.trabajador_id === t.id)
      const de = (tipos: TipoAbono[]) => lista.filter((a) => tipos.includes(a.tipo)).reduce((n, a) => n + Number(a.monto), 0)
      return {
        t, pactado: Number(t.sueldo_base) * meses,
        quincena: de(['quincena']), final: de(['sueldo_final']), cotiz: de(['cotizaciones']),
        otros: de(['anticipo', 'bono', 'otro']), anticipo: de(['anticipo']), total: de(['quincena', 'sueldo_final', 'cotizaciones', 'anticipo', 'bono', 'otro']),
      }
    }), [trabajadores, abonos, meses])

  // ---- caja chica por día de la semana y franja horaria
  const caja = gastos.filter((g) => g.grupo === 'insumos')
  const matriz = useMemo(() => {
    const m = DIAS.map(() => FRANJAS.map(() => 0))
    for (const g of caja) {
      const [a, mm, d] = g.fecha.split('-').map(Number)
      const dia = (new Date(a, mm - 1, d).getDay() + 6) % 7
      m[dia][FRANJAS.indexOf(franjaHoraria(g.hora))] += Number(g.monto)
    }
    return m
  }, [caja])
  const maxCelda = Math.max(1, ...matriz.flat())
  const franjasConDatos = FRANJAS.filter((_, j) => j < 4 || matriz.some((fila) => fila[j] > 0))

  const recientes = [...gastos].sort((a, b) =>
    `${b.fecha} ${b.hora ?? ''}`.localeCompare(`${a.fecha} ${a.hora ?? ''}`)).slice(0, 8)
  const nombre = (id: string | null) => trabajadores.find((t) => t.id === id)?.nombre ?? ''

  if (cargando) return <Skeleton className="h-96" />

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Gasto total" value={moneyShort(total)} hint="todo lo que salió en el período" />
        <StatCard label="Sueldos" value={moneyShort(totales.sueldos)} onClick={() => onIr('sueldos')}
          hint={total ? `${Math.round((totales.sueldos / total) * 100)}% del gasto` : '—'} />
        <StatCard label="Fijos" value={moneyShort(totales.fijo)} onClick={() => onIr('fijos')}
          hint="autopista, seguros…" />
        <StatCard label="Variables" value={moneyShort(totales.variable)} onClick={() => onIr('fijos')}
          hint="lavado, arreglos…" />
        <StatCard label="Insumos y caja chica" value={moneyShort(totales.insumos)} onClick={() => onIr('caja')}
          hint={`${caja.length} salidas de caja`} />
        <StatCard label="Facturas proveedores" value={moneyShort(totales.facturas)} onClick={() => onIr('facturas')}
          hint="combustible, servicios… (Bsale)" />
      </div>

      {total > 0 && (
        <Card className="mt-4 p-4">
          <p className="mb-2 text-sm font-semibold text-slate-700">En qué se va la plata</p>
          <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
            {GRUPOS.filter((g) => totales[g] > 0).map((g) => (
              <div key={g} title={`${NOMBRE_GRUPO[g]}: ${money(totales[g])}`}
                style={{ width: `${(totales[g] / total) * 100}%`, background: COLOR_GRUPO[g] }} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
            {GRUPOS.map((g) => (
              <span key={g} className="inline-flex items-center gap-1.5 text-slate-600">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: COLOR_GRUPO[g] }} />
                {NOMBRE_GRUPO[g]}
                <span className="font-medium tabular-nums text-slate-900">{money(totales[g])}</span>
                <span className="text-xs text-slate-400">{total ? `${Math.round((totales[g] / total) * 100)}%` : ''}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Gasto por mes · últimos 12 meses" />
          <div className="h-80 p-4">
            {abonos12.isLoading || gastos12.isLoading ? <Skeleton className="h-full w-full" />
              : serieVacia ? <EmptyState title="Todavía no hay gastos cargados" hint="Empieza por los sueldos y la caja chica del mes." />
              : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serie} barCategoryGap="25%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false}
                      tickFormatter={(v) => moneyShort(v as number)} width={55} />
                    <Tooltip formatter={(v, n) => [money(v as number), n]} contentStyle={tooltipStyle}
                      cursor={{ fill: '#f1f5f9' }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {GRUPOS.map((g, i) => (
                      <Bar key={g} dataKey={g} name={NOMBRE_GRUPO[g]} stackId="a" fill={COLOR_GRUPO[g]}
                        stroke="#fff" strokeWidth={1} isAnimationActive={false}
                        radius={i === GRUPOS.length - 1 ? [4, 4, 0, 0] : undefined} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Categorías que más pesan" />
          <div className="space-y-2.5 p-4">
            {ranking.length === 0 && <p className="text-sm text-slate-400">Sin gastos en el período.</p>}
            {ranking.slice(0, 12).map((r) => (
              <div key={`${r.grupo}${r.nombre}`} title={`${NOMBRE_GRUPO[r.grupo]} · ${money(r.monto)}`}>
                <div className="flex justify-between gap-2 text-sm">
                  <span className="truncate text-slate-600">{r.nombre}</span>
                  <span className="shrink-0 tabular-nums font-medium">{moneyShort(r.monto)}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                  <div className="h-full rounded-full" style={{ width: `${(r.monto / maxRank) * 100}%`, background: COLOR_GRUPO[r.grupo] }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <h2 className="mt-6 mb-2 text-sm font-semibold text-slate-700">Costo por trabajador</h2>
      <TableWrap>
        <thead className="bg-slate-50">
          <tr>
            <th className="th">Trabajador</th>
            <th className="th text-right">Pactado</th>
            <th className="th text-right">Quincenas</th>
            <th className="th text-right">Sueldo final</th>
            <th className="th text-right">Cotizaciones</th>
            <th className="th text-right">Otros</th>
            <th className="th text-right">Total</th>
            <th className="th text-right">Falta</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {porTrabajador.map(({ t, pactado, quincena, final, cotiz, otros, anticipo, total: tt }) => {
            const falta = Math.max(0, pactado - quincena - final - anticipo)
            return (
              <tr key={t.id} className="cursor-pointer hover:bg-slate-50" onClick={() => onIr('sueldos')}>
                <td className="td">
                  <p className="font-medium text-slate-800">{t.nombre}</p>
                  {t.cargo && <p className="text-xs text-slate-400">{t.cargo}</p>}
                </td>
                <td className="td text-right tabular-nums text-slate-500">{pactado ? money(pactado) : '—'}</td>
                <td className="td text-right tabular-nums">{money(quincena)}</td>
                <td className="td text-right tabular-nums">{money(final)}</td>
                <td className="td text-right tabular-nums">{money(cotiz)}</td>
                <td className="td text-right tabular-nums">{money(otros)}</td>
                <td className="td text-right font-semibold tabular-nums">{money(tt)}</td>
                <td className={clsx('td text-right tabular-nums', falta > 0 ? 'text-amber-600' : 'text-slate-300')}>
                  {pactado ? money(falta) : '—'}
                </td>
              </tr>
            )
          })}
          <tr className="bg-slate-50 font-semibold">
            <td className="td">Total planilla</td>
            <td className="td text-right tabular-nums">{money(porTrabajador.reduce((n, r) => n + r.pactado, 0))}</td>
            <td className="td text-right tabular-nums">{money(porTrabajador.reduce((n, r) => n + r.quincena, 0))}</td>
            <td className="td text-right tabular-nums">{money(porTrabajador.reduce((n, r) => n + r.final, 0))}</td>
            <td className="td text-right tabular-nums">{money(porTrabajador.reduce((n, r) => n + r.cotiz, 0))}</td>
            <td className="td text-right tabular-nums">{money(porTrabajador.reduce((n, r) => n + r.otros, 0))}</td>
            <td className="td text-right tabular-nums">{money(porTrabajador.reduce((n, r) => n + r.total, 0))}</td>
            <td className="td" />
          </tr>
        </tbody>
      </TableWrap>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Caja chica por día y horario" />
          {caja.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">Sin salidas de caja en el período.</p>
          ) : (
            <div className="overflow-x-auto p-4">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th />
                    {franjasConDatos.map((f) => (
                      <th key={f} className="px-1 pb-2 text-center font-medium text-slate-500">{f.replace(/ \(.*\)/, '')}</th>
                    ))}
                    <th className="px-1 pb-2 text-right font-medium text-slate-500">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {DIAS.map((d, i) => (
                    <tr key={d}>
                      <td className="py-0.5 pr-2 text-slate-500">{d}</td>
                      {franjasConDatos.map((f) => {
                        const v = matriz[i][FRANJAS.indexOf(f)]
                        return (
                          <td key={f} className="p-0.5">
                            <div title={`${d} · ${f}: ${money(v)}`}
                              className={clsx('rounded px-1 py-1.5 text-center tabular-nums', v > maxCelda * 0.5 ? 'text-white' : 'text-slate-600')}
                              style={{ background: v ? `rgba(237,161,0,${0.15 + 0.85 * (v / maxCelda)})` : '#f8fafc' }}>
                              {v ? moneyShort(v) : ''}
                            </div>
                          </td>
                        )
                      })}
                      <td className="py-0.5 pl-2 text-right font-medium tabular-nums">{moneyShort(matriz[i].reduce((n, v) => n + v, 0))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-400">
                Más oscuro, más gasto. Sirve para ver qué días y a qué hora sale la plata de la caja (madrugada = terminal pesquero).
              </p>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Últimos gastos ingresados" />
          {recientes.length === 0 ? (
            <p className="p-4 text-sm text-slate-400">Sin gastos manuales en el período.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {recientes.map((g) => (
                <li key={g.id}>
                  <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                    onClick={() => onEditarGasto(g)}>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR_GRUPO[g.grupo] }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-700">{g.categoria}{g.detalle ? ` · ${g.detalle}` : ''}</span>
                      <span className="block text-xs text-slate-400">
                        {dateShort(g.fecha)}{g.hora ? ` ${g.hora.slice(0, 5)}` : ''}{g.trabajador_id ? ` · ${nombre(g.trabajador_id)}` : ''}
                      </span>
                    </span>
                    <span className="tabular-nums font-medium">{money(g.monto)}</span>
                    <Pencil className="h-3.5 w-3.5 text-slate-300" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Los sueldos se cuentan en el mes al que corresponden, no en el día en que se pagaron: el sueldo de
        septiembre pagado el 5 de octubre es gasto de septiembre.
      </p>
    </>
  )
}
