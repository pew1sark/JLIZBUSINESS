/**
 * Ubicación de clientes y navegación.
 *
 * La geocodificación usa Nominatim (OpenStreetMap): es gratuita y sin clave,
 * pero pide como máximo una consulta por segundo, así que el proceso avanza
 * cliente por cliente. La coordenada se guarda una sola vez en la base.
 */

export interface Coordenada {
  lat: number
  lng: number
}

export interface ResultadoGeo extends Coordenada {
  etiqueta: string
  precision: string
}

const ESPERA_MS = 1100

export async function geocodificar(
  direccion: string,
  comuna?: string | null,
): Promise<ResultadoGeo | null> {
  const consulta = [direccion, comuna, 'Chile'].filter(Boolean).join(', ')
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=cl&addressdetails=1&q=' +
    encodeURIComponent(consulta)

  const resp = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!resp.ok) throw new Error(`El servicio de mapas respondió ${resp.status}`)
  const datos = (await resp.json()) as {
    lat: string; lon: string; display_name: string; type?: string
  }[]
  if (!datos.length) return null

  return {
    lat: Number(datos[0].lat),
    lng: Number(datos[0].lon),
    etiqueta: datos[0].display_name,
    precision: datos[0].type ?? 'desconocida',
  }
}

/** Geocodifica una lista respetando el límite de una consulta por segundo. */
export async function geocodificarLista<T extends { id: string; address: string | null; comuna: string | null }>(
  items: T[],
  onAvance: (hecho: number, total: number, item: T, r: ResultadoGeo | null) => void,
) {
  let hecho = 0
  for (const item of items) {
    let r: ResultadoGeo | null = null
    try {
      if (item.address) r = await geocodificar(item.address, item.comuna)
    } catch {
      r = null
    }
    hecho += 1
    onAvance(hecho, items.length, item, r)
    if (hecho < items.length) await new Promise((res) => setTimeout(res, ESPERA_MS))
  }
}

/** Distancia en kilómetros entre dos puntos (fórmula del semiverseno). */
export function distanciaKm(a: Coordenada, b: Coordenada): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Ordena las paradas por cercanía partiendo de la bodega (vecino más próximo).
 * No es la ruta óptima perfecta, pero para una ruta de diez o quince paradas
 * deja un recorrido mucho mejor que el orden de llegada de los pedidos.
 */
export function ordenarPorCercania<T extends Coordenada>(origen: Coordenada, paradas: T[]): T[] {
  const pendientes = [...paradas]
  const ruta: T[] = []
  let actual = origen

  while (pendientes.length) {
    let mejor = 0
    let mejorDist = Infinity
    for (let i = 0; i < pendientes.length; i++) {
      const d = distanciaKm(actual, pendientes[i])
      if (d < mejorDist) {
        mejorDist = d
        mejor = i
      }
    }
    const elegida = pendientes.splice(mejor, 1)[0]
    ruta.push(elegida)
    actual = elegida
  }
  return ruta
}

export function kilometrosRuta(origen: Coordenada, paradas: Coordenada[]): number {
  let total = 0
  let actual = origen
  for (const p of paradas) {
    total += distanciaKm(actual, p)
    actual = p
  }
  return Math.round(total * 10) / 10
}

// ---------- Enlaces a las aplicaciones de navegación ----------

const esApple = () => /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)

export function urlWaze(c: Coordenada) {
  return `https://waze.com/ul?ll=${c.lat},${c.lng}&navigate=yes`
}

export function urlGoogleMaps(c: Coordenada) {
  return `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}&travelmode=driving`
}

export function urlAppleMaps(c: Coordenada) {
  return `https://maps.apple.com/?daddr=${c.lat},${c.lng}&dirflg=d`
}

/** Abre la app de mapas propia del teléfono. */
export function urlMapaNativo(c: Coordenada | null, direccion?: string | null, comuna?: string | null) {
  if (c) return esApple() ? urlAppleMaps(c) : urlGoogleMaps(c)
  const q = encodeURIComponent([direccion, comuna, 'Chile'].filter(Boolean).join(', '))
  return esApple()
    ? `https://maps.apple.com/?q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`
}

/** Ruta completa con paradas intermedias en Google Maps (hasta 9 waypoints). */
export function urlRutaCompleta(origen: Coordenada, paradas: Coordenada[]) {
  if (!paradas.length) return ''
  const destino = paradas[paradas.length - 1]
  const intermedias = paradas.slice(0, -1).slice(0, 9)
  const wp = intermedias.map((p) => `${p.lat},${p.lng}`).join('|')
  return (
    `https://www.google.com/maps/dir/?api=1&origin=${origen.lat},${origen.lng}` +
    `&destination=${destino.lat},${destino.lng}` +
    (wp ? `&waypoints=${encodeURIComponent(wp)}` : '') +
    '&travelmode=driving'
  )
}
