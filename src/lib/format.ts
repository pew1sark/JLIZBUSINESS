const clp = new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0,
})

const num = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 })

export const money = (v: number | null | undefined) => clp.format(Number(v ?? 0))

export const moneyShort = (v: number | null | undefined) => {
  const n = Number(v ?? 0)
  if (Math.abs(n) >= 1_000_000) return `$${num.format(Math.round(n / 100_000) / 10)}M`
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1000)}K`
  return clp.format(n)
}

export const kg = (v: number | null | undefined, unit = 'kg') =>
  `${num.format(Number(v ?? 0))} ${unit}`

export const pct = (v: number | null | undefined) => `${num.format(Number(v ?? 0))}%`

export const margin = (total: number, cost: number) =>
  total > 0 ? Math.round(((total - cost) / total) * 1000) / 10 : 0

export const dateShort = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—'

export const dateLong = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'

export const dateTime = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString('es-CL', {
        day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    : '—'

export const timeOnly = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—'

export const relative = (v: string | null | undefined) => {
  if (!v) return '—'
  const diff = Date.now() - new Date(v).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'hace instantes'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  if (d < 30) return `hace ${d} d`
  return dateShort(v)
}

export const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('')
