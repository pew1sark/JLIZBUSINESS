import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AlertTriangle, ArchiveRestore, EyeOff, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ErrorState, Modal, Skeleton } from './ui'

export interface EntidadAQuitar {
  tipo: 'proveedor' | 'cliente'
  id: string
  nombre: string
  /** Lo que dice la fila en pantalla; el modal confirma contra la base igual. */
  estado?: string
}

interface Movimientos {
  tipo: string
  id: string
  nombre: string
  rut: string | null
  estado: 'activo' | 'inactivo' | 'archivado'
  historial: { que: string; n: number }[]
  accesorios: { que: string; n: number }[]
  total_historial: number
  puede_eliminar: boolean
}

/**
 * QUITAR UN CLIENTE O UN PROVEEDOR
 *
 * Son dos cosas distintas y la pantalla tiene que dejarlas separadas, porque el
 * error caro es confundirlas:
 *
 *   · Desactivar saca la ficha de las listas y se puede deshacer. La historia
 *     queda: sus facturas siguen contando en los informes.
 *   · Eliminar es definitivo, y la base solo lo permite cuando no hay nada
 *     detrás. Es para el duplicado de una carga o la ficha creada por error.
 *
 * Por eso el modal primero pregunta qué hay registrado a su nombre y recién
 * entonces muestra qué se puede hacer.
 */
export function QuitarEntidad({
  entidad, onClose, onHecho,
}: {
  entidad: EntidadAQuitar | null
  onClose: () => void
  onHecho: () => void
}) {
  const info = useQuery({
    queryKey: ['movimientos-entidad', entidad?.tipo, entidad?.id],
    enabled: !!entidad,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('movimientos_entidad', {
        _tipo: entidad!.tipo, _id: entidad!.id,
      })
      if (error) throw error
      return data as Movimientos
    },
  })

  return (
    <PanelQuitar entidad={entidad} info={info.data ?? null}
      cargando={info.isLoading} error={info.isError ? info.error : null}
      onClose={onClose} onHecho={onHecho} />
  )
}

/** La pantalla, separada de la consulta para poder revisarla con datos fijos. */
function PanelQuitar({
  entidad, info: m, cargando, error, onClose, onHecho,
}: {
  entidad: EntidadAQuitar | null
  info: Movimientos | null
  cargando: boolean
  error: unknown
  onClose: () => void
  onHecho: () => void
}) {
  const [confirmacion, setConfirmacion] = useState('')

  useEffect(() => { setConfirmacion('') }, [entidad?.id])
  const activo = m?.estado === 'activo'
  const tabla = entidad?.tipo === 'proveedor' ? 'suppliers' : 'customers'

  const cambiarEstado = useMutation({
    mutationFn: async (estado: 'activo' | 'inactivo') => {
      const { error } = await supabase.from(tabla).update({ status: estado }).eq('id', entidad!.id)
      if (error) throw error
    },
    onSuccess: () => { onHecho(); onClose() },
  })

  const eliminar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('eliminar_entidad', {
        _tipo: entidad!.tipo, _id: entidad!.id,
        _confirm: confirmacion.trim(), _dry_run: false,
      })
      if (error) throw error
    },
    onSuccess: () => { onHecho(); onClose() },
  })

  const nombreOk = !!m && confirmacion.trim().toLowerCase() === m.nombre.trim().toLowerCase()

  return (
    <Modal
      open={!!entidad}
      onClose={onClose}
      title={`Quitar ${entidad?.tipo === 'proveedor' ? 'proveedor' : 'cliente'}`}
      footer={<button onClick={onClose} className="btn-secondary">Cerrar</button>}
    >
      {cargando && <Skeleton className="h-40" />}
      {!!error && <ErrorState error={error} />}

      {m && (
        <div className="space-y-4">
          <div>
            <p className="text-base font-semibold text-navy-900">{m.nombre}</p>
            <p className="text-xs text-slate-400">
              {m.rut ?? 'sin RUT'} ·{' '}
              <span className={activo ? 'text-emerald-600' : 'text-amber-600'}>
                {activo ? 'activo' : m.estado}
              </span>
            </p>
          </div>

          {/* Qué se pierde y qué no. Sin esto, «eliminar» es una apuesta. */}
          {m.total_historial > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-medium text-slate-700">
                Tiene {m.total_historial} movimiento(s) registrados
              </p>
              <ul className="mt-1.5 space-y-0.5 text-sm text-slate-500">
                {m.historial.map((h) => (
                  <li key={h.que} className="flex justify-between gap-4">
                    <span>{h.que}</span>
                    <span className="tabular-nums font-medium text-slate-700">{h.n}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-400">
                Por eso no se puede eliminar: se llevaría por delante plata y documentos que los
                informes siguen usando. Desactivarlo lo saca de las listas y deja la historia igual.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <p className="text-sm font-medium text-emerald-800">Sin movimientos registrados</p>
              <p className="mt-1 text-xs text-emerald-700">
                No tiene compras, facturas, pedidos ni pagos: se puede eliminar del todo sin perder
                nada. Es el caso del duplicado o de la ficha creada por error.
              </p>
              {m.accesorios.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-emerald-700">
                  {m.accesorios.map((a) => (
                    <li key={a.que}>· Se borran también sus {a.que.toLowerCase()} ({a.n})</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* -------------------------------------------------- desactivar */}
          <div className="rounded-lg border border-slate-200 px-4 py-3">
            <p className="text-sm font-medium text-slate-700">
              {activo ? 'Desactivar' : 'Reactivar'}
            </p>
            <p className="mt-0.5 mb-2.5 text-xs text-slate-500">
              {activo
                ? `Deja de aparecer al crear ${entidad?.tipo === 'proveedor' ? 'compras' : 'pedidos'}, pero sigue en los informes y en su historial. Se puede volver atrás cuando quieras.`
                : 'Vuelve a aparecer en las listas para operar con él.'}
            </p>
            <button
              onClick={() => cambiarEstado.mutate(activo ? 'inactivo' : 'activo')}
              disabled={cambiarEstado.isPending}
              className="btn-secondary"
            >
              {activo ? <EyeOff className="h-4 w-4" /> : <ArchiveRestore className="h-4 w-4" />}
              {cambiarEstado.isPending ? 'Guardando…' : activo ? 'Desactivar' : 'Reactivar'}
            </button>
            {cambiarEstado.isError && <div className="mt-2"><ErrorState error={cambiarEstado.error} /></div>}
          </div>

          {/* ---------------------------------------------------- eliminar */}
          {m.puede_eliminar && (
            <div className="rounded-lg border border-red-200 px-4 py-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
                <AlertTriangle className="h-4 w-4" /> Eliminar definitivamente
              </p>
              <p className="mt-0.5 mb-2.5 text-xs text-slate-500">
                No se puede deshacer. Queda registrado en la auditoría con todos los datos de la
                ficha, por si hiciera falta reconstruirla.
                {entidad?.tipo === 'proveedor' && m.rut && (
                  <span className="mt-1 block">
                    Si es el único proveedor con este RUT y vuelve a llegar una factura suya desde
                    Bsale, la ficha se va a crear de nuevo sola.
                  </span>
                )}
              </p>
              {/* El nombre va fuera de la etiqueta: `.label` lo pondría en
                  mayúsculas y parecería que hay que escribirlo así. */}
              <label className="block">
                <span className="label">Escribe el nombre para confirmar</span>
                <input className="input" value={confirmacion} autoComplete="off"
                  onChange={(e) => setConfirmacion(e.target.value)} placeholder={m.nombre} />
              </label>
              <p className="mt-1 text-xs text-slate-500">
                Tal cual está escrito: <span className="font-medium text-slate-700">{m.nombre}</span>
              </p>
              <button
                onClick={() => eliminar.mutate()}
                disabled={!nombreOk || eliminar.isPending}
                className="btn-danger mt-2.5"
              >
                <Trash2 className="h-4 w-4" />
                {eliminar.isPending ? 'Eliminando…' : 'Eliminar definitivamente'}
              </button>
              {eliminar.isError && <div className="mt-2"><ErrorState error={eliminar.error} /></div>}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
