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

export const useSuppliers = () =>
  useQuery({
    queryKey: ['suppliers'],
    queryFn: () => pick<Supplier>('suppliers', '*', 'name'),
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
