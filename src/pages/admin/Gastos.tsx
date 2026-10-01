import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { FiltroPeriodo } from '../../components/Filtros'
import { rangoDe, type Periodo } from '../../lib/periodo'
import { hoyIso, inicioMes, type GastoManual, type Trabajador } from '../../lib/gastos'
import { ErrorState, PageHeader, Pestanas } from '../../components/ui'
import { useAbonos, useGastosFacturas, useGastosManuales, useTrabajadores } from './gastos/datos'
import {
  FormularioAbono, FormularioGasto, FormularioTrabajador,
  type AbonoAEditar, type GastoAEditar,
} from './gastos/Formularios'
import { Resumen } from './gastos/Resumen'
import { Sueldos } from './gastos/Sueldos'
import { ListaGastos } from './gastos/ListaGastos'
import { GastosFacturas } from './gastos/Facturas'

type Pestana = 'resumen' | 'sueldos' | 'fijos' | 'caja' | 'facturas'
const PESTANAS: Pestana[] = ['resumen', 'sueldos', 'fijos', 'caja', 'facturas']

/**
 * Gastos de la empresa en un solo lugar. Cuatro fuentes:
 * sueldos (abonos por trabajador), fijos y variables, insumos y caja chica —las
 * tres ingresadas a mano— y lo que llega en facturas de proveedores desde Bsale.
 * El filtro de período es uno solo y vale para todas las pestañas.
 */
export function Gastos() {
  const [params, setParams] = useSearchParams()
  const pestana = (PESTANAS.includes(params.get('ver') as Pestana) ? params.get('ver') : 'resumen') as Pestana
  const ir = (p: Pestana) => setParams(p === 'resumen' ? {} : { ver: p }, { replace: true })

  const [periodo, setPeriodo] = useState<Periodo>(() => rangoDe('mes_elegido'))
  const [gasto, setGasto] = useState<GastoAEditar | null>(null)
  const [abono, setAbono] = useState<AbonoAEditar | null>(null)
  const [trabajador, setTrabajador] = useState<Partial<Trabajador> | null>(null)

  const trabajadores = useTrabajadores()
  const abonos = useAbonos(periodo.desde, periodo.hasta)
  const gastos = useGastosManuales(periodo.desde, periodo.hasta)
  const facturas = useGastosFacturas(periodo.desde, periodo.hasta)

  const listaT = trabajadores.data ?? []
  const listaG = gastos.data ?? []
  const editarGasto = (g: GastoManual) => setGasto({ gasto: g, grupo: g.grupo })
  const error = trabajadores.error ?? abonos.error ?? gastos.error

  const n = (grupos: string[]) => listaG.filter((g) => grupos.includes(g.grupo)).length || undefined

  return (
    <>
      <PageHeader
        title="Gastos"
        subtitle="Sueldos, gastos fijos y variables, insumos y caja chica, y facturas de proveedores"
        actions={
          <>
            <FiltroPeriodo valor={periodo} onChange={setPeriodo} />
            <button className="btn-primary" onClick={() => setGasto({ grupo: pestana === 'fijos' ? 'fijo' : 'insumos' })}>
              <Plus className="h-4 w-4" /> Gasto
            </button>
            <button className="btn-secondary" disabled={listaT.length === 0}
              onClick={() => setAbono({
                trabajadorId: listaT.find((t) => t.activo)?.id ?? listaT[0].id,
                periodo: inicioMes(periodo.hasta ?? hoyIso()),
              })}>
              <Plus className="h-4 w-4" /> Abono de sueldo
            </button>
          </>
        }
      />

      <Pestanas className="mb-4" valor={pestana} onChange={ir} opciones={[
        { id: 'resumen', label: 'Dashboard' },
        { id: 'sueldos', label: 'Sueldos', badge: listaT.filter((t) => t.activo).length || undefined },
        { id: 'fijos', label: 'Fijos y variables', badge: n(['fijo', 'variable']) },
        { id: 'caja', label: 'Insumos y caja chica', badge: n(['insumos']) },
        { id: 'facturas', label: 'Facturas proveedores' },
      ]} />

      {error && <ErrorState error={error} />}

      {pestana === 'resumen' && (
        <Resumen periodo={periodo} trabajadores={listaT} abonos={abonos.data ?? []} gastos={listaG}
          facturas={facturas.data ?? []}
          cargando={trabajadores.isLoading || abonos.isLoading || gastos.isLoading}
          onEditarGasto={editarGasto} onIr={ir} />
      )}
      {pestana === 'sueldos' && (
        <Sueldos periodo={periodo} trabajadores={listaT} abonos={abonos.data ?? []}
          onAbono={setAbono} onTrabajador={setTrabajador} />
      )}
      {pestana === 'fijos' && (
        <ListaGastos grupos={['fijo', 'variable']} gastos={listaG} trabajadores={listaT}
          onNuevo={(grupo) => setGasto({ grupo })} onEditar={editarGasto}
          nombreArchivo={`gastos-fijos-variables-${periodo.desde ?? 'todo'}`} />
      )}
      {pestana === 'caja' && (
        <ListaGastos grupos={['insumos']} gastos={listaG} trabajadores={listaT}
          onNuevo={(grupo) => setGasto({ grupo })} onEditar={editarGasto}
          nombreArchivo={`caja-chica-${periodo.desde ?? 'todo'}`} />
      )}
      {pestana === 'facturas' && <GastosFacturas periodo={periodo} />}

      <FormularioGasto abrir={gasto} onClose={() => setGasto(null)} trabajadores={listaT} />
      <FormularioAbono abrir={abono} onClose={() => setAbono(null)} trabajadores={listaT} />
      <FormularioTrabajador abrir={trabajador} onClose={() => setTrabajador(null)} />
    </>
  )
}
