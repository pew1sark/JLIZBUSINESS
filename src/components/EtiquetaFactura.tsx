import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Tag } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { ETIQUETAS, type Etiqueta } from '../lib/etiquetas'


/** El punto de color de una fila. Sin etiqueta no dibuja nada. */
export function PuntoEtiqueta({ etiqueta, nota }: { etiqueta?: string | null; nota?: string | null }) {
  if (!etiqueta || !(etiqueta in ETIQUETAS)) return null
  const e = ETIQUETAS[etiqueta as Etiqueta]
  return (
    <span className={clsx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', e.punto)}
      title={nota ? `${e.label}: ${nota}` : e.label} />
  )
}

/**
 * Poner o quitar la etiqueta de una factura.
 *
 * Se abre desde la propia fila para no obligar a entrar al detalle: marcar diez
 * facturas mientras se revisa una lista tiene que costar diez clics, no treinta.
 */
export function SelectorEtiqueta({
  invoiceId, actual, notaActual, onListo,
}: {
  invoiceId: string
  actual?: string | null
  notaActual?: string | null
  onListo?: () => void
}) {
  const qc = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  const [nota, setNota] = useState(notaActual ?? '')

  const guardar = useMutation({
    mutationFn: async (etiqueta: Etiqueta | null) => {
      const { error } = await supabase.rpc('etiquetar_factura', {
        _invoice_id: invoiceId, _etiqueta: etiqueta, _nota: nota.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      for (const k of ['facturas-emitidas', 'cob-facturas', 'cob-documentos',
                       'cuentas-cobrar', 'factura-detalle', 'corregir-factura']) {
        qc.invalidateQueries({ queryKey: [k] })
      }
      setAbierto(false)
      onListo?.()
    },
  })

  const e = actual && actual in ETIQUETAS ? ETIQUETAS[actual as Etiqueta] : null

  return (
    <div className="relative">
      <button type="button" title={e ? e.label : 'Etiquetar'}
        onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); setAbierto((v) => !v) }}
        className={clsx('flex items-center gap-1.5 rounded-lg px-1.5 py-1',
          e ? 'text-slate-600' : 'text-slate-300 hover:text-slate-500', 'hover:bg-slate-100')}>
        {e
          ? <span className={clsx('h-2.5 w-2.5 rounded-full', e.punto)} />
          : <Tag className="h-3.5 w-3.5" />}
      </button>

      {abierto && (
        <>
          {/* Tapa para cerrar al tocar fuera, sin depender de un listener global. */}
          <button type="button" aria-label="Cerrar"
            className="fixed inset-0 z-[1190] cursor-default"
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault(); setAbierto(false) }} />
          <div className="absolute right-0 z-[1200] mt-1 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg"
            onClick={(ev) => { ev.stopPropagation(); ev.preventDefault() }}>
            {(Object.keys(ETIQUETAS) as Etiqueta[]).map((k) => (
              <button key={k} type="button"
                onClick={() => guardar.mutate(k)}
                disabled={guardar.isPending}
                className={clsx('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50',
                  actual === k && 'bg-slate-50 font-medium')}>
                <span className={clsx('h-2.5 w-2.5 rounded-full', ETIQUETAS[k].punto)} />
                {ETIQUETAS[k].label}
              </button>
            ))}

            <input className="input mt-2 text-xs" placeholder="Nota (opcional)"
              value={nota} onChange={(ev) => setNota(ev.target.value)} />

            {actual && (
              <button type="button" onClick={() => guardar.mutate(null)}
                disabled={guardar.isPending}
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50">
                Quitar la etiqueta
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
