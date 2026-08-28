import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Mail, ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card, CardHeader, Skeleton } from './ui'

/**
 * La casilla desde la que sale el correo de la empresa.
 *
 * El reporte de cobro tiene que salir siempre desde la misma dirección, no
 * desde la cuenta de quien aprieta el botón: así el cliente reconoce el
 * remitente y las respuestas llegan a un solo lugar. Eso obliga a que el envío
 * pase por el servidor con la clave de la casilla, y esa clave no puede estar
 * en el navegador.
 *
 * Se guarda en Vault, igual que el token de Bsale: se escribe una vez, no
 * vuelve nunca a la pantalla, y desde ahí cualquier administrador manda correos
 * sin conocerla.
 */
export function CorreoSaliente() {
  const qc = useQueryClient()
  const [casilla, setCasilla] = useState('')
  const [clave, setClave] = useState('')
  const [listo, setListo] = useState(false)

  const estado = useQuery({
    queryKey: ['correo-estado'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('correo_estado')
      if (error) throw error
      return data as { configurado: boolean; remitente: string | null }
    },
  })

  const guardar = useMutation({
    mutationFn: async () => {
      const dir = casilla.trim() || estado.data?.remitente || ''
      if (!dir) throw new Error('Falta la casilla de la empresa')

      // La dirección va en `settings` (no es secreta y la usa la función al
      // armar el remitente); la clave va a Vault y no vuelve más.
      const { data: actual } = await supabase
        .from('settings').select('value').eq('key', 'empresa').maybeSingle()
      const valor = { ...((actual?.value ?? {}) as Record<string, unknown>), correo_saliente: dir }
      const { error: e1 } = await supabase.from('settings').update({ value: valor }).eq('key', 'empresa')
      if (e1) throw e1

      if (clave.trim()) {
        const { error: e2 } = await supabase.rpc('correo_clave_set', { _valor: clave.trim() })
        if (e2) throw e2
      }
    },
    onSuccess: () => {
      setClave('')
      setListo(true)
      setTimeout(() => setListo(false), 2500)
      qc.invalidateQueries({ queryKey: ['correo-estado'] })
      qc.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  if (estado.isLoading) return <Skeleton className="h-40" />
  const e = estado.data

  return (
    <Card>
      <CardHeader
        title="Correo saliente de la empresa"
        action={
          <span className={`badge ${e?.configurado
            ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
            {e?.configurado ? 'Configurado' : 'Falta la clave'}
          </span>
        }
      />

      <div className="space-y-3 p-4">
        <p className="text-sm text-slate-600">
          Desde esta casilla salen los reportes de cobro. Cualquier administrador puede enviarlos
          sin conocer la clave: el envío ocurre en el servidor.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Casilla</span>
            <input className="input" type="email" autoComplete="off"
              placeholder={e?.remitente ?? 'pescaderiabilagay@gmail.com'}
              value={casilla} onChange={(ev) => setCasilla(ev.target.value)} />
            {e?.remitente && !casilla && (
              <p className="mt-0.5 text-[11px] text-slate-400">Ahora: {e.remitente}</p>
            )}
          </label>

          <label className="block">
            <span className="label">Contraseña de aplicación</span>
            <input className="input" type="password" autoComplete="new-password"
              placeholder={e?.configurado ? 'Guardada · escribe una nueva para cambiarla' : 'xxxx xxxx xxxx xxxx'}
              value={clave} onChange={(ev) => setClave(ev.target.value)} />
          </label>
        </div>

        <button className="btn-primary" disabled={guardar.isPending}
          onClick={() => guardar.mutate()}>
          {guardar.isPending ? <Loader2 className="h-4 w-4 animate-spin" />
            : listo ? <Check className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
          {listo ? 'Guardado' : 'Guardar'}
        </button>

        {guardar.isError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {(guardar.error as Error).message}
          </p>
        )}

        <div className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
          <div>
            <p className="font-medium text-slate-600">No es la contraseña de la casilla</p>
            <p className="mt-0.5">
              Es una <em>contraseña de aplicación</em>: se genera en la cuenta de Google, en
              Seguridad → Contraseñas de aplicaciones, y requiere tener activada la verificación
              en dos pasos. Son 16 letras. Sirve solo para enviar correo y se puede revocar sin
              tocar la contraseña real.
            </p>
            <p className="mt-1">
              Queda cifrada en Vault: no vuelve a esta pantalla ni viaja al navegador de nadie.
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}
