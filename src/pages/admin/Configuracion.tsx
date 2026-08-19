import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronRight, Loader2, Lock, ShieldCheck, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { Card, CardHeader, ErrorState, PageHeader, Skeleton } from '../../components/ui'

type Valores = Record<string, string | number | boolean | null>

const EMPRESA: { key: string; label: string; ancho?: boolean }[] = [
  { key: 'nombre', label: 'Razón social', ancho: true },
  { key: 'rut', label: 'RUT' },
  { key: 'modalidad', label: 'Modalidad' },
  { key: 'direccion', label: 'Dirección', ancho: true },
  { key: 'comuna', label: 'Comuna' },
  { key: 'region', label: 'Región' },
  { key: 'telefono', label: 'Teléfono' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Correo' },
]

const NUMEROS: { key: string; label: string; ayuda?: string }[] = [
  { key: 'iva', label: 'IVA (%)' },
  { key: 'dias_credito_default', label: 'Días de crédito por defecto' },
  { key: 'dias_para_vencido', label: 'Días para marcar vencido', ayuda: 'El negocio considera vencido a los 35 días' },
  { key: 'limite_credito_default', label: 'Límite de crédito por defecto' },
  { key: 'tolerancia_peso_pct', label: 'Tolerancia de peso (%)', ayuda: 'Sobre esta diferencia se avisa al cliente' },
  { key: 'descuento_volumen_kg', label: 'Descuento por volumen desde (kg)' },
  { key: 'descuento_volumen_pct', label: 'Descuento por volumen (%)' },
  { key: 'markup_objetivo_pct', label: 'Markup objetivo (%)' },
  { key: 'vida_util_fresco_dias', label: 'Vida útil del fresco (días)' },
  { key: 'merma_camara_pct_dia', label: 'Merma en cámara (% por día)' },
  { key: 'costos_fijos_mensuales', label: 'Costos fijos mensuales' },
]

const INTERRUPTORES: { key: string; label: string; detalle: string }[] = [
  {
    key: 'solo_cuentas_invitadas',
    label: 'Solo pueden registrarse las cuentas invitadas',
    detalle: 'Si se apaga, cualquiera con el enlace puede crear una cuenta. Se recomienda dejarlo activo.',
  },
  {
    key: 'permitir_venta_sin_stock',
    label: 'Permitir vender sin stock',
    detalle: 'El negocio pidió que no se pueda comprometer producto que no está en bodega.',
  },
  {
    key: 'descontar_hielo_del_peso',
    label: 'Descontar el hielo del peso facturado',
    detalle: 'Al preparar, el peso neto se calcula restando el hielo del peso de balanza.',
  },
  {
    key: 'precios_netos',
    label: 'Los precios se manejan netos (sin IVA)',
    detalle: 'El IVA se agrega al facturar.',
  },
  {
    key: 'cobra_despacho',
    label: 'Se cobra el despacho',
    detalle: 'Hoy el reparto va incluido en el precio.',
  },
]

export function Configuracion() {
  const qc = useQueryClient()
  const { profile } = useAuth()
  const [empresa, setEmpresa] = useState<Valores>({})
  const [operacion, setOperacion] = useState<Valores>({})
  const [guardado, setGuardado] = useState(false)

  const settings = useQuery({
    queryKey: ['settings-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('settings').select('key, value')
      if (error) throw error
      const map: Record<string, Valores> = {}
      for (const s of data as { key: string; value: Valores }[]) map[s.key] = s.value
      return map
    },
  })

  useEffect(() => {
    if (settings.data) {
      setEmpresa(settings.data.empresa ?? {})
      setOperacion(settings.data.operacion ?? {})
    }
  }, [settings.data])

  const guardar = useMutation({
    mutationFn: async () => {
      const [a, b] = await Promise.all([
        supabase.from('settings').update({ value: empresa }).eq('key', 'empresa'),
        supabase.from('settings').update({ value: operacion }).eq('key', 'operacion'),
      ])
      if (a.error) throw a.error
      if (b.error) throw b.error
    },
    onSuccess: () => {
      setGuardado(true)
      setTimeout(() => setGuardado(false), 2500)
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['settings-all'] })
    },
  })

  if (profile?.role !== 'admin') {
    return (
      <Card className="p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-slate-300" />
        <p className="font-medium text-slate-700">Solo el administrador puede ver la configuración</p>
      </Card>
    )
  }

  return (
    <>
      <PageHeader
        title="Configuración"
        subtitle="Datos de la empresa, parámetros del negocio y control de accesos"
        actions={
          <button onClick={() => guardar.mutate()} disabled={guardar.isPending} className="btn-primary">
            {guardar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : guardado ? <Check className="h-4 w-4" /> : null}
            {guardado ? 'Guardado' : 'Guardar cambios'}
          </button>
        }
      />

      <Link to="/trabajadores">
        <Card className="mb-4 flex items-center gap-4 p-4 hover:border-navy-300">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-white">
            <Users className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-slate-900">Cuentas y accesos</p>
            <p className="text-sm text-slate-500">
              Crear accesos, asignar roles, desactivar cuentas y editar la matriz de permisos
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </Card>
      </Link>

      {settings.isError && <ErrorState error={settings.error} />}
      {settings.isLoading && <Skeleton className="h-64" />}

      {settings.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Datos de la empresa" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {EMPRESA.map((c) => (
                <div key={c.key} className={c.ancho ? 'sm:col-span-2' : ''}>
                  <label className="label">{c.label}</label>
                  <input
                    className="input"
                    value={String(empresa[c.key] ?? '')}
                    onChange={(e) => setEmpresa({ ...empresa, [c.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Parámetros del negocio" />
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {NUMEROS.map((c) => (
                <div key={c.key}>
                  <label className="label">{c.label}</label>
                  <input
                    className="input"
                    type="number"
                    value={String(operacion[c.key] ?? '')}
                    onChange={(e) => setOperacion({ ...operacion, [c.key]: Number(e.target.value) })}
                  />
                  {c.ayuda && <p className="mt-0.5 text-[11px] text-slate-400">{c.ayuda}</p>}
                </div>
              ))}
            </div>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader title="Reglas de operación" />
            <div className="divide-y divide-slate-100">
              {INTERRUPTORES.map((c) => {
                const activo = operacion[c.key] === true
                return (
                  <div key={c.key} className="flex items-start justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{c.label}</p>
                      <p className="text-xs text-slate-500">{c.detalle}</p>
                    </div>
                    <button
                      onClick={() => setOperacion({ ...operacion, [c.key]: !activo })}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                        activo ? 'bg-sea-500' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                          activo ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                )
              })}
            </div>
          </Card>
        </div>
      )}

      {guardar.isError && <div className="mt-3"><ErrorState error={guardar.error} /></div>}

      <Card className="mt-4 flex items-start gap-3 p-4 text-xs text-slate-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>
          Cada cambio en esta pantalla queda registrado en la auditoría con tu usuario y la fecha.
          Los parámetros se aplican en la base de datos: por ejemplo, apagar «permitir vender sin
          stock» hace que la confirmación de un pedido falle si el inventario no alcanza, sin
          importar desde dónde se llame.
        </p>
      </Card>
    </>
  )
}
