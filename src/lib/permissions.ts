import type { AppRole } from './types'

/**
 * Espejo en el cliente de public.role_permissions.
 * Sirve SOLO para ocultar/mostrar interfaz. La autoridad real es Postgres (RLS + funciones
 * SECURITY DEFINER); si el frontend se equivoca, la base de datos rechaza la operación igual.
 */
export type Resource =
  | 'dashboard' | 'products' | 'inventory' | 'lots' | 'movements' | 'purchases' | 'suppliers'
  | 'customers' | 'orders' | 'deliveries' | 'routes' | 'payments' | 'losses' | 'price_lists'
  | 'reports' | 'workers' | 'audit' | 'settings'

export type Action = 'read' | 'create' | 'update' | 'delete' | 'approve'

const MATRIX: Record<Exclude<AppRole, 'admin'>, Partial<Record<Resource, Action[]>>> = {
  ventas: {
    customers: ['read', 'create', 'update'],
    orders: ['read', 'create', 'update'],
    products: ['read'],
    inventory: ['read'],
    payments: ['read', 'create'],
    price_lists: ['read'],
    deliveries: ['read'],
    reports: ['read'],
  },
  compras: {
    suppliers: ['read', 'create', 'update'],
    purchases: ['read', 'create', 'update'],
    products: ['read', 'create'],
    inventory: ['read'],
    lots: ['read', 'create'],
  },
  inventario: {
    inventory: ['read', 'update'],
    lots: ['read', 'create', 'update'],
    products: ['read'],
    losses: ['read', 'create'],
    orders: ['read', 'update'],
    purchases: ['read'],
    movements: ['read', 'create'],
  },
  empaque: {
    orders: ['read', 'update'],
    products: ['read'],
    inventory: ['read'],
    lots: ['read'],
    losses: ['read', 'create'],
  },
  reparto: {
    deliveries: ['read', 'update'],
    orders: ['read'],
    customers: ['read'],
    payments: ['create'],
    routes: ['read'],
  },
}

export function can(role: AppRole | undefined, resource: Resource, action: Action = 'read'): boolean {
  if (!role) return false
  if (role === 'admin') return true
  return MATRIX[role]?.[resource]?.includes(action) ?? false
}

/** Los administradores usan la interfaz de escritorio; el resto, la interfaz de terreno. */
export const isAdminRole = (role: AppRole | undefined) => role === 'admin'
