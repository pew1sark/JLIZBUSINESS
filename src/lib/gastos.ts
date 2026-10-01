// Gastos que se ingresan a mano: sueldos, fijos, variables e insumos/caja chica.
// Las categorías viven acá y no en una tabla: son pocas, cambian poco y así el
// formulario y el panel se arman sin otra consulta. Si alguien escribe una
// categoría que no está en la lista se guarda igual y aparece en el panel.

import type { Periodo } from './periodo'

export type GrupoGasto = 'fijo' | 'variable' | 'insumos'
export type TipoAbono = 'sueldo_final' | 'cotizaciones' | 'quincena' | 'anticipo' | 'bono' | 'otro'

export interface Trabajador {
  id: string
  nombre: string
  rut: string | null
  cargo: string | null
  telefono: string | null
  fecha_ingreso: string | null
  sueldo_base: number
  afp: string | null
  salud: string | null
  banco: string | null
  cuenta: string | null
  activo: boolean
  orden: number
  notas: string | null
}

export interface Abono {
  id: string
  trabajador_id: string
  periodo: string        // YYYY-MM-01
  tipo: TipoAbono
  monto: number
  fecha_pago: string
  metodo: string
  detalle: string | null
}

export interface GastoManual {
  id: string
  fecha: string
  hora: string | null    // HH:MM:SS
  grupo: GrupoGasto
  categoria: string
  detalle: string | null
  monto: number
  metodo: string
  lugar: string | null
  trabajador_id: string | null
}

export const GRUPO_LABEL: Record<GrupoGasto, string> = {
  fijo: 'Gastos fijos',
  variable: 'Gastos variables',
  insumos: 'Insumos y caja chica',
}

export const CATEGORIAS: Record<GrupoGasto, string[]> = {
  fijo: ['Autopista (TAG)', 'Seguros', 'Arriendo', 'Luz, agua y gas', 'Teléfono e internet', 'Otro gasto fijo'],
  variable: ['Lavado camioneta', 'Arreglo camioneta', 'Combustible', 'Multas y permisos', 'Otro gasto variable'],
  insumos: [
    'Colaciones trabajadores', 'Fileteo', 'Hielo',
    'Entrada terminal pesquero', 'Estacionamiento terminal pesquero', 'Otros estacionamientos',
    'Bolsas', 'Otro insumo',
  ],
}

export const TIPO_ABONO_LABEL: Record<TipoAbono, string> = {
  sueldo_final: 'Sueldo final',
  cotizaciones: 'Cotizaciones',
  quincena: 'Quincena',
  anticipo: 'Anticipo',
  bono: 'Bono',
  otro: 'Otro abono',
}
export const TIPOS_ABONO = Object.keys(TIPO_ABONO_LABEL) as TipoAbono[]

export const METODOS = ['efectivo', 'caja_chica', 'transferencia', 'tarjeta', 'cheque', 'otro'] as const
export const METODO_LABEL: Record<string, string> = {
  efectivo: 'Efectivo',
  caja_chica: 'Caja chica',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  cheque: 'Cheque',
  otro: 'Otro',
}

/**
 * Un color por grupo, en el orden fijo de la paleta categórica validada. El
 * color sigue al grupo: filtrar no repinta los que quedan.
 */
export const COLOR_GRUPO = {
  sueldos: '#2a78d6',
  fijo: '#eb6834',
  variable: '#1baf7a',
  insumos: '#eda100',
  facturas: '#e87ba4',
} as const
export type ClaveGrupo = keyof typeof COLOR_GRUPO

export const NOMBRE_GRUPO: Record<ClaveGrupo, string> = {
  sueldos: 'Sueldos',
  fijo: 'Fijos',
  variable: 'Variables',
  insumos: 'Insumos y caja chica',
  facturas: 'Facturas de proveedores',
}

/** Franja del día para ordenar la caja chica: el terminal abre de madrugada. */
export function franjaHoraria(hora: string | null): string {
  if (!hora) return 'Sin hora'
  const h = Number(hora.slice(0, 2))
  if (h < 6) return 'Madrugada (0–6)'
  if (h < 12) return 'Mañana (6–12)'
  if (h < 18) return 'Tarde (12–18)'
  return 'Noche (18–24)'
}
export const FRANJAS = ['Madrugada (0–6)', 'Mañana (6–12)', 'Tarde (12–18)', 'Noche (18–24)', 'Sin hora']

/** 'YYYY-MM-DD' -> 'YYYY-MM-01'. */
export const inicioMes = (fecha: string) => `${fecha.slice(0, 7)}-01`

/** Hoy en formato ISO local, para los valores por defecto de los formularios. */
export function hoyIso() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** Lo que el campo de monto acepta: «12.500», «$12500», «12500». */
export function leerMonto(texto: string): number {
  return Number(texto.replace(/[^\d]/g, '')) || 0
}

/** Cantidad de meses que cubre el período, para comparar contra el sueldo pactado. */
export function mesesDelPeriodo(periodo: Periodo, abonos: { periodo: string }[]): number {
  const desde = periodo.desde ?? abonos.at(-1)?.periodo
  const hasta = periodo.hasta ?? hoyIso()
  if (!desde) return 1
  const [a1, m1] = desde.split('-').map(Number)
  const [a2, m2] = hasta.split('-').map(Number)
  return Math.max(1, (a2 - a1) * 12 + (m2 - m1) + 1)
}
