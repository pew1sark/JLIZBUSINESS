import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { InventoryLot, Product, ProductStock, Supplier } from './types'

export interface Location {
  id: string
  code: string | null
  name: string
  type: 'terminal' | 'bodega' | 'camara' | 'vehiculo'
  capacity_kg: number | null
}

export interface Category { id: string; name: string }
export interface Species { id: string; common_name: string }

async function pick<T>(table: string, cols: string, order: string) {
  const { data, error } = await supabase.from(table).select(cols).order(order)
  if (error) throw error
  return data as T[]
}

export const useProducts = (soloActivos = true) =>
  useQuery({
    queryKey: ['products', soloActivos],
    queryFn: async () => {
      let q = supabase.from('products').select('*').order('name')
      if (soloActivos) q = q.eq('status', 'activo')
      const { data, error } = await q
      if (error) throw error
      return data as Product[]
    },
  })

export const useStock = () =>
  useQuery({
    queryKey: ['stock'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_product_stock')
        .select('*')
        .eq('status', 'activo')
        .order('name')
      if (error) throw error
      return data as ProductStock[]
    },
  })

/**
 * Por defecto solo los activos: un proveedor desactivado no debe ofrecerse al
 * crear una compra. La pantalla de Proveedores pide la lista completa para poder
 * verlos y reactivarlos.
 */
export const useSuppliers = (soloActivos = true) =>
  useQuery({
    queryKey: ['suppliers', soloActivos],
    queryFn: async () => {
      let q = supabase.from('suppliers').select('*').order('name')
      if (soloActivos) q = q.eq('status', 'activo')
      const { data, error } = await q
      if (error) throw error
      return data as Supplier[]
    },
  })

export const useLocations = () =>
  useQuery({
    queryKey: ['locations'],
    queryFn: () => pick<Location>('locations', 'id, code, name, type, capacity_kg', 'name'),
  })

export const useCategories = () =>
  useQuery({
    queryKey: ['categories'],
    queryFn: () => pick<Category>('product_categories', 'id, name', 'sort_order'),
  })

export const useSpecies = () =>
  useQuery({
    queryKey: ['species'],
    queryFn: () => pick<Species>('fish_species', 'id, common_name', 'common_name'),
  })

export const useLots = (productId?: string, soloDisponibles = true) =>
  useQuery({
    queryKey: ['lots', productId, soloDisponibles],
    queryFn: async () => {
      let q = supabase
        .from('inventory_lots')
        .select('*, products(id, name, sku), suppliers(id, name)')
        .order('received_at', { ascending: false })
      if (productId) q = q.eq('product_id', productId)
      if (soloDisponibles) q = q.eq('status', 'disponible').gt('quantity_on_hand', 0)
      const { data, error } = await q
      if (error) throw error
      return data as InventoryLot[]
    },
  })

/** Parámetros operativos reales del negocio (tabla settings). */
export const useOperacion = () =>
  useQuery({
    queryKey: ['settings', 'operacion'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'operacion')
        .maybeSingle()
      if (error) throw error
      return (data?.value ?? {}) as Record<string, number | boolean | string>
    },
  })

// ---------- CONSOLA DE SINCRONIZACIÓN ----------

export type EstadoSync =
  | 'ok' | 'caida' | 'atrasada' | 'corriendo' | 'trabada' | 'apagada' | 'sin_datos'

export interface CorridaSync {
  id: string
  resource: string
  trigger: string
  status: 'ok' | 'error' | 'corriendo'
  started_at: string
  finished_at: string | null
  segundos: number | null
  records_saved: number | null
  records_read: number | null
  error: string | null
}

export interface MonitorSync {
  ahora: string
  estado: EstadoSync
  fallas_seguidas: number
  ultima_ok: string | null
  proxima: string
  job: {
    activo: boolean
    schedule: string | null
    ultimo_disparo: string | null
    fallos_disparo_24h: number
  }
  ultima: CorridaSync | null
  resumen_24h: { corridas: number; ok: number; error: number; guardados: number }
  pendientes: { compras_sin_volcar: number; xml_sin_leer: number; xml_con_error: number }
  corridas: CorridaSync[]
}

/**
 * Estado de la sincronización con Bsale.
 *
 * Lo piden dos lugares —la consola de Soporte y el menú, que marca en rojo
 * cuando está caída— así que comparten clave y la llamada se hace una sola vez.
 * La función de la base lo rechaza a quien no sea soporte; por eso `activo`.
 */
export const useMonitorSync = (activo: boolean) =>
  useQuery({
    queryKey: ['bsale-monitor'],
    enabled: activo,
    // Respaldo por si el canal en vivo no llega a conectarse.
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('bsale_monitor', { _limite: 20 })
      if (error) throw error
      return data as MonitorSync
    },
  })

/** Los estados que ameritan mirar: es lo que marca en rojo el menú. */
export const syncEnFalla = (estado: EstadoSync | undefined) =>
  estado === 'caida' || estado === 'trabada' || estado === 'apagada' || estado === 'atrasada'
