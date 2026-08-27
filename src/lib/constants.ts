import type {
  AppRole, CustomerType, DeliveryStatus, LossReason, MovementType,
  OrderStatus, PaymentMethod, PaymentStatus, PurchaseStatus,
} from './types'

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: 'Administrador',
  finanzas: 'Finanzas',
  ventas: 'Ventas',
  compras: 'Compras',
  inventario: 'Bodega / Inventario',
  empaque: 'Empaque',
  reparto: 'Reparto',
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  nuevo: 'Nuevo',
  confirmado: 'Confirmado',
  en_preparacion: 'En preparación',
  preparado: 'Preparado',
  en_reparto: 'En reparto',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
}

export const ORDER_STATUS_STYLE: Record<OrderStatus, string> = {
  nuevo: 'bg-slate-100 text-slate-700',
  confirmado: 'bg-blue-100 text-blue-700',
  en_preparacion: 'bg-amber-100 text-amber-800',
  preparado: 'bg-violet-100 text-violet-700',
  en_reparto: 'bg-sea-100 text-sea-800',
  entregado: 'bg-emerald-100 text-emerald-700',
  cancelado: 'bg-red-100 text-red-700',
}

export const ORDER_FLOW: OrderStatus[] = [
  'nuevo', 'confirmado', 'en_preparacion', 'preparado', 'en_reparto', 'entregado',
]

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pendiente: 'Pendiente',
  parcial: 'Parcial',
  pagado: 'Pagado',
  vencido: 'Vencido',
}

export const PAYMENT_STATUS_STYLE: Record<PaymentStatus, string> = {
  pendiente: 'bg-slate-100 text-slate-700',
  parcial: 'bg-amber-100 text-amber-800',
  pagado: 'bg-emerald-100 text-emerald-700',
  vencido: 'bg-red-100 text-red-700',
}

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  cheque: 'Cheque',
  credito: 'Crédito',
  otro: 'Otro',
  nota_credito: 'Nota de crédito',
}

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  borrador: 'Borrador',
  recibida: 'Recibida',
  anulada: 'Anulada',
}

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  pendiente: 'Pendiente',
  asignada: 'Asignada',
  en_camino: 'En camino',
  entregada: 'Entregada',
  fallida: 'Fallida',
}

export const CUSTOMER_TYPE_LABEL: Record<CustomerType, string> = {
  particular: 'Particular',
  restaurante: 'Restaurante',
  hotel: 'Hotel',
  supermercado: 'Supermercado',
  mayorista: 'Mayorista',
  distribuidor: 'Distribuidor',
  otro: 'Otro',
}

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  entrada_compra: 'Entrada por compra',
  ajuste_positivo: 'Ajuste (+)',
  salida_venta: 'Salida por venta',
  reserva: 'Reserva',
  liberacion_reserva: 'Liberación de reserva',
  merma: 'Merma',
  ajuste_negativo: 'Ajuste (−)',
  devolucion: 'Devolución',
  traslado: 'Traslado',
  proceso_consumo: 'Entrada a proceso',
  proceso_produccion: 'Producido en proceso',
}

export const LOSS_REASON_LABEL: Record<LossReason, string> = {
  merma_proceso: 'Merma de proceso',
  dano: 'Producto dañado',
  vencimiento: 'Vencimiento',
  diferencia_peso: 'Diferencia de peso',
  robo: 'Pérdida / robo',
  devolucion: 'Devolución',
  otro: 'Otro',
}
