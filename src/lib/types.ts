// Tipos del dominio. Reflejan el esquema de Postgres (public.*).
// Para regenerarlos desde la base: supabase gen types typescript --project-id owfvuusxfvzjgxfmllpt

export type AppRole =
  | 'admin' | 'finanzas' | 'ventas' | 'compras' | 'inventario' | 'empaque' | 'reparto'
  /**
   * Quien mantiene el sistema. Puede todo lo de un administrador y además lo
   * técnico —integraciones, tokens, corte de análisis—, que es lo que la
   * empresa no debería poder tocar sin querer.
   */
  | 'soporte'
export type EntityStatus = 'activo' | 'inactivo' | 'archivado'
export type UnitMeasure = 'kg' | 'g' | 'unidad' | 'caja' | 'bandeja'
export type OrderStatus =
  | 'nuevo' | 'confirmado' | 'en_preparacion' | 'preparado' | 'en_reparto' | 'entregado' | 'cancelado'
export type PaymentStatus = 'pendiente' | 'parcial' | 'pagado' | 'vencido'
export type PaymentMethod =
  | 'efectivo' | 'transferencia' | 'tarjeta' | 'cheque' | 'credito' | 'otro'
  /** Saldo por nota de crédito: cierra la factura, pero no es plata que entró. */
  | 'nota_credito'
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
  | 'proceso_consumo' | 'proceso_produccion'

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
  latitude: number | null
  longitude: number | null
  geocoded_at: string | null
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
  customers?: Pick<Customer,
    'id' | 'name' | 'company' | 'rut' | 'customer_type' | 'phone' | 'address' | 'comuna'>
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
  suppliers?: Pick<Supplier, 'id' | 'name' | 'company' | 'rut'>
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
  due_date: string | null
  invoice_number: string | null
  document_url: string | null
  origin: string | null
  bsale_document_id: number | null
  /**
   * Desglose tributario del SII que llega desde Bsale. Para costear se usa
   * `total`/`subtotal`, que son netos; para pagarle al proveedor, `gross_total`,
   * que es la factura completa con IVA.
   */
  net_amount: number | null
  exempt_amount: number
  tax_amount: number
  gross_total: number | null
  dte_type: number | null
  is_credit_note: boolean
  /** Plazo de crédito pactado, en días. Base del vencimiento real. */
  terms_days: number | null
  /** Fecha del último pago registrado. La mantiene el trigger, no se escribe a mano. */
  last_payment_at: string | null
  suppliers?: Pick<Supplier, 'id' | 'name' | 'company' | 'rut'>
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
  documentos_mes: number
  compras_mes: number
  margen_mes: number
  venta_costeada: number
  cobertura_costo_pct: number
  pedidos_pendientes: number
  pedidos_en_reparto: number
  pedidos_entregados_hoy: number
  stock_total: number
  stock_valor: number
  productos_stock_bajo: number
  clientes_activos: number
  clientes_con_deuda: number
  documentos_por_cobrar: number
  cuentas_por_cobrar: number
  cuentas_vencidas: number
  vencido_grave: number
}

// ---------- COBRANZA ----------
export type DocType = 'factura' | 'boleta' | 'nota_credito' | 'nota_debito'
export type TramoAtraso = 'sin_plazo' | 'al_dia' | 'atraso_leve' | 'atraso_medio' | 'atraso_grave'

export interface Invoice {
  id: string
  code: string
  doc_type: DocType
  doc_number: string
  customer_id: string
  order_id: string | null
  issued_at: string
  due_date: string | null
  net_amount: number
  tax_amount: number
  total: number
  amount_paid: number
  payment_status: PaymentStatus
  source: 'manual' | 'importado' | 'pedido'
  related_doc_number: string | null
  notes: string | null
}

/** Una fila de deuda viva, venga de una factura, un pedido o un saldo arrastrado. */
export interface CuentaPorCobrar {
  origen: 'factura' | 'pedido' | 'saldo_inicial'
  ref_id: string
  order_id: string | null
  receivable_id: string | null
  invoice_id: string | null
  code: string
  doc_type: string
  doc_number: string | null
  customer_id: string
  cliente: string
  phone: string | null
  whatsapp: string | null
  email: string | null
  issued_at: string
  due_date: string | null
  total: number
  amount_paid: number
  saldo: number
  invoice_number: string | null
  dias_atraso: number
  tramo: TramoAtraso
  /** Marca de color para revisión manual. */
  etiqueta: string | null
  etiqueta_nota: string | null
  rut: string | null
  razon_social: string | null
}

export interface EstadoCuentaCliente {
  customer_id: string
  cliente: string
  rut: string | null
  comuna: string | null
  phone: string | null
  whatsapp: string | null
  email: string | null
  credit_limit: number
  payment_terms_days: number
  documentos: number
  deuda_total: number
  por_vencer: number
  atraso_1_15: number
  atraso_16_30: number
  atraso_31_60: number
  atraso_60_mas: number
  vencido: number
  peor_atraso: number
  vence_primero: string | null
  nota_credito: number
  pago_a_cuenta: number
  saldo_neto: number
  ultimo_pago: string | null
  sobre_limite: boolean
  /** Dirección del local. Separa dos fichas que comparten RUT. */
  direccion: string | null
  /** El nombre con el que se emite la factura, cuando difiere del de fantasía. */
  razon_social: string | null
}

export interface PagoSinImputar {
  id: string
  code: string
  customer_id: string
  cliente: string
  amount: number
  method: PaymentMethod
  paid_at: string
  reference: string | null
  notes: string | null
  imputado: number
  sin_imputar: number
}

/** Una imputación: qué parte de un pago cubrió qué documento. */
export interface Imputacion {
  kind: 'factura' | 'pedido' | 'saldo_inicial'
  id: string
  amount: number
}

export interface PagoCartola {
  id: string
  code: string
  amount: number
  method: PaymentMethod
  paid_at: string
  reference: string | null
  notes: string | null
  imputado: number
  sin_imputar: number
  aplicado_a: { amount: number; documento: string; tipo: string }[]
}

export interface AvisoPago {
  id: string
  code: string
  customer_id: string
  amount: number
  method: PaymentMethod
  paid_at: string
  reference: string | null
  invoice_ids: string[]
  notes: string | null
  status: 'pendiente' | 'confirmado' | 'rechazado'
  review_notes: string | null
  created_at: string
  customers?: { name: string } | null
}

/**
 * Una factura con su historia de pago, esté saldada o no. A diferencia de
 * `CuentaPorCobrar` —que solo muestra deuda viva— acá la factura pagada
 * sobrevive con la fecha en que se pagó, que es lo que se necesita para
 * responder "¿qué día pagó esta?" y "¿cuánto se demoró?".
 */
export interface FacturaConPago {
  invoice_id: string
  code: string
  doc_type: string
  doc_number: string
  customer_id: string
  cliente: string
  rut: string | null
  payment_terms_days: number
  issued_at: string
  due_date: string | null
  mes_emision: string
  net_amount: number
  tax_amount: number
  total: number
  amount_paid: number
  saldo: number
  payment_status: PaymentStatus
  primer_pago: string | null
  ultimo_pago: string | null
  mes_pago: string | null
  n_pagos: number
  metodos: string | null
  referencias: string | null
  dias_en_pagar: number | null
  dias_vs_plazo: number | null
  dias_esperando: number | null
  dias_atraso: number | null
  /** Cuánto de esta factura se anuló con notas de crédito, y con cuáles. */
  nota_credito_aplicada: number
  saldada_con_nota: boolean
  notas_credito: string | null
  /** El estado se puso a mano y le gana al cálculo por imputaciones. */
  estado_corregido: boolean
  estado_forzado_motivo: string | null
  estado_forzado_at: string | null
  /** El nombre con el que se emite la factura, cuando difiere del de fantasía. */
  razon_social: string | null
  /** Marca de color para revisión manual. No afecta ningún cálculo. */
  etiqueta: string | null
  etiqueta_nota: string | null
}

/** Una línea del informe de fechas de pago: este día entró plata y cubrió este documento. */
export interface PagoDetalle {
  payment_id: string
  pago_code: string
  fecha_pago: string
  mes_pago: string
  metodo: string
  reference: string | null
  notes: string | null
  monto_pago: number
  customer_id: string
  cliente: string
  rut: string | null
  monto_imputado: number | null
  destino: 'factura' | 'pedido' | 'saldo_inicial' | 'sin_imputar'
  documento: string | null
  emitido: string | null
  vence: string | null
  total_documento: number | null
  dias_desde_emision: number | null
  dias_vs_vencimiento: number | null
  /** La factura se saldó con una nota de crédito, no con un pago. */
  es_nota_credito: boolean
  razon_social: string | null
}

/** Cuánto se demora un cliente en pagar, y con cuánta regularidad. */
export interface ComportamientoPago {
  customer_id: string
  cliente: string
  rut: string | null
  plazo_pactado: number
  facturas_totales: number
  monto_total: number
  primera_factura: string | null
  ultima_factura: string | null
  facturas_pagadas: number
  monto_pagado: number
  dias_promedio: number | null
  dias_mediana: number | null
  dias_minimo: number | null
  dias_maximo: number | null
  dias_desviacion: number | null
  dias_promedio_90d: number | null
  ultimo_pago: string | null
  a_tiempo: number
  fuera_de_plazo: number
  pct_a_tiempo: number | null
  facturas_abiertas: number
  saldo_abierto: number
  espera_maxima: number | null
  espera_promedio: number | null
  exceso_sobre_plazo: number | null
  razon_social: string | null
}

/** Un mes que tiene movimiento, para poblar los selectores sin ofrecer meses vacíos. */
export interface MesActividad {
  mes: string
  facturas: number
  venta: number
  compras: number
  costo_compras: number
  cobros: number
  cobrado: number
}
