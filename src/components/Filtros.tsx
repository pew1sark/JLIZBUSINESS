import { useMemo, type ReactNode } from 'react'
import { ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { mesActual, nombreMes, rangoDe, rangoDeMes, type Periodo, type Preset } from '../lib/periodo'
import type { Orden } from '../lib/orden'

const ETIQUETA: Record<Preset, string> = {
  hoy: 'Hoy', ayer: 'Ayer', semana: 'Esta semana', semana_pasada: 'Semana pasada',
  ultimos7: 'Últimos 7 días', mes: 'Este mes', mes_pasado: 'Mes pasado',
  ultimos30: 'Últimos 30 días', anio: 'Este año', mes_elegido: 'Elegir mes…',
  todo: 'Todo', personalizado: 'Personalizado',
}

const ORDEN: Preset[] = [
  'hoy', 'ayer', 'ultimos7', 'semana', 'semana_pasada',
  'mes', 'mes_pasado', 'mes_elegido', 'ultimos30', 'anio', 'todo',
]

/**
 * Rango de fechas de un listado. Aparte de los atajos, `mes_elegido` deja
 * saltar a cualquier mes cerrado: revisar marzo en septiembre es lo normal
 * cuando llega el contador, y con «mes pasado» solo se alcanzaba uno atrás.
 */
export function FiltroPeriodo({
  valor, onChange,
}: { valor: Periodo; onChange: (p: Periodo) => void }) {
  const mes = valor.mes ?? valor.desde?.slice(0, 7) ?? mesActual()

  /** Mes anterior o siguiente sin abrir el selector: es el gesto más repetido. */
  function correrMes(paso: number) {
    const [a, m] = mes.split('-').map(Number)
    const d = new Date(a, m - 1 + paso, 1)
    onChange(rangoDeMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`))
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        className="input w-auto"
        value={valor.preset}
        onChange={(e) => {
          const p = e.target.value as Preset
          onChange(p === 'mes_elegido' ? rangoDeMes(mes) : rangoDe(p, valor.desde, valor.hasta))
        }}
      >
        {ORDEN.map((p) => <option key={p} value={p}>{ETIQUETA[p]}</option>)}
        <option value="personalizado">{ETIQUETA.personalizado}</option>
      </select>

      {valor.preset === 'mes_elegido' && (
        <div className="flex items-center gap-1">
          <button type="button" className="btn-secondary px-2 py-1" onClick={() => correrMes(-1)}
            aria-label="Mes anterior">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input type="month" className="input w-auto" value={mes}
            onChange={(e) => e.target.value && onChange(rangoDeMes(e.target.value))} />
          <button type="button" className="btn-secondary px-2 py-1" onClick={() => correrMes(1)}
            aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {valor.preset === 'personalizado' && (
        <>
          <input type="date" className="input w-auto" value={valor.desde ?? ''}
            onChange={(e) => onChange({ ...valor, preset: 'personalizado', desde: e.target.value || null })} />
          <span className="text-xs text-slate-400">a</span>
          <input type="date" className="input w-auto" value={valor.hasta ?? ''}
            onChange={(e) => onChange({ ...valor, preset: 'personalizado', hasta: e.target.value || null })} />
        </>
      )}

      {valor.preset === 'mes_elegido' && (
        <span className="text-xs font-medium text-slate-500 capitalize">{nombreMes(mes)}</span>
      )}

      {valor.preset !== 'personalizado' && valor.preset !== 'mes_elegido' && valor.desde && (
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

// ------------------------------------------------- encabezado que ordena
/** Encabezado de columna que ordena al hacer clic. */
export function ThOrden<C extends string>({
  campo, orden, onOrden, children, className, porDefecto = 'desc',
}: {
  campo: C
  orden: Orden<C>
  onOrden: (campo: C, porDefecto?: 'asc' | 'desc') => void
  children: ReactNode
  className?: string
  porDefecto?: 'asc' | 'desc'
}) {
  const activa = orden.campo === campo
  return (
    <th className={clsx('th', className)}>
      <button type="button" onClick={() => onOrden(campo, porDefecto)}
        className={clsx('inline-flex items-center gap-1 hover:text-navy-900',
          activa ? 'font-semibold text-navy-900' : 'text-inherit')}>
        {children}
        <ArrowUpDown className={clsx('h-3 w-3', activa ? 'opacity-80' : 'opacity-25')} />
        {activa && <span className="sr-only">{orden.dir === 'asc' ? 'ascendente' : 'descendente'}</span>}
      </button>
    </th>
  )
}
