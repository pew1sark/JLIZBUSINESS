import { useState } from 'react'

export interface Orden<C extends string> {
  campo: C
  dir: 'asc' | 'desc'
}

/**
 * Orden por columna con un solo clic. La segunda vez sobre la misma columna
 * invierte el sentido; al cambiar de columna se parte por el sentido que más
 * se usa en esa columna: descendente para montos y fechas (lo más grande y lo
 * más reciente primero), ascendente para nombres.
 */
export function useOrden<C extends string>(inicial: C, dirInicial: 'asc' | 'desc' = 'desc') {
  const [orden, setOrden] = useState<Orden<C>>({ campo: inicial, dir: dirInicial })
  const cambiar = (campo: C, porDefecto: 'asc' | 'desc' = 'desc') =>
    setOrden((o) => (o.campo === campo
      ? { campo, dir: o.dir === 'asc' ? 'desc' : 'asc' }
      : { campo, dir: porDefecto }))
  return { orden, cambiar }
}

/**
 * Ordena por el valor que devuelva `valor`. Los nulos van siempre al final,
 * en los dos sentidos: una factura sin fecha de pago no es "la más antigua".
 */
export function ordenar<T, C extends string>(
  filas: T[],
  orden: Orden<C>,
  valor: (f: T, campo: C) => string | number | null | undefined,
): T[] {
  const signo = orden.dir === 'asc' ? 1 : -1
  return [...filas].sort((a, b) => {
    const va = valor(a, orden.campo)
    const vb = valor(b, orden.campo)
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * signo
    return String(va).localeCompare(String(vb), 'es') * signo
  })
}
