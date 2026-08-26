// Rangos de fecha para filtrar listados. Vive fuera del componente para que
// se pueda reutilizar desde cualquier pantalla sin arrastrar React.
/** Rangos que se usan de verdad al revisar ventas o compras. */
export type Preset =
  | 'hoy' | 'ayer' | 'semana' | 'semana_pasada' | 'ultimos7'
  | 'mes' | 'mes_pasado' | 'ultimos30' | 'todo' | 'personalizado'

export interface Periodo {
  preset: Preset
  desde: string | null   // YYYY-MM-DD
  hasta: string | null
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
    case 'personalizado':  return { preset, desde: desde ?? null, hasta: hasta ?? null }
    default:               return r(null, null)
  }
}

