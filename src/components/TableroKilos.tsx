import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { Link } from 'react-router-dom'
import { Scale, TrendingDown, TrendingUp } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { dateShort, kg, money, moneyShort } from '../lib/format'
import { Card, CardHeader, ErrorState, Skeleton } from './ui'
import type { Periodo } from '../lib/periodo'

/**
 * QUÉ SE VENDE MÁS, EN KILOS.
 *
 * El panel ya rankeaba productos por facturación, que responde otra pregunta.
 * Un filete de corvina a $16.781 el kilo sube el ranking con la mitad de la
 * mercadería que un pescado entero a $9.433, así que el ranking por plata dice
 * qué deja más margen, no qué se está moviendo. Para comprar en la caleta,
 * para negociar el precio con el proveedor y para saber qué tiene que haber en
 * cámara mañana, la unidad es el kilo.
 *
 * Los kilos salen del detalle de línea de las facturas, que no todas traen: por
 * eso el pie dice qué parte de la venta del período está representada. Un
 * ranking armado con la mitad de los documentos, sin decirlo, se lee como si
 * fuera el negocio entero.
 */

export interface ProductoKilos {
  producto: string
  kilos: number
  venta: number
  precio_kilo: number | null
  documentos: number
  clientes: number
  /** Qué parte de los kilos del período es este producto. */
  participacion: number | null
  kilos_previos: number | null
  /** Variación porcentual contra el mismo largo de período, justo antes. */
  variacion: number | null
}

export interface PanelKilos {
  desde: string
  hasta: string
  previo_desde: string
  previo_hasta: string
  /** false = la ventana anterior cae antes del corte de análisis y no se puede comparar. */
  previo_completo: boolean
  kilos: number
  venta: number
  productos: number
  kilos_previos: number
  documentos: number
  con_detalle: number
  ranking: ProductoKilos[]
}

const n = (v: unknown) => Number(v ?? 0)

export function TableroKilos({ periodo, cliente }: { periodo: Periodo; cliente: string }) {
  const q = useQuery({
    queryKey: ['panel-kilos', periodo.desde, periodo.hasta, cliente],
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('panel_kilos', {
        _desde: periodo.desde,
        _hasta: periodo.hasta,
        _customer_id: cliente || null,
        _limite: 8,
      })
      if (error) throw error
      return data as PanelKilos
    },
  })

  const d = q.data
  const ranking = (d?.ranking ?? []).map((p) => ({
    ...p,
    kilos: n(p.kilos),
    venta: n(p.venta),
  }))
  const lider = ranking[0]

  const variacionTotal = d && d.previo_completo && n(d.kilos_previos) > 0
    ? Math.round(((n(d.kilos) - n(d.kilos_previos)) / n(d.kilos_previos)) * 1000) / 10
    : null

  const cobertura = d && d.documentos > 0
    ? Math.round((100 * d.con_detalle) / d.documentos)
    : 100

  return (
    <Card className="xl:col-span-2">
      <CardHeader
        title="Kilos vendidos por producto"
        action={
          <Link to="/reportes" className="text-xs font-medium text-navy-600 hover:underline">
            Informe por producto
          </Link>
        }
      />

      {q.isError && <div className="p-4"><ErrorState error={q.error} /></div>}

      {q.isLoading && <Skeleton className="m-4 h-80" />}

      {d && ranking.length === 0 && (
        <p className="px-4 py-16 text-center text-sm text-slate-400">
          Ninguna factura del período trae el detalle de líneas, así que no hay kilos que contar.
        </p>
      )}

      {d && !!ranking.length && (
        <>
          {/* El producto que manda, en grande: es la respuesta a la pregunta. */}
          <div className="grid grid-cols-2 gap-px border-b border-slate-100 bg-slate-100 sm:grid-cols-4">
            <div className="bg-white px-4 py-3 sm:col-span-2">
              <p className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-slate-400 uppercase">
                <Scale className="h-3.5 w-3.5" /> Más vendido en kilos
              </p>
              <p className="mt-0.5 truncate text-base font-semibold text-navy-900">{lider.producto}</p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-slate-600">
                <span className="text-xl font-semibold tabular-nums text-navy-900">{kg(lider.kilos)}</span>
                {lider.participacion !== null && (
                  <span className="text-xs text-slate-400">{lider.participacion}% de los kilos</span>
                )}
                <Variacion valor={d.previo_completo ? lider.variacion : null} />
              </p>
              <p className="mt-0.5 text-xs text-slate-400">
                {money(lider.venta)} · {lider.precio_kilo ? `${money(lider.precio_kilo)}/kg` : '—'} ·{' '}
                {lider.clientes} cliente{lider.clientes === 1 ? '' : 's'}
              </p>
            </div>

            <DatoKilos
              label="Kilos del período"
              valor={kg(n(d.kilos))}
              nota={`${d.productos} producto${d.productos === 1 ? '' : 's'} distintos`}
              extra={<Variacion valor={variacionTotal} />}
            />
            <DatoKilos
              label="Precio promedio"
              valor={n(d.kilos) > 0 ? `${money(n(d.venta) / n(d.kilos))}/kg` : '—'}
              nota={`${moneyShort(n(d.venta))} facturados`}
            />
          </div>

          <div className="h-72 p-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ranking} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false}
                  axisLine={false} tickFormatter={(v) => `${v} kg`} />
                <YAxis type="category" dataKey="producto" tick={{ fontSize: 11, fill: '#64748b' }}
                  tickLine={false} axisLine={false} width={110} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={(v, _n, p) => [
                    `${kg(v as number)} · ${money(p.payload.venta)}`
                    + `${p.payload.precio_kilo ? ` · ${money(p.payload.precio_kilo)}/kg` : ''}`
                    + ` · ${p.payload.documentos} doc.`,
                    'Vendido',
                  ]}
                />
                {/* El primero en el azul oscuro de la marca: en un gráfico de
                    ocho barras iguales hay que contar para saber cuál gana.

                    Sin animación: el panel se refresca solo, y si el dato llega
                    mientras la barra está creciendo, Recharts la deja congelada
                    a los pocos píxeles y el gráfico aparece vacío. */}
                <Bar dataKey="kilos" name="Kilos" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                  {ranking.map((_, i) => (
                    <Cell key={i} fill={i === 0 ? '#0b2545' : '#5b88bd'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
            {cobertura >= 100
              ? `Las ${d.documentos} facturas del período traen detalle de líneas.`
              : `Contado sobre ${d.con_detalle} de ${d.documentos} facturas del período (${cobertura}%): las que no traen detalle de líneas no suman kilos.`}
            {d.previo_completo
              ? ` Se compara contra ${dateShort(d.previo_desde)}–${dateShort(d.previo_hasta)}.`
              : ' No hay período anterior completo con que comparar.'}
            {' '}Las notas de crédito descuentan kilos.
          </p>
        </>
      )}
    </Card>
  )
}

/** Un número del encabezado del tablero. */
function DatoKilos({ label, valor, nota, extra }: {
  label: string; valor: string; nota?: string; extra?: ReactNode
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-[11px] font-medium tracking-wide text-slate-400 uppercase">{label}</p>
      {/* La unidad no se separa del número: en el teléfono «4.835,9 kg» se
          partía y el «kg» quedaba solo en la línea siguiente. */}
      <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-base font-semibold tabular-nums text-navy-900">
        <span className="whitespace-nowrap">{valor}</span>{extra}
      </p>
      {nota && <p className="text-xs text-slate-400">{nota}</p>}
    </div>
  )
}

/** ±% contra el período anterior. Sin dato no se dibuja nada, en vez de un 0%. */
function Variacion({ valor }: { valor: number | null }) {
  if (valor === null || !Number.isFinite(valor)) return null
  const sube = valor >= 0
  const Icono = sube ? TrendingUp : TrendingDown
  return (
    <span className={clsx('inline-flex items-center gap-0.5 text-xs font-medium',
      sube ? 'text-emerald-600' : 'text-red-600')}>
      <Icono className="h-3 w-3" />
      {sube ? '+' : ''}{valor}%
    </span>
  )
}
