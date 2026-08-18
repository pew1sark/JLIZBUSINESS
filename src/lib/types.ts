// Tipos del dominio. Reflejan el esquema de Postgres (public.*).
// Para regenerarlos desde la base: supabase gen types typescript --project-id owfvuusxfvzjgxfmllpt

export type AppRole = 'admin' | 'ventas' | 'compras' | 'inventario' | 'empaque' | 'reparto'
export type EntityStatus = 'activo' | 'inactivo' | 'archivado'
export type UnitMeasure = 'kg' | 'g' | 'unidad' | 'caja' | 'bandeja'
export type OrderStatus =
  | 'nuevo' | 'confirmado' | 'en_preparacion' | 'preparado' | 'en_reparto' | 'entregado' | 'cancelado'
export type PaymentStatus = 'pendiente' | 'parcial' | 'pagado' | 'vencido'
export type PaymentMethod = 'efectivo' | 'transferencia' | 'tarjeta' | 'cheque' | 'credito' | 'otro'
export type PurchaseStatus = 'borrador' | 'recibida' | 'anulada'
export type LotStatus = 'disponible' | 'agotado' | 'vencido' | 'bloqueado'
export type DeliveryStatus = 'pendiente' | 'asignada' | 'en_camino' | 'entregada' | 'fallida'
export type LossReason =
  | 'merma_proceso' | 'dano' | 'vencimiento' | 'diferencia_peso' | 'robo' | 'devolucion' | 'otro'
export type CustomerType =
  | 'particular' | 'restaurante' | 'hotel' | 'supermercado' | 'mayorista' | 'distribuidor' | 'otro'
export type MovementType =
  | 'entrada_compra' | 'ajuste_positivo' | 'salida_venta' | 'reserva'
  | 'liberacion_reserva' | 'merma' | 'ajuste_negativo' | 'devolucion' | 'traslado'

export interface Profile {
  id: string
  email: string
  full_name: string
  phone: string | null
  avatar_url: string | null
  role: AppRole
  is_active: boolean
  created_at: string
}

export interface Product {
  id: string
  sku: string | null
  name: string
  species_id: string | null
  category_id: string | null
  presentation: string | null
  base_unit: UnitMeasure
  min_stock: number
  sale_price: number
  last_cost: number
  avg_cost: number
  is_perishable: boolean
  shelf_life_days: number | null
  photo_url: string | null
  status: EntityStatus
}

export interface ProductStock {
  product_id: string
  name: string
  sku: string | null
  base_unit: UnitMeasure
  min_stock: number
  sale_price: number
  avg_cost: number
  status: EntityStatus
  category_id: string | null
  species_id: string | null
  on_hand: number
  reserved: number
  available: number
  stock_value: number
  active_lots: number
}

export interface Customer {
  id: string
  code: string | null
  name: string
  company: string | null
  rut: string | null
  customer_type: CustomerType
  contact_name: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  address: string | null
  comuna: string | null
  region: string | null
  price_list_id: string | null
  credit_limit: number
  payment_terms_days: number
  status: EntityStatus
  created_at: string
}

export interface Supplier {
  id: string
  code: string | null
  name: string
  company: string | null
  rut: string | null
  contact_name: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  address: string | null
  comuna: string | null
  region: string | null
  payment_terms_days: number
  rating: number | null
  status: EntityStatus
}

export interface Order {
  id: string
  code: string
  customer_id: string
  status: OrderStatus
  order_date: string
  delivery_date: string | null
  delivery_window: string | null
  subtotal: number
  discount: number
  freight: number
  total: number
  cost_total: number
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  amount_paid: number
  due_date: string | null
  notes: string | null
  driver_id: string | null
  prepared_by: string | null
  confirmed_at: string | null
  prepared_at: string | null
  delivered_at: string | null
  invoice_number: string | null
  invoice_status: 'pendiente' | 'emitida' | 'anulada'
  customers?: Pick<Customer, 'id' | 'name' | 'customer_type' | 'phone' | 'address' | 'comuna'>
}

export interface OrderItem {
  id: string
  order_id: string
  product_id: string
  quantity_ordered: number
  quantity_prepared: number | null
  unit: UnitMeasure
  unit_price: number
  unit_cost: number
  discount: number
  line_total: number
  products?: Pick<Product, 'id' | 'name' | 'sku' | 'base_unit'>
}

export interface InventoryLot {
  id: string
  code: string
  product_id: string
  supplier_id: string | null
  received_at: string
  expires_at: string | null
  initial_quantity: number
  quantity_on_hand: number
  quantity_reserved: number
  quantity_available: number
  unit: UnitMeasure
  unit_cost: number
  origin: string | null
  location: string | null
  status: LotStatus
  products?: Pick<Product, 'id' | 'name' | 'sku'>
  suppliers?: Pick<Supplier, 'id' | 'name'>
}

export interface Purchase {
  id: string
  code: string
  supplier_id: string
  purchase_date: string
  status: PurchaseStatus
  subtotal: number
  freight_cost: number
  other_costs: number
  total: number
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  amount_paid: number
  origin: string | null
  suppliers?: Pick<Supplier, 'id' | 'name'>
}

export interface Delivery {
  id: string
  code: string
  order_id: string
  driver_id: string | null
  status: DeliveryStatus
  scheduled_date: string | null
  started_at: string | null
  delivered_at: string | null
  received_by_name: string | null
  amount_collected: number
  notes: string | null
  orders?: Order
}

export interface Payment {
  id: string
  code: string
  direction: 'cobro' | 'pago'
  order_id: string | null
  purchase_id: string | null
  customer_id: string | null
  amount: number
  method: PaymentMethod
  paid_at: string
  reference: string | null
}

export interface AppNotification {
  id: string
  user_id: string | null
  target_role: AppRole | null
  title: string
  body: string | null
  kind: 'info' | 'warning' | 'danger' | 'success'
  link: string | null
  read_at: string | null
  created_at: string
}

export interface AuditLog {
  id: number
  user_id: string | null
  user_email: string | null
  action: string
  table_name: string
  record_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  changes: Record<string, { antes: unknown; despues: unknown }> | null
  reason: string | null
  created_at: string
}

export interface DashboardKpis {
  ventas_hoy: number
  ventas_semana: number
  ventas_mes: number
  compras_mes: number
  margen_mes: number
  pedidos_pendientes: number
  pedidos_en_reparto: number
  pedidos_entregados_hoy: number
  stock_total: number
  stock_valor: number
  productos_stock_bajo: number
  clientes_activos: number
  cuentas_por_cobrar: number
  cuentas_vencidas: number
}
