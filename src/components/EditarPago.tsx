import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { PAYMENT_METHOD_LABEL } from '../lib/constants'
import type { PaymentMethod } from '../lib/types'
import { money } from '../lib/format'
import { ErrorState, Modal } from './ui'

export interface PagoAEditar {
  id: string
  code: string
  amount: number
  method: PaymentMethod
  paid_at: string
  reference: string | null
  notes: string | null
  /** Cliente o proveedor, solo para el título. */
  contraparte?: string | null
}

/** La fecha del pago tal como se ve en Chile, no en UTC. */
const fechaChile = (paidAt: string) =>
  new Date(paidAt).toLocaleDateString('en-CA', { timeZone: 'America/Santiago' })

/**
 * Corregir un pago ya registrado: fecha, forma de pago, N° de operación y nota.
 *
 * Antes la única salida era anular y volver a registrar, y en un cobro repartido
 * entre varias facturas eso obligaba a rehacer la imputación. El monto no se edita
 * acá porque cuelga de las imputaciones; para cambiarlo sigue estando anular.
 */
export function EditarPago({
  pago, onClose, onGuardado,
}: {
  pago: PagoAEditar | null
  onClose: () => void
  onGuardado?: () => void
}) {
  const qc = useQueryClient()
  const [fecha, setFecha] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia')
  const [referencia, setReferencia] = useState('')
  const [notas, setNotas] = useState('')
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
    if (!pago) return
    setFecha(fechaChile(pago.paid_at))
    setMetodo(pago.method)
    setReferencia(pago.reference ?? '')
    setNotas(pago.notes ?? '')
    setMotivo('')
  }, [pago])

  const guardar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('update_payment', {
        _payment_id: pago!.id,
        _fecha: fecha,
        _method: metodo,
        _reference: referencia.trim() || null,
        _notes: notas.trim() || null,
        _reason: motivo.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      // La fecha del pago aparece en cobranza, compras, finanzas y reportes.
      qc.invalidateQueries()
      onGuardado?.()
      onClose()
    },
  })

  const sinCambios = !!pago
    && fecha === fechaChile(pago.paid_at)
    && metodo === pago.method
    && referencia.trim() === (pago.reference ?? '')
    && notas.trim() === (pago.notes ?? '')

  return (
    <Modal
      open={!!pago}
      onClose={onClose}
      title={pago ? `Corregir pago ${pago.code}` : ''}
      footer={
        <>
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary"
            disabled={!fecha || sinCambios || guardar.isPending}
            onClick={() => guardar.mutate()}>
            {guardar.isPending ? 'Guardando…' : 'Guardar corrección'}
          </button>
        </>
      }
    >
      {pago && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            {pago.contraparte && <span className="font-medium text-slate-700">{pago.contraparte} · </span>}
            {money(pago.amount)}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">Fecha del pago</span>
              <input type="date" className="input" value={fecha}
                onChange={(e) => setFecha(e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Forma de pago</span>
              <select className="input" value={metodo}
                onChange={(e) => setMetodo(e.target.value as PaymentMethod)}>
                {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="label">N° de operación</span>
            <input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)} />
          </label>

          <label className="block">
            <span className="label">Nota</span>
            <input className="input" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </label>

          <label className="block">
            <span className="label">Motivo de la corrección (opcional)</span>
            <input className="input" placeholder="Ej: la fecha estaba mal digitada"
              value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </label>

          <p className="text-xs text-slate-400">
            El monto no se cambia acá: si está mal, anula el pago y regístralo de nuevo.
            La corrección queda en la auditoría con el valor anterior.
          </p>

          {guardar.isError && <ErrorState error={guardar.error} />}
        </div>
      )}
    </Modal>
  )
}
