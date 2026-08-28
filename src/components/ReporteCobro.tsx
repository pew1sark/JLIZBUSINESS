import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Loader2, Mail, MessageCircle, Check, X } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'
import type { Contacto } from './ContactosCliente'
import { mensajeCobro, type DocDeuda } from '../lib/cobranza'
import { Skeleton } from './ui'

/**
 * Reporte de cobro listo para enviar, por WhatsApp o por correo.
 *
 * Por defecto va al contacto de finanzas, que es quien paga. WhatsApp abre la
 * aplicación con el mensaje escrito —lo manda la persona— y el correo sale del
 * servidor desde la casilla de la empresa, para que el cliente reconozca el
 * remitente y las respuestas lleguen a un solo lugar en vez de a la cuenta
 * personal de quien apretó el botón.
 */
export function ReporteCobro({
  customerId, cliente, documentos, deudaTotal, whatsappCliente,
}: {
  customerId: string
  cliente: string
  documentos: DocDeuda[]
  deudaTotal: number
  /** Teléfono del propio cliente, por si no hay contactos cargados. */
  whatsappCliente?: string | null
}) {
  const qc = useQueryClient()
  const [soloVencido, setSoloVencido] = useState(true)
  const [destino, setDestino] = useState<string>('')
  const [copiado, setCopiado] = useState(false)
  const [canal, setCanal] = useState<'whatsapp' | 'correo'>('whatsapp')
  const [extras, setExtras] = useState<string[]>([])
  const [nuevoCorreo, setNuevoCorreo] = useState('')
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  const contactos = useQuery({
    queryKey: ['contactos-cobro', customerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customer_contacts')
        .select('*')
        .eq('customer_id', customerId)
        .order('is_primary', { ascending: false })
      if (error) throw error
      return data as Contacto[]
    },
  })

  const empresa = useQuery({
    queryKey: ['settings', 'empresa'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings').select('value').eq('key', 'empresa').maybeSingle()
      if (error) throw error
      return (data?.value ?? {}) as Record<string, string>
    },
  })

  // Quien paga es finanzas. Si no hay nadie de finanzas cargado, se ofrece el
  // resto de los contactos y, al final, el teléfono general del cliente.
  const candidatos = useMemo(() => {
    const cs = (contactos.data ?? []).filter((c) => c.whatsapp || c.phone)
    const orden = { finanzas: 0, gerencia: 1, otro: 2, logistica: 3 } as const
    return [...cs].sort((a, b) => orden[a.role] - orden[b.role])
  }, [contactos.data])

  const elegido = candidatos.find((c) => c.id === destino) ?? candidatos[0] ?? null
  const numero = (elegido?.whatsapp || elegido?.phone || whatsappCliente || '').replace(/\D/g, '')

  const incluidos = useMemo(
    () => documentos.filter((d) => (soloVencido ? d.dias_atraso > 0 : true))
      .sort((a, b) => b.dias_atraso - a.dias_atraso),
    [documentos, soloVencido],
  )

  const texto = useMemo(
    () => mensajeCobro(cliente, incluidos, {
      soloVencido, empresa: empresa.data?.razon_social ?? empresa.data?.nombre ?? '',
      deudaTotal, sinRecorte: canal === 'correo',
    }),
    [cliente, incluidos, soloVencido, empresa.data, deudaTotal, canal],
  )

  const vencidos = documentos.filter((d) => d.dias_atraso > 0)
  const montoIncluido = incluidos.reduce((a, d) => a + Number(d.saldo), 0)

  // El correo del contacto elegido, más los que se agreguen a mano. Sin
  // repetidos: mandar dos veces el mismo cobro a la misma casilla se ve mal.
  const correoContacto = (elegido?.email ?? '').trim()
  const destinatarios = useMemo(() => {
    const todos = [correoContacto, ...extras].map((c) => c.trim().toLowerCase()).filter(Boolean)
    return [...new Set(todos)]
  }, [correoContacto, extras])

  const asunto = `Estado de cuenta · ${cliente}`

  const enviar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('enviar-correo', {
        body: { para: destinatarios, asunto, texto, customer_id: customerId, tipo: 'reporte_cobro' },
      })
      if (error) {
        // La función responde con un texto explicando qué falta; el error de
        // red genérico no le sirve a nadie.
        const detalle = await (error as { context?: Response }).context?.json?.().catch(() => null)
        throw new Error(detalle?.error ?? error.message)
      }
      return data as { enviados: number; desde: string }
    },
    onSuccess: (r) => {
      setAviso({ ok: true, texto: `Enviado a ${r.enviados} destinatario(s) desde ${r.desde}.` })
      qc.invalidateQueries({ queryKey: ['correos-enviados', customerId] })
    },
    onError: (e: Error) => setAviso({ ok: false, texto: e.message }),
  })

  function agregarCorreo() {
    const c = nuevoCorreo.trim().toLowerCase()
    if (!c) return
    if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(c)) {
      setAviso({ ok: false, texto: `«${c}» no parece un correo válido.` })
      return
    }
    if (!extras.includes(c) && c !== correoContacto.toLowerCase()) setExtras((v) => [...v, c])
    setNuevoCorreo('')
    setAviso(null)
  }

  if (contactos.isLoading) return <Skeleton className="h-40" />

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        {canal === 'correo'
          ? <Mail className="h-4 w-4 text-slate-400" />
          : <MessageCircle className="h-4 w-4 text-slate-400" />}
        <p className="flex-1 text-sm font-medium text-slate-700">Reporte de cobro</p>
        <span className="text-xs text-slate-400">
          {incluidos.length} documento(s) · {money(montoIncluido)}
        </span>
      </div>

      <div className="space-y-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1">
          {([['whatsapp', 'WhatsApp'], ['correo', 'Correo']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => { setCanal(k); setAviso(null) }}
              className={clsx('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
                canal === k ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {k === 'correo' ? <Mail className="h-3.5 w-3.5" /> : <MessageCircle className="h-3.5 w-3.5" />}
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {([[true, `Solo lo vencido (${vencidos.length})`],
             [false, `Toda la deuda (${documentos.length})`]] as const).map(([v, label]) => (
            <button key={String(v)} type="button" onClick={() => setSoloVencido(v)}
              className={clsx('rounded-full px-3 py-1 text-xs font-medium',
                soloVencido === v ? 'bg-navy-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {label}
            </button>
          ))}
        </div>

        <label className="block">
          <span className="label">Enviar a</span>
          {candidatos.length > 0 ? (
            <select className="input" value={elegido?.id ?? ''} onChange={(e) => setDestino(e.target.value)}>
              {candidatos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.position ? ` · ${c.position}` : ''} — {ROL_CORTO[c.role]}
                  {' '}({c.whatsapp || c.phone})
                </option>
              ))}
            </select>
          ) : (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Este cliente no tiene contactos cargados.
              {whatsappCliente
                ? ' Se usará el teléfono general de la ficha.'
                : ' Agrega el contacto de finanzas en la ficha del cliente para poder enviarle el reporte.'}
            </p>
          )}
        </label>

        {canal === 'correo' && (
          <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2.5">
            <p className="label mb-0">Correos a los que va</p>

            {correoContacto ? (
              <p className="text-sm text-slate-700">
                {correoContacto}
                <span className="ml-1 text-xs text-slate-400">· {elegido?.name}</span>
              </p>
            ) : (
              <p className="text-xs text-amber-800">
                {elegido
                  ? `${elegido.name} no tiene correo en la ficha. Agrégalo abajo o cárgalo en el cliente.`
                  : 'Este cliente no tiene contactos con correo. Agrega uno abajo.'}
              </p>
            )}

            {extras.map((c) => (
              <p key={c} className="flex items-center gap-1.5 text-sm text-slate-700">
                {c}
                <button type="button" title="Quitar" onClick={() => setExtras((v) => v.filter((x) => x !== c))}
                  className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700">
                  <X className="h-3 w-3" />
                </button>
              </p>
            ))}

            <div className="flex gap-2">
              <input className="input text-sm" type="email" placeholder="Agregar otro correo…"
                value={nuevoCorreo}
                onChange={(e) => setNuevoCorreo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarCorreo() } }} />
              <button type="button" className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                onClick={agregarCorreo}>Agregar</button>
            </div>

            <p className="text-[11px] text-slate-400">
              Sale desde la casilla de la empresa, no desde tu cuenta. Máximo 10 destinatarios.
            </p>
          </div>
        )}

        <label className="block">
          <span className="label">Mensaje</span>
          <textarea readOnly value={texto} rows={10}
            className="input resize-y font-mono text-xs leading-relaxed" />
        </label>

        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-xs"
            onClick={() => {
              navigator.clipboard.writeText(texto)
              setCopiado(true)
              setTimeout(() => setCopiado(false), 1800)
            }}>
            {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiado ? 'Copiado' : 'Copiar el mensaje'}
          </button>

          {canal === 'whatsapp' ? (
            <a
              href={numero
                ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`
                : undefined}
              target="_blank" rel="noreferrer"
              aria-disabled={!numero || incluidos.length === 0}
              className={clsx('btn-accent px-3 py-1.5 text-xs',
                (!numero || incluidos.length === 0) && 'pointer-events-none opacity-50')}>
              <MessageCircle className="h-3.5 w-3.5" />
              {numero ? `Abrir WhatsApp${elegido ? ` a ${elegido.name}` : ''}` : 'Sin número para enviar'}
            </a>
          ) : (
            <button type="button" className="btn-accent px-3 py-1.5 text-xs"
              disabled={destinatarios.length === 0 || incluidos.length === 0 || enviar.isPending}
              onClick={() => { setAviso(null); enviar.mutate() }}>
              {enviar.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Mail className="h-3.5 w-3.5" />}
              {destinatarios.length === 0
                ? 'Sin correo para enviar'
                : `Enviar a ${destinatarios.length} correo(s)`}
            </button>
          )}
        </div>

        {aviso && (
          <p className={clsx('rounded-lg px-3 py-2 text-sm',
            aviso.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700')}>
            {aviso.texto}
          </p>
        )}

        {incluidos.length === 0 && (
          <p className="text-xs text-slate-400">
            {soloVencido
              ? 'Este cliente no tiene documentos vencidos. Cambia a «toda la deuda» si quieres avisarle igual.'
              : 'Este cliente no tiene deuda pendiente.'}
          </p>
        )}
      </div>
    </div>
  )
}

const ROL_CORTO: Record<Contacto['role'], string> = {
  finanzas: 'paga las facturas',
  logistica: 'logística',
  gerencia: 'gerencia',
  otro: 'otro',
}
