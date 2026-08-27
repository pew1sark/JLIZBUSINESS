import { useEffect, useRef, type ReactNode } from 'react'
import { AlertCircle, ChevronRight, Inbox, Loader2, X } from 'lucide-react'
import clsx from 'clsx'
import { Link } from 'react-router-dom'

/**
 * El sello de la empresa. Se sirve desde `public/` en vez de inlinearse en el
 * bundle: son 40 KB de trazados que el navegador cachea una vez y no vuelve a
 * descargar en cada despliegue de la aplicación.
 *
 * El logo trae su propio anillo oscuro, así que sobre el azul de la barra
 * lateral se le pone un aro claro (`ring`) para que no se funda con el fondo.
 */
export function Logo({ className, ring }: { className?: string; ring?: boolean }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logo.svg`}
      alt="Bilagay · Pesca y Recolección"
      className={clsx('shrink-0 rounded-full object-contain', ring && 'ring-2 ring-white/15', className)}
    />
  )
}

export function PageHeader({
  title, subtitle, actions,
}: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('card', className)}>{children}</div>
}

export function CardHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
      <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
      {action}
    </div>
  )
}

/**
 * Un número del panel. Con `to`, la tarjeta entera lleva a la pantalla donde
 * ese número se explica: ver "Vencido $4M" y no poder pinchar para saber de
 * quién es obliga a buscarlo a mano en otra pantalla.
 */
export function StatCard({
  label, value, hint, icon, tone = 'default', to,
}: {
  label: string
  value: string
  hint?: string
  icon?: ReactNode
  tone?: 'default' | 'positive' | 'warning' | 'danger'
  to?: string
}) {
  const tones = {
    default: 'text-slate-900',
    positive: 'text-emerald-600',
    warning: 'text-amber-600',
    danger: 'text-red-600',
  }
  const cuerpo = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
        {icon && <span className="text-slate-300 group-hover:text-sea-500">{icon}</span>}
      </div>
      {/* Un total exacto como $349.752.798 no cabe y se corta: el tamaño baja
          según el largo en vez de redondear el número. En el teléfono la
          tarjeta mide la mitad, así que arranca un escalón más abajo. */}
      <p className={clsx('mt-2 font-semibold tabular-nums', tones[tone],
        value.length > 13 ? 'text-base sm:text-lg'
        : value.length > 10 ? 'text-lg sm:text-xl'
        : 'text-xl sm:text-2xl')}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </>
  )

  if (!to) return <div className="card p-4">{cuerpo}</div>

  return (
    <Link to={to}
      className="card group block p-4 transition hover:border-sea-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-sea-400 focus-visible:outline-none">
      {cuerpo}
      <span className="mt-1 inline-flex items-center gap-0.5 text-[11px] font-medium text-sea-600 opacity-0 transition group-hover:opacity-100">
        Ver detalle <ChevronRight className="h-3 w-3" />
      </span>
    </Link>
  )
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('badge', className ?? 'bg-slate-100 text-slate-700')}>{children}</span>
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label ?? 'Cargando…'}
    </div>
  )
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 text-slate-300">{icon ?? <Inbox className="h-8 w-8" />}</div>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-slate-400">{hint}</p>}
    </div>
  )
}

export function ErrorState({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">No se pudo cargar la información</p>
        <p className="mt-0.5 text-red-600/80">{msg}</p>
      </div>
    </div>
  )
}

export function Modal({
  open, onClose, title, children, footer, wide,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  if (!open) return null
  return (
    // z-[1100] deja el modal por sobre cualquier capa de Leaflet, que llega a 1000.
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div
        className={clsx(
          'flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200">{children}</table>
      </div>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded bg-slate-200', className)} />
}

/** Marca visible para funcionalidad planificada pero aún no conectada al backend. */
export function PhaseNotice({ phase, children }: { phase: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-navy-300 bg-navy-50 p-5 text-sm text-navy-800">
      <p className="mb-1 font-semibold">Módulo planificado · {phase}</p>
      <p className="text-navy-700/80">{children}</p>
    </div>
  )
}

/**
 * Pestañas. En escritorio se reparten en una fila; en el teléfono la fila se
 * desliza en horizontal en vez de apretujarse o cortarse, y la pestaña activa
 * se trae a la vista sola. Cobranza llegó a tener seis y en un teléfono no
 * cabían de ninguna forma.
 */
export function Pestanas<T extends string>({
  valor, onChange, opciones, className,
}: {
  valor: T
  onChange: (v: T) => void
  opciones: { id: T; label: string; badge?: string | number }[]
  className?: string
}) {
  const activa = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activa.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [valor])

  return (
    <div className={clsx(
      // `snap` deja la pestaña alineada al soltar el dedo; sin la barra visible
      // porque estorba en una fila de 40 px de alto.
      'no-scrollbar -mx-1 flex snap-x gap-1 overflow-x-auto rounded-lg bg-slate-200/60 p-1 text-sm',
      'sm:mx-0 sm:w-fit sm:overflow-visible',
      className,
    )}>
      {opciones.map((o) => (
        <button
          key={o.id}
          ref={o.id === valor ? activa : undefined}
          onClick={() => onChange(o.id)}
          className={clsx(
            'shrink-0 snap-start rounded-md px-3 py-2 font-medium whitespace-nowrap transition-colors sm:px-4 sm:py-1.5',
            o.id === valor ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {o.label}
          {o.badge !== undefined && o.badge !== '' && (
            <span className={clsx('ml-1.5 rounded-full px-1.5 py-0.5 text-[11px]',
              o.id === valor ? 'bg-slate-100 text-slate-600' : 'bg-slate-300/60 text-slate-600')}>
              {o.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
