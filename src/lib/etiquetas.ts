/**
 * Las cuatro etiquetas de color de una factura.
 *
 * Son pocas y fijas a propósito: una lista que cada quien puede ampliar termina
 * con quince colores que nadie recuerda qué significan. Estas cubren el ciclo de
 * una revisión —hay que mirarla, está mala, se pidió algo y falta respuesta, ya
 * se revisó— y con eso alcanza.
 *
 * Viven acá y no junto al componente porque `ETIQUETAS` se usa desde las
 * pantallas para armar los filtros, y exportar constantes desde un archivo de
 * componentes rompe el refresco en caliente.
 */
export const ETIQUETAS = {
  revisar:   { label: 'Por corroborar',      punto: 'bg-amber-500',   chip: 'bg-amber-100 text-amber-800' },
  problema:  { label: 'Con problema',        punto: 'bg-red-500',     chip: 'bg-red-100 text-red-800' },
  esperando: { label: 'Esperando al cliente', punto: 'bg-sky-500',    chip: 'bg-sky-100 text-sky-800' },
  lista:     { label: 'Revisada',            punto: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-800' },
} as const

export type Etiqueta = keyof typeof ETIQUETAS
