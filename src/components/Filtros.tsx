import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
 * Cuánto se espera a que el dedo se detenga antes de avisar el cambio. Corto
 * para que no se sienta pegado, largo para que escribir un año completo cuente
 * como un solo cambio.
 */
const ESPERA_TIPEO = 350

/**
 * Un campo de fecha que no dispara una consulta por cada tecla.
 *
 * `<input type="date">` avisa del cambio en cada edición intermedia: escribir
 * el año 2026 pasa por 0002, 0020, 0202 y 2026, y cada uno de esos valores
 * rehacía las cinco consultas del panel y los filtros en memoria de Cobranza y
 * Compras. Cuatro rondas de trabajo para tres fechas que no significaban nada.
 *
 * Lo que se ve en el campo es local; hacia arriba se avisa cuando el tipeo se
 * detiene, o al salir del campo, que es cuando la fecha ya está decidida.
 */
function CampoFecha({
  tipo, valor, onCommit, className, etiqueta,
}: {
  tipo: 'date' | 'month'
  valor: string
  onCommit: (v: string) => void
  className?: string
  etiqueta?: string
}) {
  const [texto, setTexto] = useState(valor)
  // El commit vive en una ref para que el temporizador no se reinicie cada vez
  // que el padre vuelve a crear la función.
  const commit = useRef(onCommit)
  commit.current = onCommit

  // Si el valor cambia desde afuera —«Limpiar», las flechas de mes, otro
  // preset— el campo tiene que seguirlo en vez de quedarse con lo tipeado.
  useEffect(() => { setTexto(valor) }, [valor])

  useEffect(() => {
    if (texto === valor) return
    const t = setTimeout(() => commit.current(texto), ESPERA_TIPEO)
    return () => clearTimeout(t)
  }, [texto, valor])

  return (
    <input
      type={tipo}
      className={className}
      value={texto}
      aria-label={etiqueta}
      onChange={(e) => setTexto(e.target.value)}
      // Salir del campo es una decisión tomada: no hay para qué esperar.
      onBlur={() => { if (texto !== valor) commit.current(texto) }}
    />
  )
}

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
          <CampoFecha tipo="month" className="input w-auto" valor={mes} etiqueta="Mes"
            onCommit={(v) => v && onChange(rangoDeMes(v))} />
          <button type="button" className="btn-secondary px-2 py-1" onClick={() => correrMes(1)}
            aria-label="Mes siguiente">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {valor.preset === 'personalizado' && (
        <>
          <CampoFecha tipo="date" className="input w-auto" valor={valor.desde ?? ''} etiqueta="Desde"
            onCommit={(v) => onChange({ ...valor, preset: 'personalizado', desde: v || null })} />
          <span className="text-xs text-slate-400">a</span>
          <CampoFecha tipo="date" className="input w-auto" valor={valor.hasta ?? ''} etiqueta="Hasta"
            onCommit={(v) => onChange({ ...valor, preset: 'personalizado', hasta: v || null })} />
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
