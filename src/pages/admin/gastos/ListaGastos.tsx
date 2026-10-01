import { Fragment, useMemo, useState } from 'react'
import clsx from 'clsx'
import { ArrowDownUp, Download, Pencil, Plus, Search } from 'lucide-react'
import { dateLong, dateShort, money, moneyShort } from '../../../lib/format'
import { descargarCsv } from '../../../lib/csv'
import {
  CATEGORIAS, COLOR_GRUPO, FRANJAS, GRUPO_LABEL, METODO_LABEL, franjaHoraria,
  type GastoManual, type GrupoGasto, type Trabajador,
} from '../../../lib/gastos'
import { Card, EmptyState, StatCard, TableWrap } from '../../../components/ui'

type Orden = 'reciente' | 'antiguo' | 'monto'

const ORDEN_LABEL: Record<Orden, string> = {
  reciente: 'Más reciente primero',
  antiguo: 'Más antiguo primero',
  monto: 'Mayor monto primero',
}

/** Fecha + hora como texto ordenable; sin hora va al final del día. */
const clave = (g: GastoManual) => `${g.fecha} ${g.hora ?? '99'}`

export function ListaGastos({ grupos, gastos, trabajadores, onNuevo, onEditar, nombreArchivo }: {
  grupos: GrupoGasto[]
  gastos: GastoManual[]
  trabajadores: Trabajador[]
  onNuevo: (g: GrupoGasto) => void
  onEditar: (g: GastoManual) => void
  nombreArchivo: string
}) {
  const [buscar, setBuscar] = useState('')
  const [categoria, setCategoria] = useState('todas')
  const [orden, setOrden] = useState<Orden>('reciente')
  const esCaja = grupos.includes('insumos')
  const nombres = useMemo(() => new Map(trabajadores.map((t) => [t.id, t.nombre])), [trabajadores])
  const nombre = (id: string | null) => (id && nombres.get(id)) || ''

  const delGrupo = useMemo(() => gastos.filter((g) => grupos.includes(g.grupo)), [gastos, grupos])

  // Categorías en el orden de la lista y luego las escritas a mano.
  const categorias = useMemo(() => {
    const m = new Map<string, { grupo: GrupoGasto; monto: number; n: number }>()
    for (const gr of grupos) for (const c of CATEGORIAS[gr]) m.set(c, { grupo: gr, monto: 0, n: 0 })
    for (const g of delGrupo) {
      const x = m.get(g.categoria) ?? { grupo: g.grupo, monto: 0, n: 0 }
      x.monto += Number(g.monto); x.n += 1
      m.set(g.categoria, x)
    }
    return [...m.entries()]
  }, [delGrupo, grupos])

  const filtrados = useMemo(() => {
    const t = buscar.trim().toLowerCase()
    const lista = delGrupo.filter((g) => {
      if (categoria !== 'todas' && g.categoria !== categoria) return false
      if (!t) return true
      return [g.categoria, g.detalle, g.lugar, g.trabajador_id && nombres.get(g.trabajador_id), String(g.monto)]
        .some((v) => (v ?? '').toLowerCase().includes(t))
    })
    return lista.sort((a, b) =>
      orden === 'monto' ? Number(b.monto) - Number(a.monto)
      : orden === 'antiguo' ? clave(a).localeCompare(clave(b))
      : clave(b).localeCompare(clave(a)))
  }, [delGrupo, buscar, categoria, orden, nombres])

  const total = filtrados.reduce((n, g) => n + Number(g.monto), 0)
  const dias = new Set(filtrados.map((g) => g.fecha)).size

  const porFranja = useMemo(() => {
    const m = new Map<string, number>(FRANJAS.map((f) => [f, 0]))
    for (const g of filtrados) m.set(franjaHoraria(g.hora), (m.get(franjaHoraria(g.hora)) ?? 0) + Number(g.monto))
    return [...m.entries()].filter(([f, v]) => v > 0 || f !== 'Sin hora')
  }, [filtrados])

  // Subtotal por día, para leer la caja chica como una planilla diaria.
  const totalDia = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of filtrados) m.set(g.fecha, (m.get(g.fecha) ?? 0) + Number(g.monto))
    return m
  }, [filtrados])
  const agruparPorDia = esCaja && orden !== 'monto'

  function exportar() {
    const filas: (string | number)[][] = [['Fecha', 'Hora', 'Tipo', 'Categoría', 'Detalle', 'Lugar', 'Trabajador', 'Forma de pago', 'Monto']]
    for (const g of filtrados) {
      filas.push([g.fecha, g.hora?.slice(0, 5) ?? '', GRUPO_LABEL[g.grupo], g.categoria, g.detalle ?? '',
        g.lugar ?? '', nombre(g.trabajador_id), METODO_LABEL[g.metodo] ?? g.metodo, Number(g.monto)])
    }
    descargarCsv(filas, nombreArchivo)
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {grupos.map((gr) => (
          <StatCard key={gr} label={GRUPO_LABEL[gr]}
            value={moneyShort(delGrupo.filter((g) => g.grupo === gr).reduce((n, g) => n + Number(g.monto), 0))}
            hint={`${delGrupo.filter((g) => g.grupo === gr).length} registros`} />
        ))}
        {esCaja && (
          <>
            <StatCard label="Promedio por día" value={moneyShort(dias ? total / dias : 0)} hint={`${dias} días con gasto`} />
            <StatCard label="Pagado con caja chica"
              value={moneyShort(filtrados.filter((g) => g.metodo === 'caja_chica').reduce((n, g) => n + Number(g.monto), 0))} />
            <StatCard label="Mayor categoría"
              value={moneyShort([...categorias].sort((a, b) => b[1].monto - a[1].monto)[0]?.[1].monto ?? 0)}
              hint={[...categorias].sort((a, b) => b[1].monto - a[1].monto)[0]?.[0] ?? '—'} />
          </>
        )}
      </div>

      <Card className="mt-4 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <p className="mr-auto text-sm font-semibold text-slate-700">Por categoría</p>
          {grupos.map((gr) => (
            <button key={gr} className="btn-primary" onClick={() => onNuevo(gr)}>
              <Plus className="h-4 w-4" /> {gr === 'insumos' ? 'Registrar gasto de caja' : `Gasto ${gr}`}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {categorias.map(([c, v]) => (
            <button key={c} onClick={() => setCategoria(categoria === c ? 'todas' : c)}
              className={clsx('flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                categoria === c ? 'bg-navy-900 text-white' : 'bg-slate-50 hover:bg-slate-100')}>
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: COLOR_GRUPO[v.grupo] }} />
              <span className="flex-1 truncate">{c}</span>
              <span className={clsx('shrink-0 tabular-nums font-medium', v.monto === 0 && categoria !== c && 'text-slate-300')}>
                {moneyShort(v.monto)}
              </span>
            </button>
          ))}
        </div>
        {esCaja && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-medium tracking-wide text-slate-500 uppercase">Por horario</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {porFranja.map(([f, v]) => (
                <div key={f} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs text-slate-500">{f}</p>
                  <p className="text-sm font-medium tabular-nums">{money(v)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      <div className="mt-4 mb-2 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar detalle, lugar, trabajador o monto…"
            value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <label className="flex items-center gap-1.5">
          <ArrowDownUp className="h-4 w-4 text-slate-400" />
          <select className="input w-auto" value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
            {(Object.keys(ORDEN_LABEL) as Orden[]).map((o) => <option key={o} value={o}>{ORDEN_LABEL[o]}</option>)}
          </select>
        </label>
        {categoria !== 'todas' && (
          <button className="text-xs text-navy-600 hover:underline" onClick={() => setCategoria('todas')}>
            Quitar filtro «{categoria}»
          </button>
        )}
        <span className="ml-auto text-xs text-slate-500">
          {filtrados.length} registros · <span className="font-semibold text-slate-800">{money(total)}</span>
        </span>
        <button onClick={exportar} className="btn-secondary" disabled={filtrados.length === 0}>
          <Download className="h-4 w-4" /> CSV
        </button>
      </div>

      {filtrados.length === 0 ? (
        <Card>
          <EmptyState title="Sin gastos en este filtro"
            hint={esCaja
              ? 'Registra cada salida de caja con su hora: colaciones, fileteo, hielo, entradas y estacionamientos, bolsas.'
              : 'Registra el TAG, los seguros, el lavado o el arreglo de la camioneta con el botón de arriba.'} />
        </Card>
      ) : (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Fecha</th>
              <th className="th">Hora</th>
              <th className="th">Categoría</th>
              <th className="th">Detalle</th>
              <th className="th">Quién</th>
              <th className="th">Forma</th>
              <th className="th text-right">Monto</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtrados.map((g, i) => {
              const nuevoDia = agruparPorDia && (i === 0 || filtrados[i - 1].fecha !== g.fecha)
              return (
                <Fragment key={g.id}>
                  {nuevoDia && (
                    <tr className="bg-slate-50/70">
                      <td colSpan={6} className="px-4 py-1.5 text-xs font-semibold text-slate-600 capitalize">
                        {dateLong(g.fecha)}
                      </td>
                      <td className="px-4 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-600">
                        {money(totalDia.get(g.fecha))}
                      </td>
                      <td />
                    </tr>
                  )}
                  <tr className="cursor-pointer hover:bg-slate-50" onClick={() => onEditar(g)}>
                    <td className="td text-slate-500">{dateShort(g.fecha)}</td>
                    <td className="td tabular-nums text-slate-500">{g.hora?.slice(0, 5) ?? '—'}</td>
                    <td className="td">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: COLOR_GRUPO[g.grupo] }} />
                        {g.categoria}
                      </span>
                    </td>
                    <td className="td td-wrap max-w-xs text-slate-600">
                      {g.detalle}
                      {g.lugar && <span className="block text-xs text-slate-400">{g.lugar}</span>}
                    </td>
                    <td className="td text-slate-500">{nombre(g.trabajador_id)}</td>
                    <td className="td text-slate-500">{METODO_LABEL[g.metodo] ?? g.metodo}</td>
                    <td className="td text-right font-medium tabular-nums">{money(g.monto)}</td>
                    <td className="td text-right">
                      <button title="Editar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-navy-700"
                        onClick={(e) => { e.stopPropagation(); onEditar(g) }}>
                        <Pencil className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </TableWrap>
      )}
    </>
  )
}
