import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  AlertCircle, Building2, Check, Clock, Fish, Loader2, Receipt, Send,
} from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { dateShort, money } from '../lib/format'

interface Documento {
  id: string
  origen: string
  documento: string
  emitida: string
  vence: string | null
  total: number
  pagado: number
  saldo: number
  dias_atraso: number
  tramo: string
}

interface Portal {
  ok: boolean
  error?: string
  cliente: { nombre: string; rut: string | null }
  resumen: {
    deuda_total: number; vencido: number; por_vencer: number
    nota_credito: number; a_cuenta: number; saldo_neto: number
    documentos: number; vence_primero: string | null; plazo_dias: number
  }
  documentos: Documento[]
  notas_credito: { documento: string; emitida: string; disponible: number }[]
  avisos: { code: string; amount: number; paid_at: string; reference: string | null; status: string }[]
  datos_transferencia: Record<string, string>
}

export function PortalPagos() {
  const { token = '' } = useParams()
  const [datos, setDatos] = useState<Portal | null>(null)
  const [cargando, setCargando] = useState(true)
  const [avisar, setAvisar] = useState(false)

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc('portal_get', { _token: token })
    setCargando(false)
    if (error) return setDatos({ ok: false, error: error.message } as Portal)
    setDatos(data as Portal)
  }, [token])

  useEffect(() => { cargar() }, [cargar])

  if (cargando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <Loader2 className="h-6 w-6 animate-spin text-navy-500" />
      </div>
    )
  }

  if (!datos?.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="card max-w-sm p-6 text-center">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <p className="font-medium text-slate-700">{datos?.error ?? 'Enlace no válido'}</p>
          <p className="mt-1 text-sm text-slate-500">
            Escríbenos y te enviamos un enlace nuevo.
          </p>
        </div>
      </div>
    )
  }

  const r = datos.resumen
  const banco = datos.datos_transferencia ?? {}
  const hayDatosBanco = !!(banco.banco || banco.numero_cuenta)

  return (
    <div className="min-h-screen bg-slate-100 pb-16">
      <header className="bg-navy-900 px-5 py-6 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sea-500">
            <Fish className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Pescadería Bilagay SpA</p>
            <p className="text-[11px] text-navy-300">Estado de cuenta</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="card p-5">
          <p className="text-xs tracking-wide text-slate-500 uppercase">Cliente</p>
          <p className="text-lg font-semibold text-slate-900">{datos.cliente.nombre}</p>
          {datos.cliente.rut && <p className="text-sm text-slate-500">{datos.cliente.rut}</p>}

          <div className="mt-4 rounded-xl bg-navy-900 p-4 text-white">
            <p className="text-xs tracking-wide text-navy-300 uppercase">Total pendiente</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">{money(r.saldo_neto)}</p>
            <p className="mt-1 text-sm text-navy-200">
              {r.documentos} documento{r.documentos === 1 ? '' : 's'} · plazo de pago {r.plazo_dias} días
            </p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className={clsx('rounded-lg px-3 py-2',
              Number(r.vencido) > 0 ? 'bg-red-50' : 'bg-slate-50')}>
              <p className="text-[11px] tracking-wide text-slate-500 uppercase">Vencido</p>
              <p className={clsx('font-semibold tabular-nums',
                Number(r.vencido) > 0 ? 'text-red-600' : 'text-slate-900')}>
                {money(r.vencido)}
              </p>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-[11px] tracking-wide text-slate-500 uppercase">Por vencer</p>
              <p className="font-semibold tabular-nums text-slate-900">{money(r.por_vencer)}</p>
            </div>
          </div>

          {(Number(r.nota_credito) > 0 || Number(r.a_cuenta) > 0) && (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Tiene {money(Number(r.nota_credito) + Number(r.a_cuenta))} a favor
              {Number(r.nota_credito) > 0 && ' en notas de crédito'}
              {Number(r.nota_credito) > 0 && Number(r.a_cuenta) > 0 && ' y'}
              {Number(r.a_cuenta) > 0 && ' en pagos por aplicar'}
              , ya descontados del total.
            </p>
          )}

          <button className="btn-primary mt-4 w-full btn-lg" onClick={() => setAvisar(true)}>
            <Send className="h-4 w-4" /> Ya pagué, quiero avisar
          </button>
        </div>

        {hayDatosBanco && (
          <div className="card p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Building2 className="h-4 w-4 text-slate-400" /> Datos para transferir
            </h2>
            <dl className="space-y-1.5 text-sm">
              {banco.titular && <Fila k="Titular" v={banco.titular} />}
              {banco.rut && <Fila k="RUT" v={banco.rut} />}
              {banco.banco && <Fila k="Banco" v={banco.banco} />}
              {banco.tipo_cuenta && <Fila k="Tipo de cuenta" v={banco.tipo_cuenta} />}
              {banco.numero_cuenta && <Fila k="N° de cuenta" v={banco.numero_cuenta} />}
              {banco.email && <Fila k="Enviar comprobante a" v={banco.email} />}
            </dl>
            {banco.mensaje && <p className="mt-3 text-sm text-slate-500">{banco.mensaje}</p>}
          </div>
        )}

        <div className="card overflow-hidden">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
            <Receipt className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Documentos pendientes</h2>
          </div>

          {!datos.documentos.length && (
            <p className="px-5 py-8 text-center text-sm text-slate-400">
              No tiene documentos pendientes. Gracias.
            </p>
          )}

          <div className="divide-y divide-slate-100">
            {datos.documentos.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">Factura {d.documento}</p>
                  <p className="text-xs text-slate-500">
                    Emitida {dateShort(d.emitida)} · Vence {dateShort(d.vence)}
                  </p>
                  {Number(d.pagado) > 0 && (
                    <p className="text-xs text-emerald-600">Abonado {money(d.pagado)} de {money(d.total)}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="font-semibold tabular-nums text-slate-900">{money(d.saldo)}</p>
                  {d.dias_atraso > 0 ? (
                    <span className="badge bg-red-100 text-red-700">
                      {d.dias_atraso} día{d.dias_atraso === 1 ? '' : 's'} vencida
                    </span>
                  ) : (
                    <span className="badge bg-emerald-100 text-emerald-700">Al día</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {datos.notas_credito.length > 0 && (
          <div className="card overflow-hidden">
            <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
              Notas de crédito a su favor
            </h2>
            <div className="divide-y divide-slate-100">
              {datos.notas_credito.map((n) => (
                <div key={n.documento} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-slate-600">NC {n.documento} · {dateShort(n.emitida)}</span>
                  <span className="font-medium tabular-nums text-emerald-600">{money(n.disponible)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {datos.avisos.length > 0 && (
          <div className="card overflow-hidden">
            <h2 className="border-b border-slate-100 px-5 py-3 text-sm font-semibold text-slate-700">
              Pagos que nos informó
            </h2>
            <div className="divide-y divide-slate-100">
              {datos.avisos.map((a) => (
                <div key={a.code} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="flex-1">
                    <p className="text-slate-700">{money(a.amount)} · {dateShort(a.paid_at)}</p>
                    {a.reference && <p className="text-xs text-slate-400">Ref. {a.reference}</p>}
                  </div>
                  <span className={clsx('badge',
                    a.status === 'confirmado' ? 'bg-emerald-100 text-emerald-700'
                    : a.status === 'rechazado' ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-800')}>
                    {a.status === 'confirmado' ? <><Check className="h-3 w-3" /> Confirmado</>
                     : a.status === 'rechazado' ? 'No coincide'
                     : <><Clock className="h-3 w-3" /> En revisión</>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="px-2 text-center text-xs text-slate-400">
          Este resumen se actualiza solo. Si algo no calza con sus registros, escríbanos y lo revisamos.
        </p>
      </main>

      {avisar && (
        <FormularioAviso token={token} documentos={datos.documentos}
          onClose={() => setAvisar(false)}
          onListo={() => { setAvisar(false); setCargando(true); cargar() }} />
      )}
    </div>
  )
}

function Fila({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{k}</dt>
      <dd className="text-right font-medium text-slate-800">{v}</dd>
    </div>
  )
}

function FormularioAviso({
  token, documentos, onClose, onListo,
}: {
  token: string
  documentos: Documento[]
  onClose: () => void
  onListo: () => void
}) {
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10))
  const [referencia, setReferencia] = useState('')
  const [notas, setNotas] = useState('')
  const [marcadas, setMarcadas] = useState<string[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listo, setListo] = useState<string | null>(null)

  const total = marcadas.reduce(
    (a, id) => a + Number(documentos.find((d) => d.id === id)?.saldo ?? 0), 0,
  )

  async function enviar() {
    setEnviando(true)
    setError(null)
    const { data, error: e } = await supabase.rpc('portal_report_payment', {
      _token: token,
      _amount: Number(monto),
      _method: 'transferencia',
      _paid_at: fecha,
      _reference: referencia.trim() || null,
      _invoice_ids: marcadas,
      _notes: notas.trim() || null,
    })
    setEnviando(false)
    const res = data as { ok: boolean; error?: string; code?: string } | null
    if (e) return setError(e.message)
    if (!res?.ok) return setError(res?.error ?? 'No se pudo enviar el aviso')
    setListo(res.code ?? '')
  }

  if (listo !== null) {
    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4">
        <div className="w-full rounded-t-2xl bg-white p-6 text-center sm:max-w-sm sm:rounded-2xl">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
            <Check className="h-6 w-6 text-emerald-600" />
          </div>
          <p className="font-semibold text-slate-900">Aviso recibido</p>
          <p className="mt-1 text-sm text-slate-500">
            Lo vamos a revisar contra la cuenta y, una vez confirmado, sus facturas van a
            aparecer como pagadas acá mismo.
          </p>
          <button className="btn-primary mt-5 w-full" onClick={onListo}>Volver</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white sm:max-w-md sm:rounded-2xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h3 className="font-semibold text-slate-900">Informar un pago</h3>
          <p className="text-xs text-slate-500">
            Cuéntenos cuánto transfirió y qué facturas quiere cubrir.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <label className="block">
            <span className="label">Monto transferido</span>
            <input className="input" type="number" inputMode="numeric" value={monto}
              placeholder="0" onChange={(e) => setMonto(e.target.value)} />
          </label>

          <label className="block">
            <span className="label">Fecha de la transferencia</span>
            <input className="input" type="date" value={fecha}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setFecha(e.target.value)} />
          </label>

          <label className="block">
            <span className="label">N° de operación o comprobante</span>
            <input className="input" value={referencia} placeholder="Opcional pero ayuda mucho"
              onChange={(e) => setReferencia(e.target.value)} />
          </label>

          {documentos.length > 0 && (
            <div>
              <span className="label">¿Qué facturas está pagando? (opcional)</span>
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {documentos.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                    <input type="checkbox" className="h-4 w-4" checked={marcadas.includes(d.id)}
                      onChange={(e) => setMarcadas((m) =>
                        e.target.checked ? [...m, d.id] : m.filter((x) => x !== d.id))} />
                    <span className="flex-1">
                      {d.documento}
                      <span className="ml-1 text-xs text-slate-400">vence {dateShort(d.vence)}</span>
                    </span>
                    <span className="tabular-nums text-slate-600">{money(d.saldo)}</span>
                  </label>
                ))}
              </div>
              {marcadas.length > 0 && (
                <button type="button"
                  className="mt-2 text-xs text-sea-600 hover:underline"
                  onClick={() => setMonto(String(Math.round(total)))}>
                  Usar el total de lo marcado: {money(total)}
                </button>
              )}
            </div>
          )}

          <label className="block">
            <span className="label">Algo más que debamos saber</span>
            <textarea className="input" rows={2} value={notas} placeholder="Opcional"
              onChange={(e) => setNotas(e.target.value)} />
          </label>
        </div>

        <div className="flex gap-2 border-t border-slate-100 px-5 py-3">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancelar</button>
          <button className="btn-primary flex-1" disabled={!Number(monto) || enviando} onClick={enviar}>
            {enviando ? 'Enviando…' : 'Enviar aviso'}
          </button>
        </div>
      </div>
    </div>
  )
}
