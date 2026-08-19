import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, Check, Loader2, Rocket, Trash2, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { AppRole } from '../../lib/types'
import { Card, CardHeader, ErrorState, Modal, Skeleton } from '../../components/ui'

interface Readiness {
  empresa_configurada: boolean
  costos_declarados: boolean
  productos: number
  clientes: number
  proveedores: number
  rendimientos: number
  stock_inicial: number
  saldos_por_cobrar: number
  saldos_por_pagar: number
  usuarios_activos: number
  roles_cubiertos: AppRole[]
  invitaciones_pendientes: number
  intake_sin_importar: number
  formulario_respondido: number
  movimientos_demo: Record<string, number>
}

const CONFIRMACION = 'BORRAR DATOS DE DEMOSTRACION'

export function PuestaEnMarcha() {
  const qc = useQueryClient()
  const [abierto, setAbierto] = useState(false)
  const [nivel, setNivel] = useState<'operacion' | 'todo'>('operacion')
  const [texto, setTexto] = useState('')
  const [simulacion, setSimulacion] = useState<Record<string, number> | null>(null)

  const estado = useQuery({
    queryKey: ['readiness'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('system_readiness')
      if (error) throw error
      return data as Readiness
    },
  })

  const purga = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      const { data, error } = await supabase.rpc('purge_demo_data', {
        _confirm: CONFIRMACION,
        _nivel: nivel,
        _dry_run: dryRun,
      })
      if (error) throw error
      return data as { simulacion: boolean; se_borraria?: Record<string, number>; borrado?: Record<string, number> }
    },
    onSuccess: (r) => {
      if (r.simulacion) {
        setSimulacion(r.se_borraria ?? null)
      } else {
        setSimulacion(null)
        setAbierto(false)
        setTexto('')
        qc.invalidateQueries()
      }
    },
  })

  const e = estado.data
  const demo = e ? Object.values(e.movimientos_demo).reduce((n, v) => n + Number(v), 0) : 0

  const checks = e
    ? [
        { ok: e.empresa_configurada, label: 'Datos de la empresa', detalle: 'Razón social y RUT cargados' },
        { ok: e.formulario_respondido >= 100, label: 'Levantamiento respondido', detalle: `${e.formulario_respondido} de 107 preguntas` },
        { ok: e.productos > 0, label: 'Catálogo de productos', detalle: `${e.productos} productos` },
        { ok: e.clientes > 0, label: 'Cartera de clientes', detalle: `${e.clientes} clientes` },
        { ok: e.proveedores > 0, label: 'Proveedores', detalle: `${e.proveedores} proveedores` },
        { ok: e.rendimientos > 0, label: 'Rendimientos del proceso', detalle: `${e.rendimientos} registrados · necesarios para el costo del filete` },
        { ok: e.costos_declarados, label: 'Costos exactos declarados', detalle: 'Costos por viaje y fijos mensuales del formulario' },
        { ok: e.stock_inicial > 0, label: 'Stock inicial cargado', detalle: `${e.stock_inicial} lote(s) de apertura · sin esto el inventario parte en cero` },
        { ok: e.saldos_por_cobrar + e.saldos_por_pagar > 0, label: 'Saldos arrastrados', detalle: `${e.saldos_por_cobrar} por cobrar · ${e.saldos_por_pagar} por pagar` },
        { ok: e.usuarios_activos > 1, label: 'Equipo con acceso', detalle: `${e.usuarios_activos} cuentas activas` },
      ]
    : []

  const pendientes = checks.filter((c) => !c.ok).length

  return (
    <Card className="mb-4">
      <CardHeader
        title="Puesta en marcha"
        action={
          e && (
            <span className={`badge ${pendientes === 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
              {pendientes === 0 ? 'Listo para operar' : `${pendientes} pendiente(s)`}
            </span>
          )
        }
      />

      {estado.isLoading && <Skeleton className="m-4 h-40" />}
      {estado.isError && <div className="p-4"><ErrorState error={estado.error} /></div>}

      {e && (
        <div className="p-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {checks.map((c) => (
              <div key={c.label} className="flex items-start gap-2.5 rounded-lg border border-slate-100 p-3">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    c.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {c.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{c.label}</p>
                  <p className="text-xs text-slate-500">{c.detalle}</p>
                </div>
              </div>
            ))}
          </div>

          {e.intake_sin_importar > 0 && (
            <Link to="/levantamiento" className="mt-3 flex items-center gap-3 rounded-lg border border-sea-200 bg-sea-50 p-3">
              <Rocket className="h-4 w-4 shrink-0 text-sea-700" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-sea-900">
                  El cliente cargó {e.intake_sin_importar} fila(s) sin importar
                </p>
                <p className="text-xs text-sea-800/80">
                  Impórtalas para crear sus productos, clientes y proveedores reales
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-sea-700" />
            </Link>
          )}

          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-800">Datos de demostración</p>
                <p className="text-xs text-slate-500">
                  {demo} registros de movimiento (pedidos, compras, lotes, pagos, entregas).
                  Bórralos el día que empiecen a operar de verdad.
                </p>
              </div>
              <button onClick={() => setAbierto(true)} className="btn-secondary" disabled={demo === 0}>
                <Trash2 className="h-4 w-4" /> Limpiar
              </button>
            </div>
          </div>
        </div>
      )}

      <Modal
        open={abierto}
        onClose={() => { setAbierto(false); setSimulacion(null); setTexto('') }}
        title="Limpiar datos de demostración"
        footer={
          <>
            <button onClick={() => { setAbierto(false); setSimulacion(null); setTexto('') }} className="btn-secondary">
              Cancelar
            </button>
            <button onClick={() => purga.mutate({ dryRun: true })} disabled={purga.isPending} className="btn-secondary">
              Simular
            </button>
            <button
              onClick={() => purga.mutate({ dryRun: false })}
              disabled={purga.isPending || texto !== CONFIRMACION}
              className="btn-danger"
            >
              {purga.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Borrar definitivamente
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-amber-900">
              Esta acción no se puede deshacer. <strong>No toca</strong> usuarios, configuración, los
              formularios del cliente ni la auditoría.
            </p>
          </div>

          <div>
            <label className="label">Qué borrar</label>
            <select className="input" value={nivel} onChange={(ev) => { setNivel(ev.target.value as 'operacion' | 'todo'); setSimulacion(null) }}>
              <option value="operacion">Solo el movimiento (mantiene productos, clientes y proveedores)</option>
              <option value="todo">Todo, incluido el catálogo de demostración</option>
            </select>
          </div>

          <button onClick={() => purga.mutate({ dryRun: true })} className="text-xs font-medium text-navy-600 hover:underline">
            Ver qué se borraría
          </button>

          {simulacion && (
            <div className="rounded-lg bg-slate-50 p-3 text-sm">
              <p className="mb-1 font-medium text-slate-800">Se borrarían:</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-slate-600">
                {Object.entries(simulacion)
                  .filter(([, v]) => Number(v) > 0)
                  .map(([k, v]) => (
                    <p key={k} className="flex justify-between">
                      <span className="capitalize">{k}</span>
                      <strong className="tabular-nums">{v}</strong>
                    </p>
                  ))}
              </div>
            </div>
          )}

          <div>
            <label className="label">Para confirmar, escribe: {CONFIRMACION}</label>
            <input className="input font-mono" value={texto} onChange={(ev) => setTexto(ev.target.value)} />
          </div>

          {purga.isError && <ErrorState error={purga.error} />}
        </div>
      </Modal>
    </Card>
  )
}
