import { useMemo, useState, type ReactNode } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Hourglass, Info } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { dateShort, money, moneyShort } from '../lib/format'
import { nombreMes, rangoDe, type Periodo } from '../lib/periodo'
import { FiltroPeriodo } from './Filtros'
import { Card, CardHeader, ErrorState, Skeleton } from './ui'

/**
 * CÓMO COBRA Y CÓMO PAGA EL NEGOCIO, EN LA MISMA PANTALLA.
 *
 * Los dos lados ya se medían por separado —Cobranza mira a los clientes,
 * Compras mira a los proveedores— pero nunca juntos, y es al juntarlos donde
 * aparece el número que decide si la caja alcanza: la BRECHA. Si se cobra a 38
 * días y se paga a 13, el negocio está financiando 25 días de operación con
 * plata propia, y esa diferencia por el monto mensual es exactamente el capital
 * de trabajo que hay que tener en el banco.
 *
 * Dos decisiones que hacen que los números no mientan:
 *
 * · Todos los promedios de días van PONDERADOS POR MONTO. Una factura de
 *   $4.000.000 a 60 días amarra la caja más que tres de $100.000 al contado;
 *   el promedio simple las trata igual y devuelve un número tranquilizador.
 *
 * · Del lado de proveedores se separa lo MEDIDO de lo RECONSTRUIDO. La mayoría
 *   de los pagos históricos no se registraron cuando ocurrieron y se cargaron a
 *   plazo fijo (32 días). Promediar eso devuelve el supuesto, no el
 *   comportamiento, así que la brecha se calcula contra los pagos comprobados y
 *   se dice sobre cuántos.
 */

interface LadoPago {
  docs: number
  monto: number
  entidades: number
  dias: number | null
  dias_simple: number | null
  mediana: number | null
  plazo: number | null
  exceso: number | null
  a_tiempo: number
  medibles: number
  peor: number | null
  /** Σ(monto × días). Dividido por los días del período da el capital inmovilizado. */
  peso_dias: number
  /** Solo proveedores: el promedio sobre los pagos con fecha comprobada. */
  dias_medido?: number | null
  estimados?: number
  medidos?: number
  monto_estimado?: number
}

interface Tramos {
  total: number
  docs: number
  por_vencer: number
  t1_15: number
  t16_30: number
  t31_60: number
  t60_mas: number
}

interface PuntoPagos {
  periodo: string
  cobro_dias: number | null
  cobro_monto: number | null
  cobro_docs: number | null
  cobro_a_tiempo: number | null
  cobro_medibles: number | null
  pago_dias: number | null
  pago_dias_medido: number | null
  pago_monto: number | null
  pago_docs: number | null
  pago_a_tiempo: number | null
  pago_medibles: number | null
  pago_estimados: number | null
}

interface EntidadPago {
  id: string
  nombre: string
  docs: number
  monto: number
  dias: number | null
  exceso: number | null
  a_tiempo: number
  medibles: number
  saldo_abierto: number
  vencido: number
  peso_dias: number
  estimados?: number
}

export interface Comportamiento {
  desde: string
  hasta: string
  dias_periodo: number
  grano: string
  clientes: LadoPago
  proveedores: LadoPago
  cartera: { cobrar: Tramos; pagar: Tramos }
  serie: PuntoPagos[]
  morosos: EntidadPago[]
  acreedores: EntidadPago[]
}

type Grano = 'dia' | 'semana' | 'mes'

const num = (v: unknown) => Number(v ?? 0)
const dias = (v: number | null | undefined, signo = false) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  const x = Math.round(Number(v) * 10) / 10
  return `${signo && x > 0 ? '+' : ''}${x.toLocaleString('es-CL', { maximumFractionDigits: 1 })} d`
}
const porcentaje = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : null)

/** El eje del gráfico según la granularidad elegida. */
function etiquetaPeriodo(iso: string, grano: string) {
  if (grano === 'month') return `${nombreMes(iso.slice(0, 7)).slice(0, 3)} ${iso.slice(2, 4)}`
  if (grano === 'week') return `sem ${dateShort(iso).slice(0, 5)}`
  return dateShort(iso).slice(0, 5)
}

export function ComportamientoPagos() {
  // Arranca en el año corrido: el comportamiento de pago se lee en meses, no
  // en días, y con «últimos 30» un solo cliente que atrasó mueve el promedio.
  const [periodo, setPeriodo] = useState<Periodo>(() => rangoDe('anio'))
  const [grano, setGrano] = useState<Grano>('mes')

  const q = useQuery({
    queryKey: ['panel-comportamiento', periodo.desde, periodo.hasta, grano],
    refetchInterval: 300_000,
    // Este tablero trae seis bloques de una vez y es el más caro del panel:
    // vaciarlo entero para cambiar la granularidad se sentía como recargar.
    placeholderData: keepPreviousData,
    staleTime: 300_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('panel_comportamiento_pago', {
        _desde: periodo.desde, _hasta: periodo.hasta, _grano: grano, _limite: 6,
      })
      if (error) throw error
      return data as Comportamiento
    },
  })

  const d = q.data
  const cli = d?.clientes
  const prov = d?.proveedores

  // El pago a proveedores se mide contra lo comprobado. Si no hay ni un pago
  // con fecha real se cae al reconstruido, pero diciéndolo.
  const pagoMedido = (prov?.medidos ?? 0) > 0
  const pagoDias = pagoMedido ? prov?.dias_medido ?? null : prov?.dias ?? null
  const brecha = cli?.dias != null && pagoDias != null
    ? Math.round((Number(cli.dias) - Number(pagoDias)) * 10) / 10
    : null

  const diasPeriodo = Math.max(num(d?.dias_periodo), 1)
  const enLaCalle = cli ? num(cli.peso_dias) / diasPeriodo : 0
  const financiado = prov ? num(prov.peso_dias) / diasPeriodo : 0

  const serie = useMemo(() => (d?.serie ?? []).map((p) => ({
    ...p,
    eje: etiquetaPeriodo(p.periodo, d?.grano ?? 'month'),
    cobrado: p.cobro_monto === null ? null : num(p.cobro_monto),
    pagado: p.pago_monto === null ? null : num(p.pago_monto),
    diasCobro: p.cobro_dias === null ? null : num(p.cobro_dias),
    // Solo se dibuja donde hay pagos con fecha registrada: graficar los
    // reconstruidos pintaría una recta en 32 días que nadie midió.
    diasPago: p.pago_dias_medido === null ? null : num(p.pago_dias_medido),
  })), [d])

  return (
    <Card className="xl:col-span-3">
      <CardHeader
        title="Comportamiento de pago · clientes y proveedores"
        action={
          <Link to="/finanzas" className="text-xs font-medium text-navy-600 hover:underline">
            Análisis completo
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2.5">
        <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
        <select className="input w-auto" value={grano}
          onChange={(e) => setGrano(e.target.value as Grano)}>
          <option value="dia">Por día</option>
          <option value="semana">Por semana</option>
          <option value="mes">Por mes</option>
        </select>
        <span className="text-xs text-slate-400">
          por fecha de pago, no de emisión
        </span>
      </div>

      {q.isError && <div className="p-4"><ErrorState error={q.error} /></div>}
      {q.isLoading && <Skeleton className="m-4 h-96" />}

      {d && cli && prov && (
        <div className={clsx('transition-opacity', q.isPlaceholderData && 'opacity-50')}>
          {/* Los cuatro números que resumen el ciclo de caja. */}
          <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 lg:grid-cols-4">
            <Dato
              label="Días en cobrar"
              valor={dias(cli.dias)}
              tono={cli.exceso != null && Number(cli.exceso) > 5 ? 'malo' : 'normal'}
              icono={<ArrowDownLeft className="h-3.5 w-3.5" />}
              nota={cli.plazo != null
                ? `plazo pactado ${dias(cli.plazo)} · ${dias(cli.exceso, true)} de exceso`
                : undefined}
              pie={`${cli.docs} facturas · ${moneyShort(num(cli.monto))} cobrados`}
            />
            <Dato
              label="Días en pagar"
              valor={dias(pagoDias)}
              icono={<ArrowUpRight className="h-3.5 w-3.5" />}
              nota={prov.plazo != null
                ? `plazo pactado ${dias(prov.plazo)} · ${dias(prov.exceso, true)} de atraso`
                : undefined}
              pie={pagoMedido
                ? `medido sobre ${prov.medidos} de ${prov.docs} pagos comprobados`
                : `sin pagos comprobados: ${prov.docs} reconstruidos a plazo fijo`}
            />
            <Dato
              label="Brecha de caja"
              valor={brecha === null ? '—' : dias(brecha, true)}
              tono={brecha === null ? 'normal' : brecha > 0 ? 'malo' : 'bueno'}
              icono={<Hourglass className="h-3.5 w-3.5" />}
              nota={brecha === null ? 'faltan datos de un lado'
                : brecha > 0 ? 'cobras después de pagar: la financias tú'
                : 'pagas después de cobrar: la financia el proveedor'}
              pie="días de cobro menos días de pago"
            />
            <Dato
              label="Plata en la calle"
              valor={moneyShort(enLaCalle)}
              nota={`el proveedor te financia ${moneyShort(financiado)}`}
              pie={`promedio de los ${diasPeriodo} días del período`}
            />
          </div>

          {/* Evolución: los montos como barras, los días como líneas. */}
          <div className="h-72 p-4">
            {serie.length === 0 ? (
              <p className="flex h-full items-center justify-center text-sm text-slate-400">
                No hubo cobros ni pagos en el período elegido
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                {/* Sin animación a propósito: el trazado animado de la línea
                    se corta a medias cuando llega un refresco y deja la serie
                    convertida en puntos sueltos. */}
                <ComposedChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="eje" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false}
                    axisLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="monto" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false}
                    axisLine={false} tickFormatter={(v) => moneyShort(v as number)} width={55} />
                  <YAxis yAxisId="dias" orientation="right" tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false} axisLine={false} tickFormatter={(v) => `${v} d`} width={45} />
                  <Tooltip
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                    formatter={(v, n) => [
                      String(n).includes('días') ? dias(v as number) : money(v as number), n,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="monto" dataKey="cobrado" name="Cobrado" fill="#1eafa7" isAnimationActive={false}
                    radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Bar yAxisId="monto" dataKey="pagado" name="Pagado" fill="#94a3b8" isAnimationActive={false}
                    radius={[3, 3, 0, 0]} maxBarSize={26} />
                  <Line yAxisId="dias" type="monotone" dataKey="diasCobro" name="días en cobrar"
                    stroke="#0b2545" strokeWidth={2} dot={{ r: 2 }} connectNulls={false}
                    isAnimationActive={false} />
                  <Line yAxisId="dias" type="monotone" dataKey="diasPago" name="días en pagar"
                    stroke="#dc2626" strokeWidth={2} dot={{ r: 2 }} connectNulls={false}
                    isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Antigüedad de la cartera. Es la foto de hoy, no del período. */}
          <div className="grid gap-px border-y border-slate-100 bg-slate-100 lg:grid-cols-2">
            <Antiguedad titulo="Por cobrar hoy" t={d.cartera.cobrar} to="/cobranza" />
            <Antiguedad titulo="Por pagar hoy" t={d.cartera.pagar} to="/finanzas" />
          </div>

          <div className="grid gap-px bg-slate-100 lg:grid-cols-2">
            <Ranking
              titulo="Quién retiene más tu plata"
              ayuda="Ordenados por monto × días de espera, no por días sueltos: una factura chica muy atrasada pesa menos que una grande atrasada poco."
              filas={d.morosos}
              enlace={(e) => `/clientes/${e.id}`}
              periodoDias={diasPeriodo}
            />
            <Ranking
              titulo="A quién le pagas más lento"
              ayuda="Mismo criterio del otro lado: cuánto capital te está financiando cada proveedor."
              filas={d.acreedores}
              enlace={() => '/proveedores'}
              periodoDias={diasPeriodo}
            />
          </div>

          <p className="flex items-start gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span>
              {dateShort(d.desde)} a {dateShort(d.hasta)}. Los promedios van ponderados por monto.
              {(prov.estimados ?? 0) > 0 && (
                <> De los {prov.docs} pagos a proveedores del período,{' '}
                  <strong className="font-medium text-slate-700">{prov.estimados}</strong> se
                  reconstruyeron a plazo fijo en la carga histórica ({moneyShort(num(prov.monto_estimado))}):
                  no se grafican ni entran en la brecha, porque devolverían el supuesto en vez de
                  lo que se pagó.</>
              )}
            </span>
          </p>
        </div>
      )}
    </Card>
  )
}

/** Un número del resumen, con su lectura debajo. */
function Dato({ label, valor, nota, pie, icono, tono = 'normal' }: {
  label: string
  valor: string
  nota?: string
  pie?: string
  icono?: ReactNode
  tono?: 'normal' | 'bueno' | 'malo'
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
        {icono}{label}
      </p>
      <p className={clsx('mt-0.5 text-xl font-semibold tabular-nums',
        tono === 'malo' ? 'text-amber-600' : tono === 'bueno' ? 'text-emerald-600' : 'text-navy-900')}>
        {valor}
      </p>
      {nota && <p className="text-xs text-slate-500">{nota}</p>}
      {pie && <p className="mt-0.5 text-[11px] text-slate-400">{pie}</p>}
    </div>
  )
}

const TRAMOS: { k: keyof Tramos; label: string; color: string; clase: string }[] = [
  { k: 'por_vencer', label: 'Por vencer', color: '#10b981', clase: 'text-emerald-600' },
  { k: 't1_15', label: '1-15 días', color: '#f59e0b', clase: 'text-amber-600' },
  { k: 't16_30', label: '16-30', color: '#f97316', clase: 'text-orange-600' },
  { k: 't31_60', label: '31-60', color: '#ef4444', clase: 'text-red-500' },
  { k: 't60_mas', label: '+60', color: '#991b1b', clase: 'text-red-800' },
]

/**
 * La antigüedad en una sola barra. Cinco montos en una lista obligan a
 * compararlos de memoria; en una barra se ve de una qué parte está vencida.
 */
function Antiguedad({ titulo, t, to }: { titulo: string; t: Tramos; to: string }) {
  const total = num(t?.total)
  // Los tramos pueden venir negativos (notas de crédito sin aplicar): para el
  // ancho se usa el valor absoluto, si no la barra se descuadra.
  const pesos = TRAMOS.map((x) => Math.max(num(t?.[x.k]), 0))
  const suma = pesos.reduce((a, b) => a + b, 0)
  const vencido = pesos.slice(1).reduce((a, b) => a + b, 0)

  return (
    <div className="bg-white px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{titulo}</p>
        <Link to={to} className="text-xs font-medium text-navy-600 hover:underline">
          {t?.docs ?? 0} documentos
        </Link>
      </div>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-navy-900">
        {money(total)}
        {vencido > 0 && (
          <span className="ml-2 text-xs font-medium text-red-600">
            {moneyShort(vencido)} vencido
          </span>
        )}
      </p>

      <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        {suma > 0 && TRAMOS.map((x, i) => pesos[i] > 0 && (
          <div key={x.k} style={{ width: `${(100 * pesos[i]) / suma}%`, background: x.color }}
            title={`${x.label}: ${money(pesos[i])}`} />
        ))}
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
        {TRAMOS.map((x, i) => pesos[i] > 0 && (
          <span key={x.k} className="flex items-center gap-1 text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ background: x.color }} />
            {x.label} <span className={clsx('tabular-nums', x.clase)}>{moneyShort(pesos[i])}</span>
          </span>
        ))}
        {suma === 0 && <span className="text-slate-400">Sin saldo pendiente</span>}
      </div>
      {num(t?.por_vencer) < 0 && (
        <p className="mt-1 text-[11px] text-slate-400">
          El total descuenta {moneyShort(Math.abs(num(t?.por_vencer)))} de notas de crédito
          todavía sin aplicar, por eso queda bajo lo vencido.
        </p>
      )}
    </div>
  )
}

/** Los seis que más capital inmovilizan, con su cumplimiento y su deuda de hoy. */
function Ranking({ titulo, ayuda, filas, enlace, periodoDias }: {
  titulo: string
  ayuda: string
  filas: EntidadPago[]
  enlace: (e: EntidadPago) => string
  periodoDias: number
}) {
  return (
    <div className="bg-white">
      <div className="px-4 pt-3 pb-1">
        <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{titulo}</p>
        <p className="mt-0.5 text-[11px] text-slate-400">{ayuda}</p>
      </div>
      <div className="divide-y divide-slate-50">
        {filas.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-400">Sin movimientos en el período</p>
        )}
        {filas.map((e) => {
          const pctATiempo = porcentaje(e.a_tiempo, e.medibles)
          return (
            <Link key={e.id} to={enlace(e)}
              className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-800">{e.nombre}</p>
                <p className="text-xs text-slate-400">
                  {e.docs} doc. · {moneyShort(num(e.monto))}
                  {pctATiempo !== null && ` · ${pctATiempo}% a tiempo`}
                  {(e.estimados ?? 0) > 0 && ` · ${e.estimados} reconstruidos`}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-medium tabular-nums text-slate-700">{dias(e.dias)}</p>
                {/* La plata que en promedio tuvo retenida durante el período. */}
                <p className="text-[11px] text-slate-400">
                  {moneyShort(num(e.peso_dias) / Math.max(periodoDias, 1))} retenidos
                </p>
              </div>
              {num(e.vencido) > 0 && (
                <span className="badge bg-red-100 text-red-700">{moneyShort(num(e.vencido))}</span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
