import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { FileText, TrendingUp, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { descargarCsv } from '../../lib/csv'
import { dateShort, money, moneyShort, pct } from '../../lib/format'
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, TableWrap } from '../../components/ui'

interface Mes {
  mes: string
  documentos: number
  proveedores: number
  compras: number
  notas_credito: number
  compra_neta: number
  promedio_documento: number
}

interface Proveedor {
  rut: string
  razon_social: string
  supplier_id: string | null
  documentos: number
  compras: number
  notas_credito: number
  participacion_pct: number
  primera_compra: string
  ultima_compra: string
  promedio_documento: number
}

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

export function Historico() {
  const meses = useQuery({
    queryKey: ['historico-mensual'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_historico_mensual').select('*').order('mes')
      if (error) throw error
      return data as Mes[]
    },
  })

  const proveedores = useQuery({
    queryKey: ['historico-proveedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_historico_proveedores').select('*').order('compras', { ascending: false })
      if (error) throw error
      return data as Proveedor[]
    },
  })

  const serie = useMemo(
    () =>
      (meses.data ?? []).map((m) => {
        const d = new Date(m.mes)
        return {
          etiqueta: `${MES_CORTO[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
          compras: Number(m.compras),
          documentos: m.documentos,
        }
      }),
    [meses.data],
  )

  const totales = useMemo(() => {
    const m = meses.data ?? []
    const compras = m.reduce((n, x) => n + Number(x.compras), 0)
    const nc = m.reduce((n, x) => n + Number(x.notas_credito), 0)
    const docs = m.reduce((n, x) => n + x.documentos, 0)
    // El primer mes suele venir incompleto: se excluye del promedio
    const completos = m.slice(1)
    const promedioMes = completos.length
      ? completos.reduce((n, x) => n + Number(x.compras), 0) / completos.length
      : 0
    return { compras, nc, docs, promedioMes, mesesCompletos: completos.length }
  }, [meses.data])

  const pareto = useMemo(() => {
    const p = proveedores.data ?? []
    let acum = 0
    let hasta80 = 0
    for (const x of p) {
      acum += Number(x.participacion_pct)
      hasta80 += 1
      if (acum >= 80) break
    }
    return { hasta80, total: p.length }
  }, [proveedores.data])

  function exportar() {
    const filas: (string | number)[][] = [[
      'RUT', 'Razón social', 'Documentos', 'Compras', 'Notas de crédito',
      'Participación %', 'Primera compra', 'Última compra', 'Promedio por documento',
    ]]
    for (const p of proveedores.data ?? []) {
      filas.push([p.rut, p.razon_social, p.documentos, p.compras, p.notas_credito,
        p.participacion_pct, p.primera_compra, p.ultima_compra, p.promedio_documento])
    }
    descargarCsv(filas, 'historico-proveedores')
  }

  const sinDatos = !meses.isLoading && (meses.data ?? []).length === 0

  return (
    <>
      <PageHeader
        title="Histórico de compras"
        subtitle="Registro tributario importado · análisis de proveedores y estacionalidad"
        actions={
          <button onClick={exportar} className="btn-secondary" disabled={sinDatos}>
            Exportar proveedores
          </button>
        }
      />

      {meses.isError && <ErrorState error={meses.error} />}
      {meses.isLoading && <Skeleton className="h-24" />}
      {sinDatos && (
        <Card>
          <EmptyState
            title="Sin histórico cargado"
            hint="Acá se muestra el registro de compras importado desde el SII o desde Bsale."
            icon={<FileText className="h-8 w-8" />}
          />
        </Card>
      )}

      {!sinDatos && !meses.isLoading && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label="Compra del período" value={moneyShort(totales.compras)} hint={`${totales.docs} documentos`} icon={<TrendingUp className="h-4 w-4" />} />
            <StatCard label="Promedio mensual" value={moneyShort(totales.promedioMes)} hint={`${totales.mesesCompletos} meses completos`} />
            <StatCard label="Proveedores" value={String(pareto.total)} icon={<Users className="h-4 w-4" />} />
            <StatCard label="Concentración" value={`${pareto.hasta80}`} hint="proveedores hacen el 80% de la compra" tone="warning" />
            <StatCard label="Notas de crédito" value={moneyShort(Math.abs(totales.nc))} hint={totales.compras > 0 ? pct(Math.round(Math.abs(totales.nc) / totales.compras * 1000) / 10) : '—'} />
          </div>

          <Card className="mt-4">
            <CardHeader title="Compra por mes" />
            <div className="h-72 p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="etiqueta" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v) => moneyShort(v as number)} width={55} />
                  <Tooltip
                    formatter={(v) => money(v as number)}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="compras" name="Compras" radius={[4, 4, 0, 0]}>
                    {serie.map((s, i) => {
                      const maxV = Math.max(...serie.map((x) => x.compras))
                      const minV = Math.min(...serie.slice(1).map((x) => x.compras))
                      return (
                        <Cell
                          key={i}
                          fill={s.compras === maxV ? '#0b2545' : s.compras === minV && i > 0 ? '#f59e0b' : '#5b88bd'}
                        />
                      )
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="px-5 pb-4 text-xs text-slate-500">
              En azul oscuro el mes de mayor compra, en ámbar el más bajo. El primer mes de la serie
              puede venir incompleto según desde cuándo se exportó el registro.
            </p>
          </Card>

          <Card className="mt-4">
            <CardHeader
              title="Proveedores"
              action={<span className="text-xs text-slate-500">{pareto.total} en total</span>}
            />
            <div className="overflow-x-auto">
              <TableWrap>
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th">Proveedor</th>
                    <th className="th">Documentos</th>
                    <th className="th">Compra</th>
                    <th className="th">Participación</th>
                    <th className="th">Promedio doc.</th>
                    <th className="th">Última compra</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {proveedores.data?.slice(0, 25).map((p) => (
                    <tr key={p.rut} className="hover:bg-slate-50">
                      <td className="td">
                        <p className="font-medium text-slate-900">{p.razon_social}</p>
                        <p className="font-mono text-xs text-slate-400">{p.rut}</p>
                      </td>
                      <td className="td text-slate-500">{p.documentos}</td>
                      <td className="td tabular-nums font-medium">{money(p.compras)}</td>
                      <td className="td">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                            <div className="h-full bg-navy-700" style={{ width: `${Math.min(Number(p.participacion_pct) * 4, 100)}%` }} />
                          </div>
                          <span className="text-xs tabular-nums text-slate-600">{pct(p.participacion_pct)}</span>
                        </div>
                      </td>
                      <td className="td tabular-nums text-slate-500">{moneyShort(p.promedio_documento)}</td>
                      <td className="td text-xs text-slate-500">{dateShort(p.ultima_compra)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </Card>

          <Card className="mt-4 p-4 text-xs text-slate-500">
            Este histórico viene del registro tributario, que registra documentos y montos pero no
            productos ni kilos. Sirve para analizar proveedores, volumen y estacionalidad, pero no
            para calcular costo por kilo ni márgenes: esos se construyen con las compras que se
            registren en el sistema de aquí en adelante.
          </Card>
        </>
      )}
    </>
  )
}
