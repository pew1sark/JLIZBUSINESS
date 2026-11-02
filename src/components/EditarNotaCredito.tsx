import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { dateShort, money } from '../lib/format'
import { ErrorState, Modal, Skeleton } from './ui'

interface Nota {
  id: string
  doc_number: string
  customer_id: string
  issued_at: string
  total: number
  amount_paid: number
  related_doc_number: string | null
  nc_manual: boolean
  customers: { name: string } | null
}

interface Aplicacion {
  invoice_id: string
  factura: string
  monto: number
}

interface FacturaCliente {
  invoice_id: string
  doc_number: string
  issued_at: string
  total: number
  saldo: number
}

/** Una línea del formulario: a qué factura va y por cuánto. */
interface Linea {
  invoice_id: string
  monto: string
}

/**
 * Editar a qué factura(s) se aplica una nota de crédito y por cuánto.
 *
 * La nota se aplica sola según la factura que referencia su XML. Cuando eso no
 * es lo que pasó —iba a otra factura, era por otro monto, o tenía que quedar
 * como saldo a favor— se decide acá. Una nota editada a mano ya no la toca la
 * aplicación automática, salvo que se la devuelva con el botón de abajo.
 */
export function EditarNotaCredito({
  notaId, onClose,
}: {
  notaId: string | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [motivo, setMotivo] = useState('')
  const [lineas, setLineas] = useState<Linea[]>([])
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'error'; texto: string } | null>(null)

  const nota = useQuery({
    queryKey: ['nota-credito', notaId],
    enabled: !!notaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, doc_number, customer_id, issued_at, total, amount_paid, related_doc_number,'
              + ' nc_manual, customers(name)')
        .eq('id', notaId!).maybeSingle()
      if (error) throw error
      return data as unknown as Nota | null
    },
  })

  const aplicaciones = useQuery({
    queryKey: ['nota-credito-aplicaciones', notaId],
    enabled: !!notaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_aplicaciones_nota_credito').select('invoice_id, factura, monto')
        .eq('nota_id', notaId!)
      if (error) throw error
      return data as Aplicacion[]
    },
  })

  const n = nota.data
  const facturas = useQuery({
    queryKey: ['nota-credito-facturas', n?.customer_id],
    enabled: !!n,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_facturas_con_pago').select('invoice_id, doc_number, issued_at, total, saldo')
        .eq('customer_id', n!.customer_id).neq('doc_type', 'nota_credito')
        .order('issued_at', { ascending: false }).limit(200)
      if (error) throw error
      return data as FacturaCliente[]
    },
  })

  // El formulario parte con lo que la nota tiene aplicado hoy.
  useEffect(() => {
    if (!aplicaciones.data) return
    setLineas(aplicaciones.data.map((a) => ({
      invoice_id: a.invoice_id, monto: String(Math.round(Number(a.monto))) })))
  }, [aplicaciones.data])

  useEffect(() => { if (!notaId) { setMotivo(''); setAviso(null) } }, [notaId])

  function refrescar() {
    for (const k of ['nota-credito', 'nota-credito-aplicaciones', 'nota-credito-facturas',
                     'factura-detalle', 'corregir-factura', 'corregir-imputaciones',
                     'cob-documentos', 'cob-facturas', 'cob-clientes', 'cob-comportamiento',
                     'cob-sin-imputar', 'cob-pagos-detalle', 'finance-kpis',
                     'cuentas-cobrar', 'dashboard-kpis', 'facturas-emitidas']) {
      qc.invalidateQueries({ queryKey: [k] })
    }
  }

  const guardar = useMutation({
    mutationFn: async (automatico: boolean) => {
      const { error } = await supabase.rpc('editar_nota_credito', {
        _nota_id: notaId,
        _aplicaciones: automatico ? [] : lineas
          .filter((l) => l.invoice_id && Number(l.monto) > 0)
          .map((l) => ({ invoice_id: l.invoice_id, monto: Number(l.monto) })),
        _motivo: motivo.trim(),
        _automatico: automatico,
      })
      if (error) throw error
      return automatico
    },
    onSuccess: (automatico) => {
      setAviso({ tono: 'ok', texto: automatico
        ? 'La nota vuelve a aplicarse sola según la factura que referencia.'
        : 'Nota de crédito guardada.' })
      refrescar()
    },
    onError: (e: Error) => setAviso({ tono: 'error', texto: e.message }),
  })

  const monto = n ? Math.abs(Number(n.total)) : 0
  const aplicado = lineas.reduce((a, l) => a + (Number(l.monto) || 0), 0)
  const queda = monto - aplicado
  const sinFactura = n ? Number(n.amount_paid)
    - (aplicaciones.data ?? []).reduce((a, x) => a + Number(x.monto), 0) : 0
  const listo = motivo.trim().length >= 3
  const valido = queda >= 0 && lineas.every((l) => !l.invoice_id || Number(l.monto) >= 0)
                 && new Set(lineas.map((l) => l.invoice_id).filter(Boolean)).size
                    === lineas.filter((l) => l.invoice_id).length

  // Lo que la nota tiene aplicado hoy en una factura vuelve a estar disponible
  // al editarla, así que se suma al saldo que se muestra.
  function saldoDisponible(f: FacturaCliente) {
    const actual = (aplicaciones.data ?? []).find((a) => a.invoice_id === f.invoice_id)
    return Number(f.saldo) + (actual ? Number(actual.monto) : 0)
  }
  const opciones = (facturas.data ?? []).filter((f) => saldoDisponible(f) > 0)

  function cambiar(i: number, cambio: Partial<Linea>) {
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, ...cambio } : l)))
    setAviso(null)
  }

  return (
    <Modal open={!!notaId} onClose={onClose} wide sobrepuesto
      title={n ? `Nota de crédito ${n.doc_number} · ${n.customers?.name ?? ''}` : 'Editar la nota de crédito'}>
      {(nota.isLoading || aplicaciones.isLoading) && <Skeleton className="h-32" />}
      {nota.isError && <ErrorState error={nota.error} />}

      {n && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 px-4 py-3 text-sm sm:grid-cols-4">
            <Dato k="Emitida" v={dateShort(n.issued_at)} />
            <Dato k="Monto" v={money(monto)} />
            <Dato k="Aplicado hoy" v={money(Number(n.amount_paid))} />
            <Dato k="Referencia" v={n.related_doc_number ? `Factura ${n.related_doc_number}` : '—'} />
          </div>

          {sinFactura > 0 && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {money(sinFactura)} figuran aplicados sin una factura registrada (carga anterior).
              Al guardar, lo aplicado pasa a ser solo lo que quede abajo.
            </p>
          )}

          <p className="text-xs text-slate-500">
            {n.nc_manual
              ? 'Esta nota se editó a mano: la aplicación automática no la toca.'
              : 'Hoy se aplica sola según la factura que referencia. Al guardar queda como la dejes acá.'}
          </p>

          <div>
            <label className="label" htmlFor="motivo-nota">
              Por qué se edita · queda anotado con tu nombre
            </label>
            <input id="motivo-nota" className="input" value={motivo}
              placeholder="Ej: la nota corresponde a la factura 1234, no a la 1230"
              onChange={(e) => { setMotivo(e.target.value); setAviso(null) }} />
          </div>

          <section>
            <h4 className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              Se aplica a
            </h4>
            <div className="space-y-2">
              {lineas.map((l, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select className="input min-w-0 flex-1 text-sm" value={l.invoice_id}
                    onChange={(e) => cambiar(i, { invoice_id: e.target.value })}>
                    <option value="">Elegir factura…</option>
                    {opciones.map((f) => (
                      <option key={f.invoice_id} value={f.invoice_id}>
                        {f.doc_number} · {dateShort(f.issued_at)} · total {money(f.total)}
                        {' '}· saldo {money(saldoDisponible(f))}
                      </option>
                    ))}
                  </select>
                  <input type="number" min={0} className="input w-32 text-right text-sm"
                    value={l.monto} onChange={(e) => cambiar(i, { monto: e.target.value })} />
                  <button type="button" title="Quitar"
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {lineas.length === 0 && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  Sin aplicar: la nota completa queda como saldo a favor del cliente.
                </p>
              )}
              <button type="button"
                className="flex items-center gap-1.5 text-xs text-navy-700 hover:underline"
                onClick={() => setLineas((ls) => [...ls, {
                  invoice_id: '', monto: String(Math.max(Math.round(queda), 0)) }])}>
                <Plus className="h-3.5 w-3.5" /> Aplicar a otra factura
              </button>
            </div>
            <p className={clsx('mt-2 text-xs', queda < 0 ? 'text-red-600' : 'text-slate-500')}>
              Aplicado {money(aplicado)} de {money(monto)}
              {queda > 0 && ` · ${money(queda)} quedan a favor del cliente`}
              {queda < 0 && ` · se pasa por ${money(-queda)}`}
            </p>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn-primary"
              disabled={!listo || !valido || guardar.isPending}
              onClick={() => guardar.mutate(false)}>
              Guardar
            </button>
            {n.nc_manual && (
              <button type="button" disabled={!listo || guardar.isPending}
                onClick={() => guardar.mutate(true)}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-navy-700 disabled:opacity-50">
                <RotateCcw className="h-3.5 w-3.5" />
                Volver a la aplicación automática
              </button>
            )}
          </div>

          {!listo && (
            <p className="text-xs text-slate-400">Escribe el motivo para poder guardar.</p>
          )}
          {aviso && (
            <p className={clsx('rounded-lg px-3 py-2 text-sm',
              aviso.tono === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>
              {aviso.texto}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{k}</p>
      <p className="font-medium text-slate-800 tabular-nums">{v}</p>
    </div>
  )
}
