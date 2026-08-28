import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Activity, AlertTriangle, Check, Database, History, Lock, Mail, Plug, RefreshCw, Wrench,
} from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { dateTime, money } from '../../lib/format'
import { Card, CardHeader, ErrorState, PageHeader, Skeleton } from '../../components/ui'
import { CorteAnalisis } from '../../components/CorteAnalisis'
import { CorreoSaliente } from '../../components/CorreoSaliente'
import { BsaleConexion } from './BsaleConexion'
import { PuestaEnMarcha } from './PuestaEnMarcha'

/**
 * El panel de quien mantiene el sistema.
 *
 * Antes esto vivía mezclado en Configuración y lo veían los cuatro
 * administradores de la empresa: el token de Bsale, la fecha de corte del
 * análisis, el asistente de puesta en marcha. Nada de eso es su trabajo, y un
 * cambio distraído ahí rompe la sincronización o saca datos de los informes sin
 * que nadie entienda por qué.
 *
 * Acá se junta lo técnico y se responde una sola pregunta: ¿está todo
 * funcionando? Cada módulo dice cuándo corrió por última vez y si falló.
 */
export function Soporte() {
  const { profile } = useAuth()

  const estado = useQuery({
    queryKey: ['soporte-estado'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('soporte_estado')
      if (error) throw error
      return data as Estado
    },
    enabled: profile?.role === 'soporte',
  })

  if (profile?.role !== 'soporte') {
    return (
      <Card className="p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-slate-300" />
        <p className="font-medium text-slate-700">Este panel es del soporte técnico</p>
        <p className="mt-1 text-sm text-slate-500">
          Si necesitas cambiar algo de acá, pídelo a quien mantiene el sistema.
        </p>
      </Card>
    )
  }

  const e = estado.data

  return (
    <>
      <PageHeader
        title="Soporte"
        subtitle="Estado de los módulos, integraciones y mantención del sistema"
      />

      {estado.isLoading && <Skeleton className="h-40" />}
      {estado.isError && <ErrorState error={estado.error} />}

      {e && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Modulo
              titulo="Sincronización con Bsale"
              icono={<RefreshCw className="h-4 w-4" />}
              ok={e.bsale.conexion_activa && !e.bsale.ultimo_error}
              valor={e.bsale.conexion_activa ? 'Conectada' : 'Sin conexión'}
              detalle={e.bsale.ultima_sync
                ? `Última corrida ${dateTime(e.bsale.ultima_sync)}`
                : 'Todavía no ha corrido'}
              alerta={e.bsale.ultimo_error} />

            <Modulo
              titulo="Trabajos programados"
              icono={<Activity className="h-4 w-4" />}
              ok={e.cron.activos === e.cron.total && e.cron.total > 0}
              valor={`${e.cron.activos} de ${e.cron.total} activos`}
              detalle={e.cron.fallos_24h > 0
                ? `${e.cron.fallos_24h} fallo(s) en las últimas 24 h`
                : 'Sin fallos en 24 h'}
              alerta={e.cron.fallos_24h > 0 ? 'Revisar el registro de cron' : null} />

            <Modulo
              titulo="Notas de crédito"
              icono={<Wrench className="h-4 w-4" />}
              ok={e.notas_credito.sin_resolver === 0}
              valor={e.notas_credito.sin_resolver === 0
                ? 'Todas resueltas'
                : `${e.notas_credito.sin_resolver} sin resolver`}
              detalle={`${e.notas_credito.total} en total · ${e.notas_credito.a_favor_clientes} a favor de clientes`}
              alerta={e.notas_credito.sin_resolver > 0
                ? 'Hay notas cuyo XML no se pudo leer' : null} />

            <Modulo
              titulo="Datos"
              icono={<Database className="h-4 w-4" />}
              ok={e.datos.pagos_descuadrados === 0}
              valor={`${e.datos.facturas} facturas`}
              detalle={`${e.datos.clientes} clientes · ${e.datos.cobros} cobros`}
              alerta={e.datos.pagos_descuadrados > 0
                ? `${e.datos.pagos_descuadrados} cobro(s) imputados al cliente equivocado` : null} />
          </div>

          <Card className="mb-4">
            <CardHeader title="Integridad de los números"
              action={<span className="text-xs text-slate-400">se revisa cada minuto</span>} />
            <div className="divide-y divide-slate-100">
              <Chequeo titulo="Facturas cobradas de más"
                detalle="El monto imputado supera el total del documento"
                cuantos={e.integridad.facturas_sobrepagadas} />
              <Chequeo titulo="Cobros imputados a otro cliente"
                detalle="El pago está en un cliente y la factura que salda en otro"
                cuantos={e.integridad.pagos_de_otro_cliente} />
              <Chequeo titulo="Cobros sin imputar"
                detalle="Plata registrada que no cubre ninguna factura"
                cuantos={e.integridad.cobros_sin_imputar}
                monto={e.integridad.monto_sin_imputar} neutro />
              <Chequeo titulo="Facturas con estado puesto a mano"
                detalle="Alguien forzó el estado; el cálculo automático no las toca"
                cuantos={e.integridad.estados_forzados} neutro />
            </div>
          </Card>

          <Card className="mb-4 flex items-start gap-3 p-4 text-xs text-slate-500">
            <History className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <p>
              Los cuatro chequeos de arriba se calculan en vivo contra la base. Los dos primeros
              deberían estar siempre en cero: si aparece algo, es un dato que quedó inconsistente y
              conviene mirarlo antes de que se propague a los informes.{' '}
              <Link to="/auditoria" className="text-sea-600 hover:underline">Ver la auditoría</Link>.
            </p>
          </Card>
        </>
      )}

      <div className="space-y-4">
        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Plug className="h-4 w-4 text-slate-400" /> Integraciones
          </h2>
          <BsaleConexion />
        </div>

        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Mail className="h-4 w-4 text-slate-400" /> Correo
          </h2>
          <CorreoSaliente />
        </div>

        <div>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Database className="h-4 w-4 text-slate-400" /> Datos y puesta en marcha
          </h2>
          <CorteAnalisis />
        </div>

        <PuestaEnMarcha />
      </div>
    </>
  )
}

interface Estado {
  bsale: { conexion_activa: boolean; ultima_sync: string | null; ultimo_error: string | null }
  cron: { total: number; activos: number; fallos_24h: number }
  notas_credito: { total: number; sin_resolver: number; a_favor_clientes: number }
  datos: { facturas: number; clientes: number; cobros: number; pagos_descuadrados: number }
  integridad: {
    facturas_sobrepagadas: number
    pagos_de_otro_cliente: number
    cobros_sin_imputar: number
    monto_sin_imputar: number
    estados_forzados: number
  }
}

function Modulo({
  titulo, icono, ok, valor, detalle, alerta,
}: {
  titulo: string
  icono: React.ReactNode
  ok: boolean
  valor: string
  detalle: string
  alerta?: string | null
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
          {icono} {titulo}
        </span>
        <span className={clsx('flex h-5 w-5 items-center justify-center rounded-full',
          ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
          {ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
        </span>
      </div>
      <p className="mt-2 font-semibold text-slate-900">{valor}</p>
      <p className="text-xs text-slate-400">{detalle}</p>
      {alerta && <p className="mt-1.5 text-xs font-medium text-amber-700">{alerta}</p>}
    </Card>
  )
}

function Chequeo({
  titulo, detalle, cuantos, monto, neutro,
}: {
  titulo: string
  detalle: string
  cuantos: number
  monto?: number
  neutro?: boolean
}) {
  const mal = !neutro && cuantos > 0
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{titulo}</p>
        <p className="text-xs text-slate-500">{detalle}</p>
      </div>
      <span className={clsx('shrink-0 rounded-lg px-2.5 py-1 text-sm font-medium tabular-nums',
        mal ? 'bg-red-100 text-red-700'
        : cuantos > 0 ? 'bg-slate-100 text-slate-600'
        : 'bg-emerald-100 text-emerald-700')}>
        {cuantos}{monto !== undefined && cuantos > 0 && ` · ${money(monto)}`}
      </span>
    </div>
  )
}
