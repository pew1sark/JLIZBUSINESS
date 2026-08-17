import { PageHeader, PhaseNotice } from '../../components/ui'

/**
 * Módulos con base de datos ya construida (tablas, RLS y funciones aplicadas en Supabase)
 * cuya interfaz se implementa en las fases siguientes del plan.
 */
function Modulo({ title, subtitle, phase, children }: {
  title: string; subtitle: string; phase: string; children: React.ReactNode
}) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <PhaseNotice phase={phase}>{children}</PhaseNotice>
    </>
  )
}

export const Pedidos = () => (
  <Modulo title="Pedidos" subtitle="Tablero Kanban por estado" phase="Fase 3">
    Tablero con columnas Nuevos → Confirmados → Preparación → Listos → En reparto → Entregados →
    Cancelados, con arrastre entre estados y detalle completo del pedido con línea de tiempo.
    Las tablas <code>orders</code>, <code>order_items</code> y <code>order_status_history</code> y las funciones
    <code> confirm_order()</code>, <code>start_preparation()</code>, <code>finish_preparation()</code> y
    <code> dispatch_order()</code> ya están operativas en la base de datos.
  </Modulo>
)

export const Ventas = () => (
  <Modulo title="Ventas" subtitle="Punto de venta y facturación interna" phase="Fase 3">
    Creación de ventas con selección de cliente, lista de precios asignada, productos por peso,
    descuentos, transporte y estado de pago. La reserva de stock se dispara al confirmar.
  </Modulo>
)

export const Inventario = () => (
  <Modulo title="Inventario" subtitle="Stock por producto, lote y ubicación" phase="Fase 2">
    Vista de stock físico / reservado / disponible por producto (vista <code>v_product_stock</code>),
    detalle de lotes con vencimiento y ubicación, ajustes con <code>adjust_lot_quantity()</code> y
    registro de mermas con <code>register_loss()</code>.
  </Modulo>
)

export const Productos = () => (
  <Modulo title="Productos" subtitle="Catálogo, especies y listas de precios" phase="Fase 2">
    ABM de productos con especie, categoría, presentación, unidad base, stock mínimo, costo promedio
    y precio por lista (público, restaurante, mayorista, distribuidor).
  </Modulo>
)

export const Compras = () => (
  <Modulo title="Compras" subtitle="Órdenes de compra y recepción" phase="Fase 2">
    Registro de compra con proveedor, productos, kilos, precio por kg, flete y costos adicionales.
    Al recibir, <code>receive_purchase()</code> crea los lotes, prorratea el flete para obtener el costo
    real por kilo y genera los movimientos de inventario.
  </Modulo>
)

export const Proveedores = () => (
  <Modulo title="Proveedores" subtitle="Fichas, historial y precios comparados" phase="Fase 2">
    Ficha con datos de contacto, evaluación, deuda y comparador de precios históricos por producto
    (tabla <code>supplier_products</code>).
  </Modulo>
)

export const Clientes = () => (
  <Modulo title="Clientes" subtitle="CRM, direcciones y cuenta corriente" phase="Fase 3">
    Ficha con tipo de cliente, lista de precios asignada, direcciones de despacho, historial de compras,
    frecuencia y saldo pendiente (vista <code>v_customer_balance</code>).
  </Modulo>
)

export const Entregas = () => (
  <Modulo title="Entregas" subtitle="Rutas, repartidores y confirmación" phase="Fase 4">
    Asignación de pedidos a repartidores y rutas, seguimiento de estado y confirmación de entrega con
    hora, receptor, ubicación, foto y firma.
  </Modulo>
)

export const Finanzas = () => (
  <Modulo title="Finanzas" subtitle="Pagos, cuentas por cobrar y rentabilidad" phase="Fase 5">
    Cobros y pagos por método, estado de cuenta por cliente, alertas de vencidos y margen por producto,
    pedido, cliente y período.
  </Modulo>
)

export const Reportes = () => (
  <Modulo title="Reportes" subtitle="Exportables a CSV, Excel y PDF" phase="Fase 5">
    Ventas, compras, inventario, margen, clientes, proveedores, mermas, entregas, pagos, cuentas por
    cobrar y rotación de productos.
  </Modulo>
)

export const Trabajadores = () => (
  <Modulo title="Trabajadores" subtitle="Usuarios, roles y permisos" phase="Fase 1 · en curso">
    Alta de usuarios y asignación de rol sobre <code>profiles</code>, más edición de la matriz
    <code> role_permissions</code>. Hoy el rol se asigna directamente en la base de datos.
  </Modulo>
)

export const Auditoria = () => (
  <Modulo title="Auditoría" subtitle="Quién cambió qué y cuándo" phase="Fase 6">
    Consulta de <code>audit_logs</code>: cada INSERT/UPDATE/DELETE sobre pedidos, inventario, productos,
    clientes, compras y pagos ya queda registrado con usuario, valores antes/después y motivo.
  </Modulo>
)

export const Configuracion = () => (
  <Modulo title="Configuración" subtitle="Datos de la empresa y parámetros" phase="Fase 6">
    Datos de la empresa, IVA, días de crédito por defecto, umbrales de alerta y política de stock
    negativo (tabla <code>settings</code>).
  </Modulo>
)
