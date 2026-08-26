import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, Fuel, Receipt, Search, TrendingDown } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import { dateShort, money, moneyShort } from '../../lib/format'
import { descargarCsv } from '../../lib/csv'
import { FiltroPeriodo, Paginador } from '../../components/Filtros'
import { rangoDe, type Periodo } from '../../lib/periodo'
import { PAYMENT_STATUS_LABEL, PAYMENT_STATUS_STYLE } from '../../lib/constants'
import type { PaymentStatus } from '../../lib/types'
import { Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, TableWrap } from '../../components/ui'

interface Gasto {
  bsale_document_id: number
  line_no: number
  purchase_id: string
  compra: string
  fecha: string
  invoice_number: string | null
  document_url: string | null
  supplier_id: string | null
  proveedor: string | null
  proveedor_rut: string | null
  detalle: string
  quantity: number | null
  unit: string | null
  unit_price: number | null
  monto: number
  payment_status: PaymentStatus
  categoria: string
}

const COLOR: Record<string, string> = {
  'Combustible': 'bg-orange-100 text-orange-800',
  'Peajes': 'bg-sky-100 text-sky-800',
  'Servicios y software': 'bg-violet-100 text-violet-800',
  'Banco y comisiones': 'bg-slate-200 text-slate-700',
  'Contabilidad y asesorías': 'bg-indigo-100 text-indigo-800',
  'Vehículos y mantención': 'bg-amber-100 text-amber-800',
  'Insumos y ferretería': 'bg-emerald-100 text-emerald-800',
  'Otros gastos': 'bg-slate-100 text-slate-600',
}

export function Gastos() {
  const [periodo, setPeriodo] = useState<Periodo>(() => rangoDe('mes'))
  const [buscar, setBuscar] = useState('')
  const [categoria, setCategoria] = useState('todas')
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState(50)

  const gastos = useQuery({
    queryKey: ['gastos', periodo.desde, periodo.hasta],
    queryFn: async () => {
      let q = supabase.from('v_gastos_operacionales').select('*')
        .order('fecha', { ascending: false }).limit(3000)
      if (periodo.desde) q = q.gte('fecha', periodo.desde)
      if (periodo.hasta) q = q.lte('fecha', periodo.hasta)
      const { data, error } = await q
      if (error) throw error
      return data as Gasto[]
    },
  })

  const categorias = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of gastos.data ?? []) m.set(g.categoria, (m.get(g.categoria) ?? 0) + Number(g.monto))
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [gastos.data])

  const filtrados = useMemo(() => {
    const t = buscar.trim().toLowerCase()
    return (gastos.data ?? []).filter((g) => {
      if (categoria !== 'todas' && g.categoria !== categoria) return false
      if (!t) return true
      return g.detalle.toLowerCase().includes(t)
        || (g.proveedor ?? '').toLowerCase().includes(t)
        || (g.proveedor_rut ?? '').toLowerCase().includes(t)
        || (g.invoice_number ?? '').toLowerCase().includes(t)
        || g.categoria.toLowerCase().includes(t)
    })
  }, [gastos.data, buscar, categoria])

  useEffect(() => { setPagina(0) }, [periodo.desde, periodo.hasta, buscar, categoria])

  const pagina_ = useMemo(
    () => filtrados.slice(pagina * porPagina, (pagina + 1) * porPagina),
    [filtrados, pagina, porPagina],
  )

  const total = filtrados.reduce((n, g) => n + Number(g.monto), 0)
  const porPagar = filtrados.filter((g) => g.payment_status !== 'pagado')
    .reduce((n, g) => n + Number(g.monto), 0)
  const proveedores = new Set(filtrados.map((g) => g.proveedor)).size

  function exportar() {
    const filas: (string | number)[][] = [[
      'Fecha', 'Categoría', 'Proveedor', 'RUT', 'Detalle', 'Cantidad', 'Unidad',
      'Precio unitario', 'Monto', 'Compra', 'Factura', 'Pago',
    ]]
    for (const g of filtrados) {
      filas.push([g.fecha, g.categoria, g.proveedor ?? '', g.proveedor_rut ?? '', g.detalle,
        g.quantity ?? '', g.unit ?? '', g.unit_price ?? '', g.monto, g.compra,
        g.invoice_number ?? '', g.payment_status])
    }
    descargarCsv(filas, `gastos-${periodo.desde ?? 'todo'}`)
  }

  return (
    <>
      <PageHeader
        title="Gastos operacionales"
        subtitle="Todo lo que no es mercadería: combustible, peajes, servicios, banco e insumos"
        actions={
          <>
            <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
            <button onClick={exportar} className="btn-secondary">
              <Download className="h-4 w-4" /> CSV
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Gasto del período" value={moneyShort(total)}
          hint={`${filtrados.length} líneas`} icon={<TrendingDown className="h-4 w-4" />} />
        <StatCard label="Por pagar" value={moneyShort(porPagar)}
          tone={porPagar > 0 ? 'warning' : 'default'} />
        <StatCard label="Proveedores" value={String(proveedores)} icon={<Receipt className="h-4 w-4" />} />
        <StatCard label="Mayor categoría"
          value={categorias[0] ? moneyShort(categorias[0][1]) : '—'}
          hint={categorias[0]?.[0] ?? 'sin datos'} icon={<Fuel className="h-4 w-4" />} />
      </div>

      {categorias.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="En qué se va la plata" />
          <div className="p-4">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
              {categorias.map(([c, v]) => (
                <div key={c} title={`${c}: ${money(v)}`}
                  className={clsx(COLOR[c]?.split(' ')[0] ?? 'bg-slate-300')}
                  style={{ width: `${(v / (total || 1)) * 100}%` }} />
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {categorias.map(([c, v]) => (
                <button key={c} onClick={() => setCategoria(categoria === c ? 'todas' : c)}
                  className={clsx('flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm',
                    categoria === c ? 'bg-navy-900 text-white' : 'bg-slate-50 hover:bg-slate-100')}>
                  <span className="truncate">{c}</span>
                  <span className="ml-2 shrink-0 tabular-nums font-medium">{moneyShort(v)}</span>
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="mt-4 mb-2 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar detalle, proveedor, RUT, factura o categoría…"
            value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <select className="input w-auto" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          <option value="todas">Todas las categorías</option>
          {categorias.map(([c]) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="text-xs text-slate-400">
          {filtrados.length} de {gastos.data?.length ?? 0}
        </span>
      </div>

      {gastos.isError && <ErrorState error={gastos.error} />}
      {gastos.isLoading && <Skeleton className="h-64" />}

      {!gastos.isLoading && filtrados.length === 0 && (
        <Card>
          <EmptyState title="Sin gastos en este filtro"
            hint="Los gastos salen del detalle de las facturas de compra. Si falta información, extrae el detalle desde Configuración → Conexión con Bsale." />
        </Card>
      )}

      {filtrados.length > 0 && (
        <>
          <TableWrap>
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Fecha</th>
                <th className="th">Categoría</th>
                <th className="th">Proveedor</th>
                <th className="th">Detalle</th>
                <th className="th text-right">Monto</th>
                <th className="th">Pago</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagina_.map((g) => (
                <tr key={`${g.bsale_document_id}-${g.line_no}`} className="hover:bg-slate-50">
                  <td className="td whitespace-nowrap text-slate-500">{dateShort(g.fecha)}</td>
                  <td className="td">
                    <span className={clsx('badge', COLOR[g.categoria] ?? 'bg-slate-100 text-slate-600')}>
                      {g.categoria}
                    </span>
                  </td>
                  <td className="td">
                    <p className="font-medium text-slate-800">{g.proveedor}</p>
                    <p className="text-xs text-slate-400">{g.proveedor_rut}</p>
                  </td>
                  <td className="td text-slate-600">
                    {g.detalle}
                    {g.quantity && Number(g.quantity) !== 1 && (
                      <span className="ml-1 text-xs text-slate-400">
                        {Number(g.quantity)} {g.unit ?? ''}
                      </span>
                    )}
                  </td>
                  <td className="td text-right font-medium tabular-nums">{money(g.monto)}</td>
                  <td className="td">
                    <span className={clsx('badge', PAYMENT_STATUS_STYLE[g.payment_status])}>
                      {PAYMENT_STATUS_LABEL[g.payment_status]}
                    </span>
                  </td>
                  <td className="td text-right">
                    {g.document_url && (
                      <a href={g.document_url} target="_blank" rel="noreferrer"
                        title={`Ver la factura ${g.invoice_number ?? ''}`}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="card mt-3">
            <Paginador total={filtrados.length} pagina={pagina} porPagina={porPagina}
              onPagina={setPagina} onPorPagina={setPorPagina} />
          </div>
        </>
      )}

      <Card className="mt-4 flex items-start gap-3 p-4 text-xs text-slate-500">
        <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>
          Cada línea viene del detalle del documento tributario que emitió el proveedor, no de una
          clasificación manual. La categoría se deduce de la descripción; si alguna queda en «Otros
          gastos» y debería tener la suya, dímelo y se agrega el patrón.
        </p>
      </Card>
    </>
  )
}
