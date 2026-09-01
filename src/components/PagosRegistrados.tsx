import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDownLeft, ArrowUpRight, Download, Search } from 'lucide-react'
import clsx from 'clsx'
import { supabase } from '../lib/supabase'
import { PAYMENT_METHOD_LABEL } from '../lib/constants'
import type { PaymentMethod } from '../lib/types'
import { dateShort, money } from '../lib/format'
import { descargarCsv } from '../lib/csv'
import { mesActual, nombreMes, rangoDeMes, type Periodo } from '../lib/periodo'
import { FiltroPeriodo, Paginador, ThOrden } from './Filtros'
import { useOrden, ordenar } from '../lib/orden'
import { Card, EmptyState, ErrorState, Skeleton, StatCard, TableWrap, NombreEntidad } from './ui'

export interface PagoRegistrado {
  payment_id: string
  code: string
  direction: 'cobro' | 'pago'
  amount: number
  metodo: PaymentMethod
  fecha: string
  mes: string
  paid_at: string
  reference: string | null
  notes: string | null
  is_estimated: boolean
  registrado_at: string
  registrado_por: string | null
  contraparte: string | null
  razon_social: string | null
  rut: string | null
  supplier_id: string | null
  customer_id: string | null
  purchase_id: string | null
  compra_code: string | null
  compra_factura: string | null
  compra_fecha: string | null
  compra_total: number | null
  documentos: string | null
  imputado: number
  saldo_inicial_doc: string | null
}

type Col = 'fecha' | 'contraparte' | 'monto' | 'metodo' | 'registrado'
type Direccion = 'todos' | 'pago' | 'cobro'

/**
 * PAGOS REGISTRADOS
 *
 * Un cobro solo se podía encontrar entrando a la cartola del cliente, y un pago
 * a proveedor solo abriendo la compra. No había dónde preguntar «qué se registró
 * en marzo» o «dónde quedó la transferencia 5484588», que es lo que se necesita
 * al cuadrar contra la cartola del banco. Esta pestaña es esa búsqueda.
 */
export function PagosRegistrados() {
  const datos = useQuery({
    queryKey: ['pagos-registrados'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_pagos_registrados').select('*')
        .order('paid_at', { ascending: false })
        .limit(8000)
      if (error) throw error
      return data as PagoRegistrado[]
    },
  })

  if (datos.isError) return <ErrorState error={datos.error} />
  if (datos.isLoading) return <Skeleton className="h-96" />
  return <PanelPagosRegistrados filas={datos.data ?? []} />
}

/** La pantalla, separada de la consulta para poder probarla con datos fijos. */
function PanelPagosRegistrados({ filas: todos }: { filas: PagoRegistrado[] }) {
  // El mes completo, no «del 1 hasta hoy»: hay pagos cargados con fecha futura
  // (transferencias ya programadas) y con el corte en hoy no aparecían nunca.
  const [periodo, setPeriodo] = useState<Periodo>(() => rangoDeMes(mesActual()))
  const [direccion, setDireccion] = useState<Direccion>('todos')
  const [metodo, setMetodo] = useState<'todos' | PaymentMethod>('todos')
  const [buscar, setBuscar] = useState('')
  const [pagina, setPagina] = useState(0)
  const [porPagina, setPorPagina] = useState(50)
  const orden = useOrden<Col>('fecha')

  const filtrados = useMemo(() => {
    const t = buscar.trim().toLowerCase()
    const filas = todos.filter((p) => {
      if (periodo.desde && p.fecha < periodo.desde) return false
      if (periodo.hasta && p.fecha > periodo.hasta) return false
      if (direccion !== 'todos' && p.direction !== direccion) return false
      if (metodo !== 'todos' && p.metodo !== metodo) return false
      if (t && !(p.contraparte ?? '').toLowerCase().includes(t)
            && !(p.razon_social ?? '').toLowerCase().includes(t)
            && !(p.rut ?? '').toLowerCase().includes(t)
            && !(p.reference ?? '').toLowerCase().includes(t)
            && !(p.documentos ?? '').toLowerCase().includes(t)
            && !(p.compra_factura ?? '').toLowerCase().includes(t)
            && !p.code.toLowerCase().includes(t)) return false
      return true
    })
    return ordenar(filas, orden.orden, (p, c) => ({
      fecha: p.fecha,
      contraparte: p.contraparte,
      monto: Number(p.amount),
      metodo: p.metodo,
      registrado: p.registrado_at,
    })[c])
  }, [todos, periodo.desde, periodo.hasta, direccion, metodo, buscar, orden.orden])

  useEffect(() => { setPagina(0) }, [periodo.desde, periodo.hasta, direccion, metodo, buscar])

  const pagina1 = useMemo(
    () => filtrados.slice(pagina * porPagina, (pagina + 1) * porPagina),
    [filtrados, pagina, porPagina],
  )

  const resumen = useMemo(() => {
    const cobros = filtrados.filter((p) => p.direction === 'cobro')
    const pagos = filtrados.filter((p) => p.direction === 'pago')
    const suma = (xs: PagoRegistrado[]) => xs.reduce((a, p) => a + Number(p.amount), 0)
    return {
      cobrado: suma(cobros), cobros: cobros.length,
      pagado: suma(pagos), pagos: pagos.length,
      estimados: pagos.filter((p) => p.is_estimated).length,
    }
  }, [filtrados])

  function exportar() {
    const filas: (string | number)[][] = [[
      'Código', 'Tipo', 'Fecha', 'Contraparte', 'Razón social', 'RUT', 'Monto',
      'Forma de pago', 'N° de operación', 'Documentos', 'Estimado', 'Registrado por', 'Registrado el', 'Nota',
    ]]
    for (const p of filtrados) {
      filas.push([p.code, p.direction === 'pago' ? 'Pago a proveedor' : 'Cobro a cliente',
        p.fecha, p.contraparte ?? '', p.razon_social ?? '', p.rut ?? '', Math.round(Number(p.amount)),
        PAYMENT_METHOD_LABEL[p.metodo] ?? p.metodo, p.reference ?? '',
        p.documentos ?? p.compra_factura ?? '', p.is_estimated ? 'sí' : 'no',
        p.registrado_por ?? '', p.registrado_at?.slice(0, 10) ?? '', p.notes ?? ''])
    }
    descargarCsv(filas, `pagos-registrados-${periodo.desde ?? 'todo'}`)
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Cobrado" value={money(resumen.cobrado)} tone="positive"
          icon={<ArrowDownLeft className="h-4 w-4" />}
          hint={`${resumen.cobros} cobros a clientes`} />
        <StatCard label="Pagado" value={money(resumen.pagado)}
          icon={<ArrowUpRight className="h-4 w-4" />}
          hint={`${resumen.pagos} pagos a proveedores`} />
        <StatCard label="Diferencia" value={money(resumen.cobrado - resumen.pagado)}
          tone={resumen.cobrado - resumen.pagado >= 0 ? 'positive' : 'danger'}
          hint="Lo que entró menos lo que salió, en el filtro" />
        <StatCard label="Movimientos" value={String(filtrados.length)}
          hint={resumen.estimados ? `${resumen.estimados} con fecha estimada` : 'todos con fecha registrada'} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
        <select className="input w-auto" value={direccion}
          onChange={(e) => setDireccion(e.target.value as Direccion)}>
          <option value="todos">Cobros y pagos</option>
          <option value="cobro">Solo cobros a clientes</option>
          <option value="pago">Solo pagos a proveedores</option>
        </select>
        <select className="input w-auto" value={metodo}
          onChange={(e) => setMetodo(e.target.value as typeof metodo)}>
          <option value="todos">Toda forma de pago</option>
          {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Buscar nombre, RUT, N° de operación o factura…"
            value={buscar} onChange={(e) => setBuscar(e.target.value)} />
        </div>
        <button onClick={exportar} className="btn-secondary"><Download className="h-4 w-4" /> CSV</button>
      </div>

      {filtrados.length === 0 ? (
        <Card>
          <EmptyState title="Sin pagos registrados en este filtro"
            hint="Prueba ampliando el período o limpiando la búsqueda." />
        </Card>
      ) : (
        <>
          <TableWrap>
            <thead className="bg-slate-50">
              <tr>
                <ThOrden campo="fecha" orden={orden.orden} onOrden={orden.cambiar}>Fecha</ThOrden>
                <th className="th">Tipo</th>
                <ThOrden campo="contraparte" orden={orden.orden} onOrden={orden.cambiar} porDefecto="asc">
                  Cliente / proveedor
                </ThOrden>
                <th className="th">Documento</th>
                <ThOrden campo="metodo" orden={orden.orden} onOrden={orden.cambiar} porDefecto="asc">
                  Forma de pago
                </ThOrden>
                <th className="th">N° de operación</th>
                <ThOrden campo="monto" orden={orden.orden} onOrden={orden.cambiar} className="text-right">
                  Monto
                </ThOrden>
                <ThOrden campo="registrado" orden={orden.orden} onOrden={orden.cambiar}>Registrado</ThOrden>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pagina1.map((p) => (
                <tr key={p.payment_id} className="hover:bg-slate-50">
                  <td className="td whitespace-nowrap">
                    <span className="font-medium text-slate-700">{dateShort(p.fecha)}</span>
                    <span className="block text-xs text-slate-400 capitalize">{nombreMes(p.mes)}</span>
                  </td>
                  <td className="td">
                    <span className={clsx('badge', p.direction === 'cobro'
                      ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700')}>
                      {p.direction === 'cobro' ? 'Cobro' : 'Pago'}
                    </span>
                    {p.is_estimated && (
                      <span className="mt-1 block text-[11px] text-amber-600" title="Fecha reconstruida en la carga histórica">
                        estimado
                      </span>
                    )}
                  </td>
                  <td className="td">
                    <NombreEntidad nombre={p.contraparte} razonSocial={p.razon_social} rut={p.rut} />
                  </td>
                  <td className="td text-xs text-slate-500">
                    {p.direction === 'pago'
                      ? (p.compra_factura ? `Factura ${p.compra_factura}` : p.compra_code ?? p.saldo_inicial_doc ?? '—')
                      : (p.documentos ?? (Number(p.imputado) > 0 ? '—' : 'a cuenta'))}
                    {p.direction === 'pago' && p.compra_fecha && (
                      <span className="block text-slate-400">del {dateShort(p.compra_fecha)}</span>
                    )}
                  </td>
                  <td className="td text-slate-500">{PAYMENT_METHOD_LABEL[p.metodo] ?? p.metodo}</td>
                  <td className="td font-mono text-xs text-slate-500">{p.reference ?? '—'}</td>
                  <td className={clsx('td text-right tabular-nums font-medium',
                    p.direction === 'cobro' ? 'text-emerald-700' : 'text-slate-800')}>
                    {money(p.amount)}
                  </td>
                  <td className="td text-xs text-slate-400" title={p.registrado_por ?? ''}>
                    {p.registrado_por?.split('@')[0] ?? '—'}
                    <span className="block">{dateShort(p.registrado_at)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="card mt-3">
            <Paginador total={filtrados.length} pagina={pagina} porPagina={porPagina}
              onPagina={setPagina} onPorPagina={setPorPagina} />
          </div>
        </>
      )}
    </div>
  )
}
