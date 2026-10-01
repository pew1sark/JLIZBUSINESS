import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase'
import type { Abono, GastoManual, Trabajador } from '../../../lib/gastos'
import { inicioMes } from '../../../lib/gastos'

/** Todas las consultas de esta pantalla cuelgan de esta llave: guardar algo la invalida entera. */
export const LLAVE = 'gastos-manuales'

export function useTrabajadores() {
  return useQuery({
    queryKey: [LLAVE, 'trabajadores'],
    queryFn: async () => {
      const { data, error } = await supabase.from('trabajadores').select('*')
        .order('activo', { ascending: false }).order('orden').order('nombre')
      if (error) throw error
      return data as Trabajador[]
    },
  })
}

/**
 * Abonos de sueldo cuyo MES DE CORRESPONDENCIA cae en el rango. Un sueldo de
 * septiembre pagado el 5 de octubre es gasto de septiembre.
 */
export function useAbonos(desde: string | null, hasta: string | null) {
  return useQuery({
    queryKey: [LLAVE, 'abonos', desde, hasta],
    queryFn: async () => {
      let q = supabase.from('sueldo_abonos').select('*')
        .order('periodo', { ascending: false }).order('fecha_pago', { ascending: false }).limit(5000)
      if (desde) q = q.gte('periodo', inicioMes(desde))
      if (hasta) q = q.lte('periodo', inicioMes(hasta))
      const { data, error } = await q
      if (error) throw error
      return data as Abono[]
    },
  })
}

export function useGastosManuales(desde: string | null, hasta: string | null) {
  return useQuery({
    queryKey: [LLAVE, 'gastos', desde, hasta],
    queryFn: async () => {
      let q = supabase.from('gastos_manuales').select('*')
        .order('fecha', { ascending: false })
        .order('hora', { ascending: false, nullsFirst: false })
        .limit(5000)
      if (desde) q = q.gte('fecha', desde)
      if (hasta) q = q.lte('fecha', hasta)
      const { data, error } = await q
      if (error) throw error
      return data as GastoManual[]
    },
  })
}

/** Solo fecha, categoría y monto de los gastos que vienen en facturas de proveedores. */
export function useGastosFacturas(desde: string | null, hasta: string | null) {
  return useQuery({
    queryKey: ['gastos', 'resumen', desde, hasta],
    queryFn: async () => {
      let q = supabase.from('v_gastos_operacionales').select('fecha, categoria, monto').limit(10000)
      if (desde) q = q.gte('fecha', desde)
      if (hasta) q = q.lte('fecha', hasta)
      const { data, error } = await q
      if (error) throw error
      return data as { fecha: string; categoria: string; monto: number }[]
    },
  })
}
