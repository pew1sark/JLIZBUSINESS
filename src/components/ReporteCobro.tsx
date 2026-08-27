import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, MessageCircle, Check } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { money } from '../lib/format'
import type { Contacto } from './ContactosCliente'
import { mensajeCobro, type DocDeuda } from '../lib/cobranza'
import { Skeleton } from './ui'

/**
 * Reporte de cobro listo para enviar. Elige a quién va (por defecto el
 * contacto de finanzas, que es quien paga), qué se incluye y con un toque
 * abre WhatsApp con el mensaje escrito.
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
  const [soloVencido, setSoloVencido] = useState(true)
  const [destino, setDestino] = useState<string>('')
  const [copiado, setCopiado] = useState(false)

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
      deudaTotal,
    }),
    [cliente, incluidos, soloVencido, empresa.data, deudaTotal],
  )

  const vencidos = documentos.filter((d) => d.dias_atraso > 0)
  const montoIncluido = incluidos.reduce((a, d) => a + Number(d.saldo), 0)

  if (contactos.isLoading) return <Skeleton className="h-40" />

  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        <MessageCircle className="h-4 w-4 text-slate-400" />
        <p className="flex-1 text-sm font-medium text-slate-700">Reporte de cobro por WhatsApp</p>
        <span className="text-xs text-slate-400">
          {incluidos.length} documento(s) · {money(montoIncluido)}
        </span>
      </div>

      <div className="space-y-3 px-4 py-3">
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
        </div>

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
