import { useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { rangoDe, type Periodo, type Preset } from '../lib/periodo'

const ETIQUETA: Record<Preset, string> = {
  hoy: 'Hoy', ayer: 'Ayer', semana: 'Esta semana', semana_pasada: 'Semana pasada',
  ultimos7: 'Últimos 7 días', mes: 'Este mes', mes_pasado: 'Mes pasado',
  ultimos30: 'Últimos 30 días', todo: 'Todo', personalizado: 'Personalizado',
}

const ORDEN: Preset[] = ['hoy', 'ayer', 'ultimos7', 'semana', 'semana_pasada', 'mes', 'mes_pasado', 'ultimos30', 'todo']

export function FiltroPeriodo({
  valor, onChange,
}: { valor: Periodo; onChange: (p: Periodo) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input w-auto"
        value={valor.preset}
        onChange={(e) => onChange(rangoDe(e.target.value as Preset, valor.desde, valor.hasta))}
      >
        {ORDEN.map((p) => <option key={p} value={p}>{ETIQUETA[p]}</option>)}
        <option value="personalizado">{ETIQUETA.personalizado}</option>
      </select>

      {valor.preset === 'personalizado' && (
        <>
          <input type="date" className="input w-auto" value={valor.desde ?? ''}
            onChange={(e) => onChange({ ...valor, preset: 'personalizado', desde: e.target.value || null })} />
          <span className="text-xs text-slate-400">a</span>
          <input type="date" className="input w-auto" value={valor.hasta ?? ''}
            onChange={(e) => onChange({ ...valor, preset: 'personalizado', hasta: e.target.value || null })} />
        </>
      )}

      {valor.preset !== 'personalizado' && valor.desde && (
        <span className="text-xs text-slate-400">
          {valor.desde === valor.hasta ? valor.desde : `${valor.desde} a ${valor.hasta}`}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- paginación
export function Paginador({
  total, pagina, porPagina, onPagina, onPorPagina,
}: {
  total: number
  pagina: number
  porPagina: number
  onPagina: (p: number) => void
  onPorPagina: (n: number) => void
}) {
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  const desde = total === 0 ? 0 : pagina * porPagina + 1
  const hasta = Math.min((pagina + 1) * porPagina, total)

  // Ventana corta alrededor de la página actual: con 700 documentos no
  // sirve de nada pintar 30 botones.
  const numeros = useMemo(() => {
    const out: number[] = []
    const ini = Math.max(0, Math.min(pagina - 2, paginas - 5))
    for (let i = ini; i < Math.min(paginas, ini + 5); i++) out.push(i)
    return out
  }, [pagina, paginas])

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-sm">
      <span className="text-slate-500">
        {total === 0 ? 'Sin resultados' : `${desde}–${hasta} de ${total}`}
      </span>

      <div className="flex items-center gap-1">
        <button className="btn-secondary px-2 py-1" disabled={pagina === 0}
          onClick={() => onPagina(pagina - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </button>
        {numeros.map((n) => (
          <button key={n} onClick={() => onPagina(n)}
            className={clsx('min-w-8 rounded-lg px-2 py-1 text-sm',
              n === pagina ? 'bg-navy-900 font-medium text-white' : 'text-slate-600 hover:bg-slate-100')}>
            {n + 1}
          </button>
        ))}
        <button className="btn-secondary px-2 py-1" disabled={pagina >= paginas - 1}
          onClick={() => onPagina(pagina + 1)} aria-label="Página siguiente">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <select className="input w-auto py-1 text-xs" value={porPagina}
        onChange={(e) => { onPorPagina(Number(e.target.value)); onPagina(0) }}>
        {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} por página</option>)}
      </select>
    </div>
  )
}
