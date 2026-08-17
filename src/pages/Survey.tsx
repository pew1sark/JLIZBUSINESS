import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, Check, CheckCircle2, Fish, Loader2, Send } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { SURVEY, TOTAL_QUESTIONS, type SurveyQuestion } from '../lib/survey'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface SurveyData {
  ok: boolean
  error?: string
  client_name?: string
  business_name?: string | null
  status?: 'abierta' | 'cerrada'
  submitted_at?: string | null
  answers?: Record<string, string>
}

export function Survey() {
  const { token = '' } = useParams()
  const [data, setData] = useState<SurveyData | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [saveState, setSaveState] = useState<Record<string, SaveState>>({})
  const [section, setSection] = useState(0)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    supabase.rpc('survey_get', { _token: token }).then(({ data, error }) => {
      if (error) {
        setData({ ok: false, error: error.message })
        return
      }
      const d = data as SurveyData
      setData(d)
      setAnswers(d.answers ?? {})
      setSent(!!d.submitted_at)
    })
  }, [token])

  const save = useCallback(
    (id: string, value: string) => {
      setSaveState((s) => ({ ...s, [id]: 'saving' }))
      supabase
        .rpc('survey_save', { _token: token, _question_id: id, _answer: value })
        .then(({ data, error }) => {
          const ok = !error && (data as { ok?: boolean })?.ok
          setSaveState((s) => ({ ...s, [id]: ok ? 'saved' : 'error' }))
          if (ok) setTimeout(() => setSaveState((s) => ({ ...s, [id]: 'idle' })), 2000)
        })
    },
    [token],
  )

  function onChange(id: string, value: string) {
    setAnswers((a) => ({ ...a, [id]: value }))
    clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(() => save(id, value), 800)
  }

  const answered = useMemo(
    () => Object.values(answers).filter((v) => v.trim().length > 0).length,
    [answers],
  )

  const answeredBySection = useMemo(
    () =>
      SURVEY.map(
        (s) =>
          s.blocks
            .flatMap((b) => b.questions)
            .filter((q) => (answers[q.id] ?? '').trim().length > 0).length,
      ),
    [answers],
  )

  async function enviar() {
    setSending(true)
    await supabase.rpc('survey_submit', { _token: token })
    setSending(false)
    setSent(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <Loader2 className="h-6 w-6 animate-spin text-navy-500" />
      </div>
    )
  }

  if (!data.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-900 p-6">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-500" />
          <p className="font-semibold text-slate-900">Enlace no válido</p>
          <p className="mt-1 text-sm text-slate-500">
            {data.error ?? 'Pide un enlace nuevo a quien te envió este formulario.'}
          </p>
        </div>
      </div>
    )
  }

  const sec = SURVEY[section]
  const pct = Math.round((answered / TOTAL_QUESTIONS) * 100)

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="safe-top sticky top-0 z-20 border-b border-navy-800 bg-navy-900 text-white">
        <div className="mx-auto max-w-3xl px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sea-500">
              <Fish className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Levantamiento del negocio</p>
              <p className="truncate text-[11px] text-navy-300">
                {data.business_name || data.client_name}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold tabular-nums">{pct}%</p>
              <p className="text-[11px] text-navy-300">
                {answered}/{TOTAL_QUESTIONS}
              </p>
            </div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-navy-800">
            <div className="h-full bg-sea-400 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="mx-auto flex max-w-3xl gap-1 overflow-x-auto px-4 pb-2">
          {SURVEY.map((s, i) => {
            const total = s.blocks.reduce((n, b) => n + b.questions.length, 0)
            const done = answeredBySection[i] === total
            return (
              <button
                key={s.key}
                onClick={() => {
                  setSection(i)
                  window.scrollTo({ top: 0 })
                }}
                className={clsx(
                  'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  i === section ? 'bg-white text-navy-900' : 'bg-navy-800 text-navy-200 hover:bg-navy-700',
                )}
              >
                {done && <Check className="h-3 w-3 text-emerald-500" />}
                {s.key} · {answeredBySection[i]}/{total}
              </button>
            )
          })}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        {sent && (
          <div className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <div className="text-sm text-emerald-800">
              <p className="font-semibold">Respuestas enviadas. ¡Gracias!</p>
              <p className="text-emerald-700/80">
                Puedes seguir editando o completando lo que falte: todo se guarda automáticamente.
              </p>
            </div>
          </div>
        )}

        <div className="mb-5">
          <h1 className="text-lg font-semibold text-slate-900">{sec.title}</h1>
          <p className="mt-1 text-sm text-slate-500">{sec.intro}</p>
        </div>

        {sec.blocks.map((block) => (
          <section key={block.title} className="mb-6">
            <h2 className="mb-2 text-xs font-semibold tracking-wide text-navy-700 uppercase">
              {block.title}
            </h2>
            <div className="space-y-3">
              {block.questions.map((q) => (
                <QuestionCard
                  key={q.id}
                  q={q}
                  value={answers[q.id] ?? ''}
                  state={saveState[q.id] ?? 'idle'}
                  onChange={(v) => onChange(q.id, v)}
                  onBlur={() => {
                    clearTimeout(timers.current[q.id])
                    save(q.id, answers[q.id] ?? '')
                  }}
                />
              ))}
            </div>
          </section>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <button
            disabled={section === 0}
            onClick={() => {
              setSection((s) => s - 1)
              window.scrollTo({ top: 0 })
            }}
            className="btn-secondary"
          >
            Anterior
          </button>

          {section < SURVEY.length - 1 ? (
            <button
              onClick={() => {
                setSection((s) => s + 1)
                window.scrollTo({ top: 0 })
              }}
              className="btn-primary"
            >
              Siguiente sección
            </button>
          ) : (
            <button onClick={enviar} disabled={sending} className="btn-accent">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar respuestas
            </button>
          )}
        </div>

        <p className="mt-6 pb-10 text-center text-xs text-slate-400">
          Todo se guarda solo, a medida que escribes. Puedes cerrar y volver con el mismo enlace.
          <br />
          Si una pregunta no aplica a tu negocio, escribe «no aplica».
        </p>
      </main>
    </div>
  )
}

function QuestionCard({
  q, value, state, onChange, onBlur,
}: {
  q: SurveyQuestion
  value: string
  state: SaveState
  onChange: (v: string) => void
  onBlur: () => void
}) {
  const blocking = q.priority.toLowerCase().includes('bloqueante')
  return (
    <div className="card p-4">
      <div className="mb-1.5 flex items-start gap-2">
        <span className="mt-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">
          {q.id}
        </span>
        <p className="flex-1 text-sm font-medium text-slate-900">{q.q}</p>
        {blocking && (
          <span className="badge shrink-0 bg-amber-100 text-amber-800">Clave</span>
        )}
      </div>
      <p className="mb-2 pl-9 text-xs text-slate-400">{q.why}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        rows={2}
        placeholder={`Ej: ${q.example}`}
        className="input resize-y text-sm"
      />
      <div className="mt-1 flex h-4 items-center justify-end text-[11px]">
        {state === 'saving' && <span className="text-slate-400">Guardando…</span>}
        {state === 'saved' && (
          <span className="flex items-center gap-1 text-emerald-600">
            <Check className="h-3 w-3" /> Guardado
          </span>
        )}
        {state === 'error' && (
          <span className="flex items-center gap-1 text-red-600">
            <AlertCircle className="h-3 w-3" /> No se pudo guardar
          </span>
        )}
      </div>
    </div>
  )
}
