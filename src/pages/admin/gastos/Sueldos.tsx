import { useMemo, useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, Pencil, Plus, UserPlus, UserRound } from 'lucide-react'
import { dateShort, money, moneyShort } from '../../../lib/format'
import { nombreMes, type Periodo } from '../../../lib/periodo'
import {
  METODO_LABEL, TIPO_ABONO_LABEL, hoyIso, inicioMes, mesesDelPeriodo,
  type Abono, type TipoAbono, type Trabajador,
} from '../../../lib/gastos'
import { Card, EmptyState, StatCard, TableWrap } from '../../../components/ui'
import type { AbonoAEditar } from './Formularios'

/** Lo que se le paga al trabajador en la mano y descuenta del sueldo pactado. */
const AL_SUELDO: TipoAbono[] = ['sueldo_final', 'quincena', 'anticipo']

export function Sueldos({ periodo, trabajadores, abonos, onAbono, onTrabajador }: {
  periodo: Periodo
  trabajadores: Trabajador[]
  abonos: Abono[]
  onAbono: (a: AbonoAEditar) => void
  onTrabajador: (t: Partial<Trabajador>) => void
}) {
  const [abierto, setAbierto] = useState<string | null>(null)
  const [verInactivos, setVerInactivos] = useState(false)
  const meses = mesesDelPeriodo(periodo, abonos)
  // Un abono nuevo va al mes que se está mirando (el último, si el rango es largo).
  const mesNuevo = inicioMes(periodo.hasta ?? hoyIso())

  const porTrabajador = useMemo(() => {
    const m = new Map<string, Abono[]>()
    for (const a of abonos) m.set(a.trabajador_id, [...(m.get(a.trabajador_id) ?? []), a])
    return m
  }, [abonos])

  const visibles = trabajadores.filter((t) => t.activo || verInactivos || porTrabajador.has(t.id))
  const inactivos = trabajadores.filter((t) => !t.activo).length

  const suma = (lista: Abono[], tipos?: TipoAbono[]) =>
    lista.filter((a) => !tipos || tipos.includes(a.tipo)).reduce((n, a) => n + Number(a.monto), 0)

  const totalPagado = suma(abonos)
  const totalCotiz = suma(abonos, ['cotizaciones'])
  const pactado = trabajadores.filter((t) => t.activo).reduce((n, t) => n + Number(t.sueldo_base), 0) * meses
  const pagadoAlSueldo = suma(abonos, AL_SUELDO)
  const pendiente = Math.max(0, pactado - pagadoAlSueldo)
  const nombre = (id: string) => trabajadores.find((t) => t.id === id)?.nombre ?? '—'

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Pagado en sueldos" value={moneyShort(totalPagado)}
          hint={`${abonos.length} abonos · todo incluido`} />
        <StatCard label="Sueldos pactados" value={moneyShort(pactado)}
          hint={meses > 1 ? `${meses} meses × planilla activa` : 'planilla activa del mes'} />
        <StatCard label="Falta por pagar" value={moneyShort(pendiente)}
          tone={pendiente > 0 ? 'warning' : 'positive'}
          hint="pactado − (sueldo final + quincenas + anticipos)" />
        <StatCard label="Cotizaciones" value={moneyShort(totalCotiz)} hint="AFP, salud y seguro" />
      </div>

      <div className="mt-4 mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold text-slate-700">
          Planilla · {trabajadores.filter((t) => t.activo).length} trabajadores activos
        </h2>
        {inactivos > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
            Ver inactivos ({inactivos})
          </label>
        )}
        <button className="btn-secondary" onClick={() => onTrabajador({})}>
          <UserPlus className="h-4 w-4" /> Agregar trabajador
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {visibles.map((t) => {
          const lista = porTrabajador.get(t.id) ?? []
          const base = Number(t.sueldo_base) * meses
          const alSueldo = suma(lista, AL_SUELDO)
          const avance = base > 0 ? Math.min(100, (alSueldo / base) * 100) : 0
          const quincenas = lista.filter((a) => a.tipo === 'quincena')
          const filas: [string, number, string?][] = [
            ['Quincenas', suma(lista, ['quincena']), quincenas.length > 0 ? `${quincenas.length}` : undefined],
            ['Sueldo final', suma(lista, ['sueldo_final'])],
            ['Cotizaciones', suma(lista, ['cotizaciones'])],
            ['Anticipos, bonos y otros', suma(lista, ['anticipo', 'bono', 'otro'])],
          ]
          return (
            <Card key={t.id} className={clsx('flex flex-col', !t.activo && 'opacity-60')}>
              <button className="flex items-start gap-3 p-4 pb-2 text-left" onClick={() => onTrabajador(t)}
                title="Ver y editar el perfil">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-50 text-navy-700">
                  <UserRound className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-slate-900">{t.nombre}</span>
                  <span className="block truncate text-xs text-slate-400">
                    {[t.cargo, t.rut].filter(Boolean).join(' · ') || 'Completa el perfil'}
                  </span>
                </span>
                <Pencil className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-300" />
              </button>

              <div className="px-4">
                <div className="flex items-baseline justify-between text-xs text-slate-500">
                  <span>Pactado {meses > 1 ? `(${meses} meses)` : ''}</span>
                  <span className="tabular-nums">{base > 0 ? money(base) : 'sin definir'}</span>
                </div>
                {base > 0 && (
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"
                    title={`Pagado al sueldo: ${money(alSueldo)} de ${money(base)}`}>
                    <div className={clsx('h-full rounded-full', avance >= 100 ? 'bg-emerald-500' : 'bg-navy-500')}
                      style={{ width: `${avance}%` }} />
                  </div>
                )}
                <dl className="mt-3 space-y-1 text-sm">
                  {filas.map(([k, v, extra]) => (
                    <div key={k} className="flex justify-between gap-2">
                      <dt className="text-slate-500">{k}{extra && <span className="ml-1 text-xs text-slate-400">×{extra}</span>}</dt>
                      <dd className={clsx('tabular-nums', v > 0 ? 'text-slate-800' : 'text-slate-300')}>{money(v)}</dd>
                    </div>
                  ))}
                  <div className="flex justify-between gap-2 border-t border-slate-100 pt-1 font-semibold">
                    <dt>Total abonado</dt>
                    <dd className="tabular-nums">{money(suma(lista))}</dd>
                  </div>
                  {base > 0 && (
                    <div className="flex justify-between gap-2 text-xs">
                      <dt className="text-slate-500">Falta por pagar</dt>
                      <dd className={clsx('tabular-nums', base - alSueldo > 0 ? 'text-amber-600' : 'text-emerald-600')}>
                        {money(Math.max(0, base - alSueldo))}
                      </dd>
                    </div>
                  )}
                </dl>
              </div>

              <div className="mt-auto flex flex-wrap gap-1.5 p-4 pt-3">
                {(['quincena', 'sueldo_final', 'cotizaciones'] as TipoAbono[]).map((tipo) => (
                  <button key={tipo} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200"
                    onClick={() => onAbono({ trabajadorId: t.id, periodo: mesNuevo, tipo })}>
                    + {TIPO_ABONO_LABEL[tipo]}
                  </button>
                ))}
                <button className="rounded-md bg-sea-50 px-2 py-1 text-xs font-medium text-sea-700 hover:bg-sea-100"
                  onClick={() => onAbono({ trabajadorId: t.id, periodo: mesNuevo, tipo: 'otro' })}>
                  <Plus className="inline h-3 w-3" /> Otro abono
                </button>
              </div>

              {lista.length > 0 && (
                <div className="border-t border-slate-100">
                  <button className="flex w-full items-center justify-between px-4 py-2 text-xs text-slate-500 hover:bg-slate-50"
                    onClick={() => setAbierto(abierto === t.id ? null : t.id)}>
                    Ver {lista.length} abono{lista.length === 1 ? '' : 's'}
                    <ChevronDown className={clsx('h-3.5 w-3.5 transition', abierto === t.id && 'rotate-180')} />
                  </button>
                  {abierto === t.id && (
                    <ul className="divide-y divide-slate-50 pb-1">
                      {lista.map((a) => (
                        <li key={a.id}>
                          <button className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-xs hover:bg-slate-50"
                            onClick={() => onAbono({ abono: a, trabajadorId: t.id, periodo: a.periodo })}>
                            <span className="w-14 shrink-0 text-slate-400">{dateShort(a.fecha_pago)}</span>
                            <span className="flex-1 truncate text-slate-600">
                              {TIPO_ABONO_LABEL[a.tipo]}{a.detalle ? ` · ${a.detalle}` : ''}
                            </span>
                            <span className="tabular-nums font-medium">{money(a.monto)}</span>
                            <Pencil className="h-3 w-3 text-slate-300" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <h2 className="mt-6 mb-2 text-sm font-semibold text-slate-700">Todos los abonos del período</h2>
      {abonos.length === 0 ? (
        <Card>
          <EmptyState title="Todavía no hay abonos en este período"
            hint="Usa los botones de cada trabajador: + Quincena, + Sueldo final, + Cotizaciones u Otro abono." />
        </Card>
      ) : (
          <TableWrap>
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Pagado el</th>
                <th className="th">Mes</th>
                <th className="th">Trabajador</th>
                <th className="th">Abono</th>
                <th className="th">Forma</th>
                <th className="th text-right">Monto</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {abonos.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="td text-slate-500">{dateShort(a.fecha_pago)}</td>
                  <td className="td capitalize text-slate-500">{nombreMes(a.periodo.slice(0, 7))}</td>
                  <td className="td font-medium">{nombre(a.trabajador_id)}</td>
                  <td className="td">
                    {TIPO_ABONO_LABEL[a.tipo]}
                    {a.detalle && <span className="ml-1 text-xs text-slate-400">{a.detalle}</span>}
                  </td>
                  <td className="td text-slate-500">{METODO_LABEL[a.metodo] ?? a.metodo}</td>
                  <td className="td text-right font-medium tabular-nums">{money(a.monto)}</td>
                  <td className="td text-right">
                    <button title="Editar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                      onClick={() => onAbono({ abono: a, trabajadorId: a.trabajador_id, periodo: a.periodo })}>
                      <Pencil className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
      )}
    </>
  )
}
