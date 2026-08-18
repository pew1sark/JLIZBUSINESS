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
