import { useMemo, useState } from 'react'
import { useReportesOperativos } from '../../lib/operativo'
import { dateShort, kg } from '../../lib/format'
import { Card, ErrorState, Skeleton } from '../../components/ui'

type Periodo = 7 | 30

export function WorkerReportes() {
  const reportes = useReportesOperativos()
  const [dias, setDias] = useState<Periodo>(7)

  const datos = useMemo(() => (reportes.data ?? []).slice(0, dias), [reportes.data, dias])

  const totales = useMemo(
    () =>
      datos.reduce(
        (t, d) => ({
          pedidos: t.pedidos + Number(d.pedidos),
          entregados: t.entregados + Number(d.entregados),
          recibidos: t.recibidos + Number(d.kilos_recibidos),
          despachados: t.despachados + Number(d.kilos_despachados),
          merma: t.merma + Number(d.kilos_merma),
          procesados: t.procesados + Number(d.kilos_procesados),
        }),
        { pedidos: 0, entregados: 0, recibidos: 0, despachados: 0, merma: 0, procesados: 0 },
      ),
    [datos],
  )

  const mermaPct = totales.recibidos > 0 ? (totales.merma / totales.recibidos) * 100 : 0

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold text-slate-900">Reportes</h1>
      <p className="mb-4 text-sm text-slate-500">Movimiento de kilos y entregas del período</p>

      <div className="mb-4 flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm">
        {([7, 30] as Periodo[]).map((d) => (
          <button
            key={d}
            onClick={() => setDias(d)}
            className={`flex-1 rounded-md py-1.5 font-medium ${dias === d ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500'}`}
          >
            {d} días
          </button>
        ))}
      </div>

      {reportes.isError && <ErrorState error={reportes.error} />}
      {reportes.isLoading && <Skeleton className="h-40" />}

      <div className="mb-4 grid grid-cols-2 gap-3">
        <Resumen label="Kilos recibidos" valor={kg(totales.recibidos)} />
        <Resumen label="Kilos despachados" valor={kg(totales.despachados)} />
        <Resumen label="Kilos procesados" valor={kg(totales.procesados)} />
        <Resumen
          label="Merma"
          valor={kg(totales.merma)}
          detalle={`${Math.round(mermaPct * 10) / 10}% de lo recibido`}
          alerta={mermaPct > 1.5}
        />
        <Resumen label="Pedidos" valor={String(totales.pedidos)} />
        <Resumen label="Entregados" valor={String(totales.entregados)} />
      </div>

      <h2 className="mb-2 text-xs font-semibold tracking-wide text-navy-700 uppercase">Día a día</h2>
      <div className="space-y-2">
        {datos.map((d) => (
          <Card key={d.dia} className="p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-900">{dateShort(d.dia)}</p>
              <p className="text-xs text-slate-500">
                {d.pedidos} pedidos · {d.entregados} entregados
              </p>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
              <span>↓ recibido {kg(d.kilos_recibidos)}</span>
              <span>↑ despachado {kg(d.kilos_despachados)}</span>
              {Number(d.kilos_procesados) > 0 && <span>proceso {kg(d.kilos_procesados)}</span>}
              {Number(d.kilos_merma) > 0 && (
                <span className="text-amber-600">merma {kg(d.kilos_merma)}</span>
              )}
            </div>
          </Card>
        ))}
      </div>

      <p className="mt-4 pb-4 text-center text-[11px] text-slate-400">
        Estos reportes muestran movimiento de producto. Los montos y márgenes los ve la administración.
      </p>
    </>
  )
}

function Resumen({
  label, valor, detalle, alerta,
}: { label: string; valor: string; detalle?: string; alerta?: boolean }) {
  return (
    <Card className="p-3">
      <p className="text-[11px] font-medium tracking-wide text-slate-500 uppercase">{label}</p>
      <p className={`mt-1 text-lg font-semibold tabular-nums ${alerta ? 'text-amber-600' : 'text-slate-900'}`}>
        {valor}
      </p>
      {detalle && <p className="text-[11px] text-slate-400">{detalle}</p>}
    </Card>
  )
}
