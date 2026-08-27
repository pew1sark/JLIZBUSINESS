// Rangos de fecha para filtrar listados. Vive fuera del componente para que
// se pueda reutilizar desde cualquier pantalla sin arrastrar React.
/** Rangos que se usan de verdad al revisar ventas o compras. */
export type Preset =
  | 'hoy' | 'ayer' | 'semana' | 'semana_pasada' | 'ultimos7'
  | 'mes' | 'mes_pasado' | 'ultimos30' | 'anio' | 'mes_elegido'
  | 'todo' | 'personalizado'

export interface Periodo {
  preset: Preset
  desde: string | null   // YYYY-MM-DD
  hasta: string | null
  /** Solo para 'mes_elegido': el mes seleccionado, en formato YYYY-MM. */
  mes?: string | null
}

const iso = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return z.toISOString().slice(0, 10)
}
const sumar = (d: Date, dias: number) => new Date(d.getTime() + dias * 86400000)

/** Lunes como primer día, que es como se lee una semana comercial en Chile. */
const lunesDe = (d: Date) => {
  const x = new Date(d)
  const dia = (x.getDay() + 6) % 7
  x.setDate(x.getDate() - dia)
  x.setHours(0, 0, 0, 0)
  return x
}

/** Primer y último día de un mes escrito como 'YYYY-MM'. */
export function rangoDeMes(mes: string): Periodo {
  const [a, m] = mes.split('-').map(Number)
  if (!a || !m) return { preset: 'mes_elegido', desde: null, hasta: null, mes: null }
  return {
    preset: 'mes_elegido',
    desde: iso(new Date(a, m - 1, 1)),
    hasta: iso(new Date(a, m, 0)),   // día 0 del mes siguiente = último del mes
    mes,
  }
}

/** 'YYYY-MM' del mes en curso, que es lo que se ofrece por defecto al elegir mes. */
export const mesActual = () => iso(new Date()).slice(0, 7)

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

/** '2026-03' -> 'marzo 2026'. Se lee mejor que la fecha ISO en un selector. */
export function nombreMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number)
  if (!a || !m) return mes
  return `${MESES[m - 1]} ${a}`
}

export function rangoDe(preset: Preset, desde?: string | null, hasta?: string | null): Periodo {
  const hoy = new Date()
  hoy.setHours(0, 0, 0, 0)
  const r = (a: Date | null, b: Date | null): Periodo =>
    ({ preset, desde: a ? iso(a) : null, hasta: b ? iso(b) : null })

  switch (preset) {
    case 'hoy':            return r(hoy, hoy)
    case 'ayer':           return r(sumar(hoy, -1), sumar(hoy, -1))
    case 'semana':         return r(lunesDe(hoy), hoy)
    case 'semana_pasada': {
      const l = sumar(lunesDe(hoy), -7)
      return r(l, sumar(l, 6))
    }
    case 'ultimos7':       return r(sumar(hoy, -6), hoy)
    case 'ultimos30':      return r(sumar(hoy, -29), hoy)
    case 'mes':            return r(new Date(hoy.getFullYear(), hoy.getMonth(), 1), hoy)
    case 'mes_pasado': {
      const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)
      return r(ini, new Date(hoy.getFullYear(), hoy.getMonth(), 0))
    }
    case 'anio':           return r(new Date(hoy.getFullYear(), 0, 1), hoy)
    // El mes elegido llega como 'desde' (YYYY-MM o YYYY-MM-DD): se toma el mes de esa fecha.
    case 'mes_elegido':    return rangoDeMes((desde ?? iso(hoy)).slice(0, 7))
    case 'personalizado':  return { preset, desde: desde ?? null, hasta: hasta ?? null }
    default:               return r(null, null)
  }
}

