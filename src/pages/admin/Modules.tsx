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

