import { useMemo, useState } from 'react'
import { AlertTriangle, Search } from 'lucide-react'
import { useStockOperativo } from '../../lib/operativo'
import { dateShort, kg } from '../../lib/format'
import { Card, EmptyState, ErrorState, Skeleton } from '../../components/ui'

export function WorkerStock() {
  const stock = useStockOperativo()
  const [busca, setBusca] = useState('')
  const [soloBajos, setSoloBajos] = useState(false)

  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase()
    return (stock.data ?? [])
      .filter((p) => (soloBajos ? p.bajo_minimo : true))
      .filter((p) => (t ? p.name.toLowerCase().includes(t) : true))
  }, [stock.data, busca, soloBajos])

  const bajos = (stock.data ?? []).filter((p) => p.bajo_minimo).length
  const totalKilos = (stock.data ?? []).reduce((n, p) => n + Number(p.available), 0)

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Stock</h1>
      <p className="mb-4 text-sm text-slate-500">
        {kg(totalKilos)} disponibles · {bajos} bajo el mínimo
      </p>

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-3 left-3 h-4 w-4 text-slate-400" />
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar producto…"
          className="input py-2.5 pl-9"
        />
      </div>

      <button
        onClick={() => setSoloBajos((v) => !v)}
        className={`mb-3 w-full rounded-lg px-4 py-2.5 text-sm font-medium ${
          soloBajos ? 'bg-amber-100 text-amber-800' : 'bg-white text-slate-600 shadow-sm'
        }`}
      >
        {soloBajos ? 'Mostrando solo lo que está bajo el mínimo' : `Ver solo bajo mínimo (${bajos})`}
      </button>

      {stock.isError && <ErrorState error={stock.error} />}
      {stock.isLoading && <Skeleton className="h-64" />}
      {!stock.isLoading && lista.length === 0 && (
        <Card><EmptyState title="Sin productos que mostrar" /></Card>
      )}

      <div className="space-y-2">
        {lista.map((p) => {
          const vence = p.proximo_vencimiento ? new Date(p.proximo_vencimiento) : null
          const critico = vence ? vence.getTime() - Date.now() < 36 * 3600 * 1000 : false
          return (
            <Card key={p.product_id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.presentation ?? p.sku ?? ''} · {p.lotes} lote(s)
                  </p>
                </div>
                <div className="text-right">
                  <p className={`text-lg font-semibold tabular-nums ${p.bajo_minimo ? 'text-amber-600' : 'text-slate-900'}`}>
                    {kg(p.available, p.base_unit)}
                  </p>
                  {p.reserved > 0 && (
                    <p className="text-[11px] text-slate-400">{kg(p.reserved, p.base_unit)} reservado</p>
                  )}
                </div>
              </div>

              {(p.bajo_minimo || critico) && (
                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                  {p.bajo_minimo && (
                    <span className="badge bg-amber-100 text-amber-800">
                      <AlertTriangle className="h-3 w-3" /> mínimo {kg(p.min_stock, p.base_unit)}
                    </span>
                  )}
                  {critico && (
                    <span className="badge bg-red-100 text-red-700">
                      vence {dateShort(p.proximo_vencimiento)}
                    </span>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}
