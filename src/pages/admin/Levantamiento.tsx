import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Download, FileSpreadsheet, Link2, Plus, Upload, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { SURVEY, TOTAL_QUESTIONS } from '../../lib/survey'
import { dateTime, relative } from '../../lib/format'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, TableWrap } from '../../components/ui'

interface Session {
  id: string
  token: string
  client_name: string
  business_name: string | null
  status: 'abierta' | 'cerrada'
  created_at: string
  last_activity_at: string | null
  submitted_at: string | null
}

const linkFor = (token: string, form: 'levantamiento' | 'catalogo' = 'levantamiento') =>
  `${window.location.origin}${import.meta.env.BASE_URL}#/${form}/${token}`

function newToken() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24)
}

export function Levantamiento() {
  const qc = useQueryClient()
  const [nuevo, setNuevo] = useState(false)
  const [nombre, setNombre] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [verId, setVerId] = useState<string | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [resultado, setResultado] = useState<
    { productos: number; clientes: number; proveedores: number; rendimientos: number; avisos: string[] } | null
  >(null)

  const sesiones = useQuery({
    queryKey: ['survey-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_sessions')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Session[]
    },
  })

  const conteos = useQuery({
    queryKey: ['survey-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('survey_answers').select('session_id, answer')
      if (error) throw error
      const map: Record<string, number> = {}
      for (const a of data as { session_id: string; answer: string }[]) {
        if (a.answer?.trim()) map[a.session_id] = (map[a.session_id] ?? 0) + 1
      }
      return map
    },
  })

  const crear = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('survey_sessions').insert({
        token: newToken(),
        client_name: nombre.trim() || 'Cliente',
        business_name: empresa.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      setNuevo(false)
      setNombre('')
      setEmpresa('')
      qc.invalidateQueries({ queryKey: ['survey-sessions'] })
    },
  })

  const importar = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc('import_intake', { _session_id: sessionId })
      if (error) throw error
      return data as { productos: number; clientes: number; proveedores: number; rendimientos: number; avisos: string[] }
    },
    onSuccess: (r) => {
      setResultado(r)
      qc.invalidateQueries({ queryKey: ['intake-counts'] })
      qc.invalidateQueries({ queryKey: ['products'] })
      qc.invalidateQueries({ queryKey: ['stock'] })
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })

  const respuestas = useQuery({
    queryKey: ['survey-answers', verId],
    enabled: !!verId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_answers')
        .select('question_id, answer, updated_at')
        .eq('session_id', verId)
      if (error) throw error
      const map: Record<string, string> = {}
      for (const a of data as { question_id: string; answer: string }[]) map[a.question_id] = a.answer
      return map
    },
  })

  function copiar(token: string, form: 'levantamiento' | 'catalogo' = 'levantamiento') {
    navigator.clipboard.writeText(linkFor(token, form))
    setCopiado(token + form)
    setTimeout(() => setCopiado(null), 2000)
  }

  function exportar(sesion: Session, data: Record<string, string>) {
    const filas = [['Sección', 'N°', 'Pregunta', 'Prioridad', 'Respuesta']]
    for (const s of SURVEY) {
      for (const b of s.blocks) {
        for (const q of b.questions) {
          filas.push([s.short, q.id, q.q, q.priority, data[q.id] ?? ''])
        }
      }
    }
    const csv = filas
      .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `levantamiento-${sesion.client_name.replace(/\s+/g, '-').toLowerCase()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sesionVista = sesiones.data?.find((s) => s.id === verId)

  return (
    <>
      <PageHeader
        title="Levantamiento de información"
        subtitle="Formularios enviados a clientes para configurar el sistema con datos reales"
        actions={
          <button onClick={() => setNuevo(true)} className="btn-primary">
            <Plus className="h-4 w-4" /> Nuevo formulario
          </button>
        }
      />

      {sesiones.isError && <ErrorState error={sesiones.error} />}
      {sesiones.isLoading && <Skeleton className="h-40" />}

      {sesiones.data?.length === 0 && (
        <Card>
          <EmptyState
            title="Aún no hay formularios"
            hint="Crea uno, copia el enlace y envíaselo al cliente por WhatsApp. Puede responder desde el teléfono y todo se guarda solo."
            icon={<Link2 className="h-8 w-8" />}
          />
        </Card>
      )}

      {!!sesiones.data?.length && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Cliente</th>
              <th className="th">Avance</th>
              <th className="th">Última actividad</th>
              <th className="th">Enviado</th>
              <th className="th">Enlaces</th>
              <th className="th">Datos cargados</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sesiones.data.map((s) => {
              const n = conteos.data?.[s.id] ?? 0
              const pct = Math.round((n / TOTAL_QUESTIONS) * 100)
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="td">
                    <p className="font-medium text-slate-900">{s.client_name}</p>
                    <p className="text-xs text-slate-400">{s.business_name ?? '—'}</p>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full bg-sea-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs tabular-nums text-slate-500">
                        {n}/{TOTAL_QUESTIONS}
                      </span>
                    </div>
                  </td>
                  <td className="td text-slate-500">{relative(s.last_activity_at)}</td>
                  <td className="td">
                    {s.submitted_at ? (
                      <span className="badge bg-emerald-100 text-emerald-700">{dateTime(s.submitted_at)}</span>
                    ) : (
                      <span className="badge bg-slate-100 text-slate-500">En curso</span>
                    )}
                  </td>
                  <td className="td">
                    <div className="flex flex-col gap-1">
                      <button
                        onClick={() => copiar(s.token)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-navy-600 hover:underline"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        {copiado === s.token + 'levantamiento' ? '¡Copiado!' : 'Preguntas'}
                      </button>
                      <button
                        onClick={() => copiar(s.token, 'catalogo')}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-sea-700 hover:underline"
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        {copiado === s.token + 'catalogo' ? '¡Copiado!' : 'Catálogo y costos'}
                      </button>
                    </div>
                  </td>
                  <td className="td">
                    <Cargados sessionId={s.id} onImportar={() => importar.mutate(s.id)} importando={importar.isPending} />
                  </td>
                  <td className="td text-right">
                    <button onClick={() => setVerId(s.id)} className="btn-secondary px-3 py-1.5 text-xs">
                      Ver respuestas
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      <Modal
        open={nuevo}
        onClose={() => setNuevo(false)}
        title="Nuevo formulario de levantamiento"
        footer={
          <>
            <button onClick={() => setNuevo(false)} className="btn-secondary">Cancelar</button>
            <button onClick={() => crear.mutate()} disabled={crear.isPending} className="btn-primary">
              Crear y generar enlace
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="label">Nombre de la persona</label>
            <input className="input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="José Liz" />
          </div>
          <div>
            <label className="label">Nombre del negocio</label>
            <input className="input" value={empresa} onChange={(e) => setEmpresa(e.target.value)} placeholder="Distribuidora JLIZ" />
          </div>
          <p className="text-xs text-slate-500">
            Se genera un enlace único. Quien lo tenga puede responder sin cuenta ni contraseña, desde
            el teléfono o el computador, y todo se guarda automáticamente.
          </p>
          {crear.isError && <ErrorState error={crear.error} />}
        </div>
      </Modal>

      <Modal
        open={!!resultado}
        onClose={() => setResultado(null)}
        title="Importación al sistema"
        footer={<button onClick={() => setResultado(null)} className="btn-primary">Entendido</button>}
      >
        {resultado && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              {([
                ['Productos', resultado.productos],
                ['Clientes', resultado.clientes],
                ['Proveedores', resultado.proveedores],
                ['Rendimientos', resultado.rendimientos],
              ] as [string, number][]).map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{k}</p>
                  <p className="text-lg font-semibold text-slate-900">{v}</p>
                </div>
              ))}
            </div>
            {resultado.avisos?.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                <p className="mb-1 font-semibold">No se importaron:</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
            <p className="text-xs text-slate-500">
              Las filas ya importadas quedan marcadas: si el cliente agrega más, puedes volver a
              importar sin duplicar lo anterior.
            </p>
          </div>
        )}
      </Modal>

      {importar.isError && <div className="mt-3"><ErrorState error={importar.error} /></div>}

      {verId && sesionVista && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40">
          <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{sesionVista.client_name}</h3>
                <p className="text-xs text-slate-500">{sesionVista.business_name ?? 'Sin empresa'}</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => exportar(sesionVista, respuestas.data ?? {})}
                  className="btn-secondary px-3 py-1.5 text-xs"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </button>
                <button onClick={() => setVerId(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {respuestas.isLoading && <Skeleton className="h-40" />}
              {SURVEY.map((s) => (
                <div key={s.key} className="mb-5">
                  <h4 className="mb-2 text-xs font-semibold tracking-wide text-navy-700 uppercase">
                    {s.short}
                  </h4>
                  <div className="space-y-2">
                    {s.blocks.flatMap((b) => b.questions).map((q) => {
                      const r = respuestas.data?.[q.id]?.trim()
                      return (
                        <div key={q.id} className="rounded-lg border border-slate-100 p-3">
                          <p className="text-xs text-slate-500">
                            <span className="font-semibold text-slate-600">{q.id}</span> · {q.q}
                          </p>
                          <p className={`mt-1 text-sm ${r ? 'text-slate-900' : 'text-slate-300 italic'}`}>
                            {r || 'Sin responder'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Cargados({
  sessionId, onImportar, importando,
}: { sessionId: string; onImportar: () => void; importando: boolean }) {
  const { data } = useQuery({
    queryKey: ['intake-counts', sessionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('intake_rows')
        .select('kind, imported_at')
        .eq('session_id', sessionId)
      if (error) throw error
      const filas = data as { kind: string; imported_at: string | null }[]
      const porTipo: Record<string, number> = {}
      let pendientes = 0
      for (const f of filas) {
        porTipo[f.kind] = (porTipo[f.kind] ?? 0) + 1
        if (!f.imported_at) pendientes += 1
      }
      return { porTipo, pendientes, total: filas.length }
    },
  })

  if (!data || data.total === 0) return <span className="text-xs text-slate-400">Sin datos aún</span>

  return (
    <div className="space-y-1">
      <p className="text-xs text-slate-600">
        {Object.entries(data.porTipo).map(([k, v]) => `${v} ${k}`).join(' · ')}
      </p>
      {data.pendientes > 0 && (
        <button onClick={onImportar} disabled={importando} className="btn-accent px-2.5 py-1 text-xs">
          <Upload className="h-3 w-3" /> Importar {data.pendientes}
        </button>
      )}
    </div>
  )
}
