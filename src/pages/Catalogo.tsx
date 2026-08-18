import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { AlertCircle, Check, Fish, Loader2, Plus, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { CAMPOS_FIJOS, CAMPOS_VIAJE, SECCIONES, type Campo, type Seccion } from '../lib/intake'
import { money } from '../lib/format'

type Datos = Record<string, string>
interface Fila { id: string; kind: string; position: number; data: Datos }

export function Catalogo() {
  const { token = '' } = useParams()
  const [estado, setEstado] = useState<{ ok: boolean; error?: string; business_name?: string } | null>(null)
  const [filas, setFilas] = useState<Fila[]>([])
  const [seccion, setSeccion] = useState(0)
  const [guardando, setGuardando] = useState<Record<string, 'saving' | 'saved' | 'error'>>({})
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    supabase.rpc('intake_get', { _token: token }).then(({ data, error }) => {
      if (error) return setEstado({ ok: false, error: error.message })
      const d = data as { ok: boolean; error?: string; business_name?: string; rows?: Fila[] }
      setEstado(d)
      setFilas(d.rows ?? [])
    })
  }, [token])

  const sec = SECCIONES[seccion]
  const filasSeccion = useMemo(
    () => filas.filter((f) => f.kind === sec.kind).sort((a, b) => a.position - b.position),
    [filas, sec.kind],
  )

  async function guardar(fila: Fila) {
    setGuardando((g) => ({ ...g, [fila.id]: 'saving' }))
    const { data, error } = await supabase.rpc('intake_save_row', {
      _token: token,
      _kind: fila.kind,
      _row_id: fila.id.startsWith('nuevo-') ? null : fila.id,
      _data: fila.data,
      _position: fila.position,
    })
    const res = data as { ok?: boolean; id?: string } | null
    if (error || !res?.ok) {
      setGuardando((g) => ({ ...g, [fila.id]: 'error' }))
      return
    }
    if (fila.id.startsWith('nuevo-') && res.id) {
      setFilas((fs) => fs.map((f) => (f.id === fila.id ? { ...f, id: res.id! } : f)))
    }
    setGuardando((g) => ({ ...g, [fila.id]: 'saved' }))
    setTimeout(() => setGuardando((g) => ({ ...g, [fila.id]: undefined as never })), 1800)
  }

  function cambiar(fila: Fila, key: string, valor: string) {
    const nueva = { ...fila, data: { ...fila.data, [key]: valor } }
    // El rendimiento se calcula solo cuando hay kilos de entrada y salida
    if (fila.kind === 'rendimientos' && (key === 'kg_entrada' || key === 'kg_salida')) {
      const ent = Number(key === 'kg_entrada' ? valor : nueva.data.kg_entrada)
      const sal = Number(key === 'kg_salida' ? valor : nueva.data.kg_salida)
      if (ent > 0 && sal > 0) nueva.data.rendimiento_pct = String(Math.round((sal / ent) * 1000) / 10)
    }
    setFilas((fs) => fs.map((f) => (f.id === fila.id ? nueva : f)))
    clearTimeout(timers.current[fila.id])
    timers.current[fila.id] = setTimeout(() => guardar(nueva), 900)
  }

  function agregar() {
    const fila: Fila = {
      id: `nuevo-${Date.now()}`,
      kind: sec.kind,
      position: filasSeccion.length,
      data: {},
    }
    setFilas((fs) => [...fs, fila])
  }

  async function eliminar(fila: Fila) {
    setFilas((fs) => fs.filter((f) => f.id !== fila.id))
    if (!fila.id.startsWith('nuevo-')) {
      await supabase.rpc('intake_delete_row', { _token: token, _row_id: fila.id })
    }
  }

  // Una sección de ficha única (costos) siempre tiene exactamente una fila
  useEffect(() => {
    if (sec.filaUnica && filasSeccion.length === 0 && estado?.ok) {
      setFilas((fs) => [...fs, { id: `nuevo-${Date.now()}`, kind: sec.kind, position: 0, data: {} }])
    }
  }, [sec, filasSeccion.length, estado])

  if (!estado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <Loader2 className="h-6 w-6 animate-spin text-navy-500" />
      </div>
    )
  }

  if (!estado.ok) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-900 p-6">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
          <AlertCircle className="mx-auto mb-3 h-8 w-8 text-red-500" />
          <p className="font-semibold text-slate-900">Enlace no válido</p>
          <p className="mt-1 text-sm text-slate-500">{estado.error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="safe-top sticky top-0 z-20 border-b border-navy-800 bg-navy-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sea-500">
              <Fish className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">Catálogo y costos</p>
              <p className="truncate text-[11px] text-navy-300">{estado.business_name}</p>
            </div>
          </div>
        </div>
        <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4 pb-2">
          {SECCIONES.map((s, i) => {
            const n = filas.filter((f) => f.kind === s.kind && Object.values(f.data).some((v) => v?.trim())).length
            return (
              <button
                key={s.kind}
                onClick={() => { setSeccion(i); window.scrollTo({ top: 0 }) }}
                className={clsx(
                  'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  i === seccion ? 'bg-white text-navy-900' : 'bg-navy-800 text-navy-200 hover:bg-navy-700',
                )}
              >
                {s.titulo}{n > 0 && ` · ${n}`}
              </button>
            )
          })}
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-slate-900">{sec.titulo}</h1>
          <p className="mt-1 text-sm text-slate-500">{sec.intro}</p>
        </div>

        {sec.kind === 'costos' ? (
          <FichaCostos
            sec={sec}
            fila={filasSeccion[0]}
            onChange={cambiar}
            estado={filasSeccion[0] ? guardando[filasSeccion[0].id] : undefined}
          />
        ) : (
          <>
            <div className="space-y-3">
              {filasSeccion.map((fila, i) => (
                <div key={fila.id} className="card p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-400 uppercase">
                      {sec.etiquetaFila} {i + 1}
                    </span>
                    <div className="flex items-center gap-3">
                      <EstadoGuardado estado={guardando[fila.id]} />
                      <button
                        onClick={() => eliminar(fila)}
                        className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
                    {sec.campos.map((c) => (
                      <CampoInput key={c.key} campo={c} fila={fila} onChange={cambiar} />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <button onClick={agregar} className="btn-secondary mt-3 w-full">
              <Plus className="h-4 w-4" /> Agregar {sec.etiquetaFila}
            </button>
          </>
        )}

        <p className="mt-6 pb-10 text-center text-xs text-slate-400">
          Todo se guarda solo. Puedes cerrar y volver con el mismo enlace.
        </p>
      </main>
    </div>
  )
}

function anchoClase(ancho?: string) {
  if (ancho === 'lg') return 'col-span-2 sm:col-span-3'
  if (ancho === 'md') return 'col-span-2 sm:col-span-2'
  return 'col-span-1'
}

function CampoInput({
  campo, fila, onChange,
}: { campo: Campo; fila: Fila; onChange: (f: Fila, k: string, v: string) => void }) {
  const valor = fila.data[campo.key] ?? ''
  return (
    <div className={anchoClase(campo.ancho)}>
      <label className="label">{campo.label}</label>
      {campo.tipo === 'select' ? (
        <select className="input" value={valor} onChange={(e) => onChange(fila, campo.key, e.target.value)}>
          <option value="">—</option>
          {campo.opciones?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : campo.tipo === 'area' ? (
        <textarea className="input" rows={2} value={valor} onChange={(e) => onChange(fila, campo.key, e.target.value)} />
      ) : (
        <input
          className="input"
          type={campo.tipo === 'texto' ? 'text' : 'number'}
          inputMode={campo.tipo === 'texto' ? undefined : 'decimal'}
          step={campo.tipo === 'dinero' ? '1' : '0.001'}
          value={valor}
          placeholder={campo.placeholder}
          onChange={(e) => onChange(fila, campo.key, e.target.value)}
        />
      )}
      {campo.ayuda && <p className="mt-0.5 text-[11px] text-slate-400">{campo.ayuda}</p>}
    </div>
  )
}

function EstadoGuardado({ estado }: { estado?: 'saving' | 'saved' | 'error' }) {
  if (!estado) return null
  if (estado === 'saving') return <span className="text-[11px] text-slate-400">Guardando…</span>
  if (estado === 'saved')
    return (
      <span className="flex items-center gap-1 text-[11px] text-emerald-600">
        <Check className="h-3 w-3" /> Guardado
      </span>
    )
  return <span className="text-[11px] text-red-600">No se pudo guardar</span>
}

function FichaCostos({
  sec, fila, onChange, estado,
}: {
  sec: Seccion
  fila?: Fila
  onChange: (f: Fila, k: string, v: string) => void
  estado?: 'saving' | 'saved' | 'error'
}) {
  if (!fila) return null
  const n = (k: string) => Number(fila.data[k] ?? 0) || 0
  const porViaje = CAMPOS_VIAJE.reduce((s, k) => s + n(k), 0)
  const fijos = CAMPOS_FIJOS.reduce((s, k) => s + n(k), 0)
  const viajesMes = n('viajes_semana') * 4.33
  const kilosMes = n('kilos_por_viaje') * viajesMes
  const costoPorKilo = kilosMes > 0 ? (porViaje * viajesMes) / kilosMes : 0

  return (
    <>
      {sec.grupos?.map((g) => (
        <div key={g.titulo} className="card mb-3 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xs font-semibold tracking-wide text-navy-700 uppercase">{g.titulo}</h2>
            <EstadoGuardado estado={estado} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {g.campos.map((k) => {
              const campo = sec.campos.find((c) => c.key === k)!
              return <CampoInput key={k} campo={campo} fila={fila} onChange={onChange} />
            })}
          </div>
        </div>
      ))}

      <div className="card bg-navy-50 p-4 text-sm">
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-navy-800 uppercase">
          Lo que se calcula con esto
        </h3>
        <div className="space-y-1 text-navy-900">
          <p className="flex justify-between">
            <span>Costo de cada viaje</span>
            <strong className="tabular-nums">{money(porViaje)}</strong>
          </p>
          <p className="flex justify-between">
            <span>Costos fijos del mes</span>
            <strong className="tabular-nums">{money(fijos)}</strong>
          </p>
          {kilosMes > 0 && (
            <>
              <p className="flex justify-between">
                <span>Kilos comprados al mes (estimado)</span>
                <strong className="tabular-nums">{Math.round(kilosMes)} kg</strong>
              </p>
              <p className="flex justify-between border-t border-navy-200 pt-1">
                <span>Costo de traslado por kilo</span>
                <strong className="tabular-nums">{money(costoPorKilo)}</strong>
              </p>
              <p className="flex justify-between">
                <span>Costo fijo por kilo</span>
                <strong className="tabular-nums">{money(kilosMes > 0 ? fijos / kilosMes : 0)}</strong>
              </p>
            </>
          )}
        </div>
        <p className="mt-2 text-xs text-navy-700/80">
          El costo de traslado se suma al precio del proveedor para obtener el costo real de cada kilo.
          El costo fijo por kilo es lo que hay que cubrir antes de empezar a ganar.
        </p>
      </div>
    </>
  )
}
