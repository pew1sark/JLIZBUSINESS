import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { money } from '../../../lib/format'
import {
  CATEGORIAS, GRUPO_LABEL, METODOS, METODO_LABEL, TIPOS_ABONO, TIPO_ABONO_LABEL,
  hoyIso, inicioMes, leerMonto,
  type Abono, type GastoManual, type GrupoGasto, type TipoAbono, type Trabajador,
} from '../../../lib/gastos'
import { ErrorState, Modal } from '../../../components/ui'
import { LLAVE } from './datos'

/** Campo de monto en pesos: se escribe con o sin puntos y muestra el valor leído. */
function CampoMonto({ valor, onChange, autoFocus, label = 'Monto' }: {
  valor: string; onChange: (v: string) => void; autoFocus?: boolean; label?: string
}) {
  const n = leerMonto(valor)
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input tabular-nums" inputMode="numeric" placeholder="Ej: 12.500" autoFocus={autoFocus}
        value={valor} onChange={(e) => onChange(e.target.value)} />
      {n > 0 && <span className="mt-1 block text-xs text-slate-400">{money(n)}</span>}
    </label>
  )
}

/** Botón de borrar que pide confirmación con un segundo toque. */
function BotonBorrar({ onBorrar, pendiente }: { onBorrar: () => void; pendiente: boolean }) {
  const [seguro, setSeguro] = useState(false)
  useEffect(() => {
    if (!seguro) return
    const t = setTimeout(() => setSeguro(false), 4000)
    return () => clearTimeout(t)
  }, [seguro])
  return (
    <button type="button" disabled={pendiente}
      className={seguro ? 'btn-danger mr-auto' : 'btn-secondary mr-auto text-red-600'}
      onClick={() => (seguro ? onBorrar() : setSeguro(true))}>
      <Trash2 className="h-4 w-4" /> {seguro ? '¿Borrar? Toca de nuevo' : 'Borrar'}
    </button>
  )
}

// ------------------------------------------------------------------ gasto
export interface GastoAEditar {
  /** Sin id es un gasto nuevo. */
  gasto?: GastoManual
  grupo: GrupoGasto
}

export function FormularioGasto({ abrir, onClose, trabajadores }: {
  abrir: GastoAEditar | null
  onClose: () => void
  trabajadores: Trabajador[]
}) {
  const qc = useQueryClient()
  const g = abrir?.gasto
  const [grupo, setGrupo] = useState<GrupoGasto>('insumos')
  const [categoria, setCategoria] = useState('')
  const [otra, setOtra] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [hora, setHora] = useState('')
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState('efectivo')
  const [lugar, setLugar] = useState('')
  const [trabajador, setTrabajador] = useState('')
  const [detalle, setDetalle] = useState('')

  useEffect(() => {
    if (!abrir) return
    const gr = abrir.gasto?.grupo ?? abrir.grupo
    const lista = CATEGORIAS[gr]
    const cat = abrir.gasto?.categoria ?? lista[0]
    setGrupo(gr)
    setCategoria(lista.includes(cat) ? cat : '__otra')
    setOtra(lista.includes(cat) ? '' : cat)
    setFecha(abrir.gasto?.fecha ?? hoyIso())
    setHora(abrir.gasto?.hora?.slice(0, 5)
      ?? (gr === 'insumos' ? new Date().toTimeString().slice(0, 5) : ''))
    setMonto(abrir.gasto ? String(abrir.gasto.monto) : '')
    setMetodo(abrir.gasto?.metodo ?? (gr === 'insumos' ? 'caja_chica' : 'transferencia'))
    setLugar(abrir.gasto?.lugar ?? '')
    setTrabajador(abrir.gasto?.trabajador_id ?? '')
    setDetalle(abrir.gasto?.detalle ?? '')
  }, [abrir])

  const categoriaFinal = categoria === '__otra' ? otra.trim() : categoria

  const fila = () => ({
    grupo, categoria: categoriaFinal, fecha, hora: hora || null, monto: leerMonto(monto), metodo,
    lugar: lugar.trim() || null, trabajador_id: trabajador || null, detalle: detalle.trim() || null,
  })

  const guardar = useMutation({
    mutationFn: async (otroMas: boolean) => {
      const { error } = g
        ? await supabase.from('gastos_manuales').update(fila()).eq('id', g.id)
        : await supabase.from('gastos_manuales').insert(fila())
      if (error) throw error
      return otroMas
    },
    onSuccess: (otroMas) => {
      qc.invalidateQueries({ queryKey: [LLAVE] })
      // «Guardar y otro» deja fecha, categoría y forma de pago para cargar la caja del día seguido.
      if (otroMas) { setMonto(''); setDetalle(''); setLugar('') } else onClose()
    },
  })

  const borrar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('gastos_manuales').delete().eq('id', g!.id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [LLAVE] }); onClose() },
  })

  const valido = !!fecha && !!categoriaFinal && leerMonto(monto) > 0

  return (
    <Modal open={!!abrir} onClose={onClose}
      title={g ? 'Editar gasto' : `Nuevo gasto · ${GRUPO_LABEL[grupo]}`}
      footer={
        <>
          {g && <BotonBorrar pendiente={borrar.isPending} onBorrar={() => borrar.mutate()} />}
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          {!g && (
            <button className="btn-secondary" disabled={!valido || guardar.isPending}
              onClick={() => guardar.mutate(true)}>Guardar y otro</button>
          )}
          <button className="btn-primary" disabled={!valido || guardar.isPending}
            onClick={() => guardar.mutate(false)}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Tipo de gasto</span>
            <select className="input" value={grupo} onChange={(e) => {
              const gr = e.target.value as GrupoGasto
              setGrupo(gr); setCategoria(CATEGORIAS[gr][0]); setOtra('')
            }}>
              {(Object.keys(GRUPO_LABEL) as GrupoGasto[]).map((k) =>
                <option key={k} value={k}>{GRUPO_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Categoría</span>
            <select className="input" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              {CATEGORIAS[grupo].map((c) => <option key={c} value={c}>{c}</option>)}
              <option value="__otra">Otra (escribir)…</option>
            </select>
          </label>
        </div>
        {categoria === '__otra' && (
          <label className="block">
            <span className="label">Nombre de la categoría</span>
            <input className="input" value={otra} onChange={(e) => setOtra(e.target.value)} autoFocus />
          </label>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">Fecha</span>
            <input type="date" className="input" value={fecha} onChange={(e) => setFecha(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Hora {grupo !== 'insumos' && '(opcional)'}</span>
            <input type="time" className="input" value={hora} onChange={(e) => setHora(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CampoMonto valor={monto} onChange={setMonto} autoFocus={!g} />
          <label className="block">
            <span className="label">Forma de pago</span>
            <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {METODOS.map((m) => <option key={m} value={m}>{METODO_LABEL[m]}</option>)}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Lugar o proveedor</span>
            <input className="input" placeholder="Ej: Terminal Pesquero, Copec, taller…"
              value={lugar} onChange={(e) => setLugar(e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Quién lo gastó / para quién</span>
            <select className="input" value={trabajador} onChange={(e) => setTrabajador(e.target.value)}>
              <option value="">—</option>
              {trabajadores.filter((t) => t.activo || t.id === trabajador).map((t) =>
                <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="label">Detalle</span>
          <input className="input" placeholder="Ej: 3 sacos de hielo, patente BXYZ12…"
            value={detalle} onChange={(e) => setDetalle(e.target.value)} />
        </label>

        {guardar.isError && <ErrorState error={guardar.error} />}
        {borrar.isError && <ErrorState error={borrar.error} />}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ abono de sueldo
export interface AbonoAEditar {
  abono?: Abono
  trabajadorId: string
  /** Mes al que corresponde, YYYY-MM-01. */
  periodo: string
  tipo?: TipoAbono
}

export function FormularioAbono({ abrir, onClose, trabajadores }: {
  abrir: AbonoAEditar | null
  onClose: () => void
  trabajadores: Trabajador[]
}) {
  const qc = useQueryClient()
  const a = abrir?.abono
  const [trabajador, setTrabajador] = useState('')
  const [mes, setMes] = useState('')
  const [tipo, setTipo] = useState<TipoAbono>('sueldo_final')
  const [monto, setMonto] = useState('')
  const [fechaPago, setFechaPago] = useState(hoyIso())
  const [metodo, setMetodo] = useState('transferencia')
  const [detalle, setDetalle] = useState('')

  useEffect(() => {
    if (!abrir) return
    setTrabajador(abrir.abono?.trabajador_id ?? abrir.trabajadorId)
    setMes((abrir.abono?.periodo ?? abrir.periodo).slice(0, 7))
    setTipo(abrir.abono?.tipo ?? abrir.tipo ?? 'sueldo_final')
    setMonto(abrir.abono ? String(abrir.abono.monto) : '')
    setFechaPago(abrir.abono?.fecha_pago ?? hoyIso())
    setMetodo(abrir.abono?.metodo ?? 'transferencia')
    setDetalle(abrir.abono?.detalle ?? '')
  }, [abrir])

  const fila = () => ({
    trabajador_id: trabajador, periodo: inicioMes(`${mes}-01`), tipo, monto: leerMonto(monto),
    fecha_pago: fechaPago, metodo, detalle: detalle.trim() || null,
  })

  const guardar = useMutation({
    mutationFn: async () => {
      const { error } = a
        ? await supabase.from('sueldo_abonos').update(fila()).eq('id', a.id)
        : await supabase.from('sueldo_abonos').insert(fila())
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [LLAVE] }); onClose() },
  })

  const borrar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('sueldo_abonos').delete().eq('id', a!.id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [LLAVE] }); onClose() },
  })

  const t = trabajadores.find((x) => x.id === trabajador)
  const valido = !!trabajador && /^\d{4}-\d{2}$/.test(mes) && leerMonto(monto) > 0 && !!fechaPago

  return (
    <Modal open={!!abrir} onClose={onClose}
      title={a ? 'Editar abono' : `Nuevo abono${t ? ` · ${t.nombre}` : ''}`}
      footer={
        <>
          {a && <BotonBorrar pendiente={borrar.isPending} onBorrar={() => borrar.mutate()} />}
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!valido || guardar.isPending}
            onClick={() => guardar.mutate()}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Trabajador</span>
            <select className="input" value={trabajador} onChange={(e) => setTrabajador(e.target.value)}>
              {trabajadores.filter((x) => x.activo || x.id === trabajador).map((x) =>
                <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Mes que se paga</span>
            <input type="month" className="input" value={mes} onChange={(e) => setMes(e.target.value)} />
          </label>
        </div>

        <div>
          <span className="label">Tipo de abono</span>
          <div className="flex flex-wrap gap-2">
            {TIPOS_ABONO.map((k) => (
              <button key={k} type="button" onClick={() => setTipo(k)}
                className={tipo === k
                  ? 'rounded-lg bg-navy-900 px-3 py-1.5 text-sm font-medium text-white'
                  : 'rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200'}>
                {TIPO_ABONO_LABEL[k]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <CampoMonto valor={monto} onChange={setMonto} autoFocus={!a} />
          <label className="block">
            <span className="label">Fecha de pago</span>
            <input type="date" className="input" value={fechaPago} onChange={(e) => setFechaPago(e.target.value)} />
          </label>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="label">Forma de pago</span>
            <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value)}>
              {METODOS.map((m) => <option key={m} value={m}>{METODO_LABEL[m]}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="label">Detalle (opcional)</span>
            <input className="input" placeholder="Ej: 1ª quincena, AFP + salud…"
              value={detalle} onChange={(e) => setDetalle(e.target.value)} />
          </label>
        </div>

        {t && t.sueldo_base > 0 && (
          <p className="text-xs text-slate-400">Sueldo pactado de {t.nombre}: {money(t.sueldo_base)} al mes.</p>
        )}
        {guardar.isError && <ErrorState error={guardar.error} />}
        {borrar.isError && <ErrorState error={borrar.error} />}
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ ficha del trabajador
export function FormularioTrabajador({ abrir, onClose }: {
  /** `null` cerrado; `{}` nuevo; con id, edita. */
  abrir: Partial<Trabajador> | null
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [f, setF] = useState<Partial<Trabajador>>({})
  const [sueldo, setSueldo] = useState('')

  useEffect(() => {
    if (!abrir) return
    setF(abrir)
    setSueldo(abrir.sueldo_base ? String(abrir.sueldo_base) : '')
  }, [abrir])

  const set = (k: keyof Trabajador) => (e: { target: { value: string } }) =>
    setF((x) => ({ ...x, [k]: e.target.value }))

  const guardar = useMutation({
    mutationFn: async () => {
      const limpio = (v: unknown) => (typeof v === 'string' ? v.trim() || null : v ?? null)
      const fila = {
        nombre: (f.nombre ?? '').trim(),
        rut: limpio(f.rut), cargo: limpio(f.cargo), telefono: limpio(f.telefono),
        fecha_ingreso: limpio(f.fecha_ingreso), afp: limpio(f.afp), salud: limpio(f.salud),
        banco: limpio(f.banco), cuenta: limpio(f.cuenta), notas: limpio(f.notas),
        sueldo_base: leerMonto(sueldo), activo: f.activo ?? true,
      }
      const { error } = f.id
        ? await supabase.from('trabajadores').update(fila).eq('id', f.id)
        : await supabase.from('trabajadores').insert({ ...fila, orden: 99 })
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: [LLAVE] }); onClose() },
  })

  const campo = (k: keyof Trabajador, label: string, props: Record<string, string> = {}) => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" value={(f[k] as string | null) ?? ''} onChange={set(k)} {...props} />
    </label>
  )

  return (
    <Modal open={!!abrir} onClose={onClose} wide
      title={f.id ? `Perfil de ${abrir?.nombre ?? ''}` : 'Nuevo trabajador'}
      footer={
        <>
          {f.id && (
            <label className="mr-auto flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={f.activo ?? true}
                onChange={(e) => setF((x) => ({ ...x, activo: e.target.checked }))} />
              Activo en la planilla
            </label>
          )}
          <button className="btn-secondary" onClick={onClose}>Cancelar</button>
          <button className="btn-primary" disabled={!(f.nombre ?? '').trim() || guardar.isPending}
            onClick={() => guardar.mutate()}>
            {guardar.isPending ? 'Guardando…' : 'Guardar perfil'}
          </button>
        </>
      }>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {campo('nombre', 'Nombre completo', { autoFocus: 'true' })}
        {campo('rut', 'RUT', { placeholder: '12.345.678-9' })}
        {campo('cargo', 'Cargo', { placeholder: 'Ej: Fileteador, chofer, ventas…' })}
        {campo('telefono', 'Teléfono')}
        {campo('fecha_ingreso', 'Fecha de ingreso', { type: 'date' })}
        <CampoMonto label="Sueldo pactado (mensual)" valor={sueldo} onChange={setSueldo} />
        {campo('afp', 'AFP')}
        {campo('salud', 'Salud (Fonasa / Isapre)')}
        {campo('banco', 'Banco')}
        {campo('cuenta', 'Tipo y N° de cuenta')}
        <label className="block sm:col-span-2">
          <span className="label">Notas</span>
          <textarea className="input" rows={2} value={f.notas ?? ''} onChange={set('notas')} />
        </label>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        El monto es el sueldo pactado por mes: sirve para ver cuánto falta por pagarle a cada uno.
      </p>
      {guardar.isError && <ErrorState error={guardar.error} />}
    </Modal>
  )
}
