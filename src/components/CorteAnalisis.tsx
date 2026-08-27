import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Check, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dateLong, money } from '../lib/format'
import { Card, CardHeader, ErrorState, Skeleton } from './ui'

/**
 * La integración con Bsale trajo compras desde 2025, pero las ventas de
 * ese año todavía no están cargadas. Mezclarlas hace ver un negocio en
 * ruina que no existe. En vez de borrar historia se define una fecha de
 * corte: lo anterior queda guardado pero fuera de los números.
 */
export function CorteAnalisis() {
  const qc = useQueryClient()
  const [fecha, setFecha] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardado, setGuardado] = useState(false)

  const actual = useQuery({
    queryKey: ['settings', 'analisis'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings').select('value').eq('key', 'analisis').maybeSingle()
      if (error) throw error
      return (data?.value ?? {}) as { desde?: string }
    },
  })

  const fuera = useQuery({
    queryKey: ['fuera-del-corte', actual.data?.desde],
    enabled: !!actual.data?.desde,
    queryFn: async () => {
      const desde = actual.data!.desde!
      const [c, v] = await Promise.all([
        supabase.from('purchases').select('total', { count: 'exact' }).lt('purchase_date', desde),
        supabase.from('invoices').select('total', { count: 'exact' }).lt('issued_at', desde),
      ])
      const suma = (r: { data: { total: number }[] | null }) =>
        (r.data ?? []).reduce((n, x) => n + Number(x.total), 0)
      return {
        compras: c.count ?? 0, comprasMonto: suma(c),
        ventas: v.count ?? 0, ventasMonto: suma(v),
      }
    },
  })

  const guardar = useMutation({
    mutationFn: async (desde: string) => {
      const { error } = await supabase.from('settings')
        .update({ value: { desde } }).eq('key', 'analisis')
      if (error) throw error
    },
    onSuccess: () => {
      setGuardado(true); setError(null)
      setTimeout(() => setGuardado(false), 2500)
      // Todo lo que muestra números depende del corte.
      qc.invalidateQueries()
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e)),
  })

  const desde = fecha ?? actual.data?.desde ?? ''

  return (
    <Card>
      <CardHeader title="Desde cuándo se analiza" />
      <div className="space-y-3 p-5">
        <p className="text-sm text-slate-600">
          Todo lo anterior a esta fecha <span className="font-medium">queda guardado</span>, pero fuera
          de los números: ventas, compras, márgenes, cuentas por cobrar y por pagar. Sirve mientras
          falte cargar un período completo.
        </p>

        {actual.isLoading && <Skeleton className="h-10" />}
        {error && <ErrorState error={error} />}

        <div className="flex flex-wrap items-center gap-3">
          <CalendarRange className="h-4 w-4 text-slate-400" />
          <input type="date" className="input w-auto" value={desde}
            onChange={(e) => setFecha(e.target.value)} />
          <button className="btn-primary" disabled={!desde || guardar.isPending}
            onClick={() => guardar.mutate(desde)}>
            {guardar.isPending ? <Loader2 className="h-4 w-4 animate-spin" />
              : guardado ? <Check className="h-4 w-4" /> : null}
            {guardado ? 'Guardado' : 'Aplicar'}
          </button>
          {actual.data?.desde && (
            <span className="text-xs text-slate-400">
              Ahora se analiza desde {dateLong(actual.data.desde)}
            </span>
          )}
        </div>

        {fuera.data && (fuera.data.compras > 0 || fuera.data.ventas > 0) && (
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Fuera del análisis hay{' '}
            {fuera.data.compras > 0 && (
              <><span className="font-medium">{fuera.data.compras} compras</span> por{' '}
                {money(fuera.data.comprasMonto)}</>
            )}
            {fuera.data.compras > 0 && fuera.data.ventas > 0 && ' y '}
            {fuera.data.ventas > 0 && (
              <><span className="font-medium">{fuera.data.ventas} ventas</span> por{' '}
                {money(fuera.data.ventasMonto)}</>
            )}
            . Cuando completes esa información, mueve la fecha hacia atrás y todo se recalcula solo.
          </div>
        )}
      </div>
    </Card>
  )
}
