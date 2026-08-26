import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Download, MessageCircle, TrendingDown, TrendingUp, Wallet,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { PaymentMethod } from '../../lib/types'
import { PAYMENT_METHOD_LABEL } from '../../lib/constants'
import { dateShort, money, moneyShort, pct } from '../../lib/format'
import { descargarCsv } from '../../lib/csv'
import { Card, EmptyState, ErrorState, Modal, PageHeader, Skeleton, StatCard, TableWrap } from '../../components/ui'

interface Kpis {
  venta_mes: number
  venta_costeada: number
  cobertura_costo_pct: number
  costo_mes: number
  margen_bruto: number
  margen_bruto_pct: number
  costos_fijos_mes: number
  costos_fijos_proporcional: number
  resultado_estimado: number
  punto_equilibrio_venta: number
  por_cobrar: number
  vencido: number
  por_pagar: number
  cobrado_mes: number
  pagado_mes: number
}

interface Cobrar {
  origen: 'pedido' | 'saldo_inicial'
  ref_id: string
  order_id: string | null
  code: string
  cliente: string
  whatsapp: string | null
  phone: string | null
  due_date: string | null
  total: number
  amount_paid: number
  saldo: number
  dias_atraso: number
  tramo: 'sin_plazo' | 'al_dia' | 'atraso_leve' | 'atraso_medio' | 'atraso_grave'
  invoice_number: string | null
}

interface Pagar {
  origen: 'compra' | 'saldo_inicial'
  ref_id: string
  purchase_id: string | null
  code: string
  proveedor: string
  issued_at: string
  saldo: number
  total: number
  dias_atraso: number
}

interface Margen {
  producto?: string
  cliente?: string
  kilos: number
  venta: number
  costo: number
  margen: number
  margen_pct: number
  pedidos?: number
}

const TRAMO: Record<Cobrar['tramo'], { label: string; clase: string }> = {
  sin_plazo: { label: 'Sin plazo', clase: 'bg-slate-100 text-slate-600' },
  al_dia: { label: 'Al día', clase: 'bg-emerald-100 text-emerald-700' },
  atraso_leve: { label: 'Atraso leve', clase: 'bg-amber-100 text-amber-800' },
  atraso_medio: { label: 'Atraso medio', clase: 'bg-orange-100 text-orange-800' },
  atraso_grave: { label: 'Atraso grave', clase: 'bg-red-100 text-red-700' },
}

type Pestana = 'cobranza' | 'pagos' | 'rentabilidad'

export function Finanzas() {
  const qc = useQueryClient()
  const [pestana, setPestana] = useState<Pestana>('cobranza')
  const [cobrar, setCobrar] = useState<Cobrar | null>(null)
  const [pagar, setPagar] = useState<Pagar | null>(null)

  const kpis = useQuery({
    queryKey: ['finance-kpis'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('finance_kpis')
      if (error) throw error
      return data as Kpis
    },
  })

  const porCobrar = useQuery({
    queryKey: ['cuentas-cobrar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_por_cobrar')
        .select('*')
        .order('dias_atraso', { ascending: false })
      if (error) throw error
      return data as Cobrar[]
    },
  })

  const porPagar = useQuery({
    queryKey: ['cuentas-pagar'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_cuentas_por_pagar')
        .select('*')
        .order('dias_atraso', { ascending: false })
      if (error) throw error
      return data as Pagar[]
    },
  })

  function refrescar() {
    qc.invalidateQueries({ queryKey: ['finance-kpis'] })
    qc.invalidateQueries({ queryKey: ['cuentas-cobrar'] })
    qc.invalidateQueries({ queryKey: ['cuentas-pagar'] })
    qc.invalidateQueries({ queryKey: ['dashboard-kpis'] })
  }

  const k = kpis.data
  // Sin costos cargados no hay margen que mostrar: cualquier resultado sería inventado.
  // Y con cobertura baja, el resultado del mes tampoco es una pérdida real:
  // es costo que falta. Por eso el aviso de pérdida exige cobertura suficiente.
  const cobertura = k?.cobertura_costo_pct ?? 0
  const sinCosto = cobertura === 0
  const costoParcial = !sinCosto && cobertura < 95
  const margenFiable = cobertura >= 80
  const enPerdida = margenFiable && (k?.resultado_estimado ?? 0) < 0

  function exportarCobranza() {
    const filas = [['Pedido', 'Cliente', 'Vence', 'Total', 'Pagado', 'Saldo', 'Días de atraso', 'Factura']]
    for (const c of porCobrar.data ?? []) {
      filas.push([c.code, c.cliente, c.due_date ?? '', String(c.total), String(c.amount_paid),
        String(c.saldo), String(c.dias_atraso), c.invoice_number ?? ''])
    }
    descargarCsv(filas, 'cuentas-por-cobrar')
  }

  return (
    <>
      <PageHeader
        title="Finanzas"
        subtitle="Cobranza, pagos a proveedores y rentabilidad real del mes"
      />

      {kpis.isError && <ErrorState error={kpis.error} />}
      {kpis.isLoading && <Skeleton className="h-24" />}

      {k && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <StatCard label="Venta del mes" value={moneyShort(k.venta_mes)} icon={<TrendingUp className="h-4 w-4" />} />
            <StatCard
              label="Margen bruto"
              value={sinCosto ? '—' : pct(k.margen_bruto_pct)}
              hint={sinCosto ? 'falta cargar el costo' : money(k.margen_bruto)}
              tone={sinCosto ? 'default' : k.margen_bruto_pct >= 25 ? 'positive' : 'warning'}
            />
            <StatCard label="Costos fijos al día" value={moneyShort(k.costos_fijos_proporcional)} hint={`de ${moneyShort(k.costos_fijos_mes)} al mes`} />
            <StatCard
              label="Resultado estimado"
              value={margenFiable ? moneyShort(k.resultado_estimado) : '—'}
              hint={margenFiable ? undefined
                    : sinCosto ? 'no calculable' : `solo ${pct(cobertura)} con costo`}
              tone={!margenFiable ? 'default' : enPerdida ? 'danger' : 'positive'}
              icon={enPerdida ? <TrendingDown className="h-4 w-4" /> : <TrendingUp className="h-4 w-4" />}
            />
            <StatCard label="Por cobrar" value={moneyShort(k.por_cobrar)} hint={`${moneyShort(k.vencido)} vencido`} tone={k.vencido > 0 ? 'danger' : 'default'} />
            <StatCard label="Por pagar" value={moneyShort(k.por_pagar)} tone={k.por_pagar > 0 ? 'warning' : 'default'} icon={<Wallet className="h-4 w-4" />} />
          </div>

          {sinCosto && (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <div>
                <p className="font-medium text-slate-800">
                  El margen del mes no se puede calcular todavía
                </p>
                <p className="text-slate-600">
                  Se facturaron {money(k.venta_mes)}, pero ninguna de esas ventas tiene el costo
                  cargado, así que cualquier margen o resultado sería inventado. El costo entra
                  al registrar las compras del período en <span className="font-medium">Compras</span>.
                </p>
              </div>
            </div>
          )}

          {costoParcial && (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div>
                <p className="font-medium text-amber-900">Margen calculado sobre parte del mes</p>
                <p className="text-amber-800/80">
                  Solo {pct(k.cobertura_costo_pct)} de la venta del mes tiene costo cargado
                  ({money(k.venta_costeada)} de {money(k.venta_mes)}). El margen que se muestra
                  corresponde a esa parte, y por eso el resultado del mes no se calcula: lo que
                  falta es costo, no ganancia. El costo entra al registrar las compras en
                  <span className="font-medium"> Compras</span>.
                </p>
              </div>
            </div>
          )}

          {enPerdida && (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div>
                <p className="font-medium text-red-900">
                  El margen del mes no alcanza a cubrir los costos fijos
                </p>
                <p className="text-red-800/80">
                  Con un margen de {pct(k.margen_bruto_pct)} se necesitan {money(k.punto_equilibrio_venta)} de
                  venta mensual para llegar a cero. Van {money(k.venta_mes)}.
                </p>
              </div>
            </div>
          )}
        </>
      )}

      <div className="mt-4 mb-3 flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm sm:w-fit">
        {([
          ['cobranza', `Cobranza${porCobrar.data?.length ? ` (${porCobrar.data.length})` : ''}`],
          ['pagos', `Pagos a proveedores${porPagar.data?.length ? ` (${porPagar.data.length})` : ''}`],
          ['rentabilidad', 'Rentabilidad'],
        ] as [Pestana, string][]).map(([k2, label]) => (
          <button
            key={k2}
            onClick={() => setPestana(k2)}
            className={`flex-1 rounded-md px-4 py-1.5 font-medium sm:flex-none ${
              pestana === k2 ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {pestana === 'cobranza' && (
        <>
          <div className="mb-3 flex justify-end">
            <button onClick={exportarCobranza} className="btn-secondary">
              <Download className="h-4 w-4" /> Exportar CSV
            </button>
          </div>
          {porCobrar.isLoading && <Skeleton className="h-56" />}
          {porCobrar.data?.length === 0 && (
            <Card><EmptyState title="No hay nada pendiente de cobro" /></Card>
          )}
          {!!porCobrar.data?.length && (
            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Cliente</th>
                  <th className="th">Pedido</th>
                  <th className="th">Vence</th>
                  <th className="th">Saldo</th>
                  <th className="th">Estado</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {porCobrar.data.map((c) => (
                  <tr key={c.ref_id} className="hover:bg-slate-50">
                    <td className="td font-medium text-slate-900">{c.cliente}</td>
                    <td className="td">
                      <p className="font-mono text-xs">{c.code}</p>
                      {c.origen === 'saldo_inicial' && (
                        <span className="badge bg-slate-100 text-slate-500">saldo anterior</span>
                      )}
                      {c.invoice_number && <p className="text-xs text-slate-400">factura {c.invoice_number}</p>}
                    </td>
                    <td className="td text-slate-500">{dateShort(c.due_date)}</td>
                    <td className="td tabular-nums font-medium">{money(c.saldo)}</td>
                    <td className="td">
                      <span className={`badge ${TRAMO[c.tramo].clase}`}>
                        {TRAMO[c.tramo].label}
                        {c.dias_atraso > 0 && ` · ${c.dias_atraso}d`}
                      </span>
                    </td>
                    <td className="td text-right whitespace-nowrap">
                      {c.whatsapp && (
                        <a
                          href={mensajeCobranza(c)}
                          target="_blank"
                          rel="noreferrer"
                          title="Enviar recordatorio por WhatsApp"
                          className="mr-1 inline-flex rounded-lg p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      )}
                      <button onClick={() => setCobrar(c)} className="btn-accent px-3 py-1.5 text-xs">
                        Registrar cobro
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
          <Card className="mt-3 p-4 text-xs text-slate-500">
            El recordatorio de WhatsApp abre la conversación con el mensaje escrito: monto, pedido y
            días de atraso. Tú decides si enviarlo — el sistema no manda nada solo.
          </Card>
        </>
      )}

      {pestana === 'pagos' && (
        <>
          {porPagar.isLoading && <Skeleton className="h-48" />}
          {porPagar.data?.length === 0 && (
            <Card><EmptyState title="No hay compras pendientes de pago" /></Card>
          )}
          {!!porPagar.data?.length && (
            <TableWrap>
              <thead className="bg-slate-50">
                <tr>
                  <th className="th">Proveedor</th>
                  <th className="th">Compra</th>
                  <th className="th">Fecha</th>
                  <th className="th">Total</th>
                  <th className="th">Saldo</th>
                  <th className="th">Atraso</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {porPagar.data.map((p) => (
                  <tr key={p.ref_id} className="hover:bg-slate-50">
                    <td className="td font-medium text-slate-900">{p.proveedor}</td>
                    <td className="td">
                      <p className="font-mono text-xs">{p.code}</p>
                      {p.origen === 'saldo_inicial' && (
                        <span className="badge bg-slate-100 text-slate-500">saldo anterior</span>
                      )}
                    </td>
                    <td className="td text-slate-500">{dateShort(p.issued_at)}</td>
                    <td className="td tabular-nums text-slate-500">{money(p.total)}</td>
                    <td className="td tabular-nums font-medium">{money(p.saldo)}</td>
                    <td className="td">
                      {p.dias_atraso > 0 ? (
                        <span className="badge bg-red-100 text-red-700">{p.dias_atraso} días</span>
                      ) : (
                        <span className="badge bg-emerald-100 text-emerald-700">Al día</span>
                      )}
                    </td>
                    <td className="td text-right">
                      <button onClick={() => setPagar(p)} className="btn-secondary px-3 py-1.5 text-xs">
                        Registrar pago
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </>
      )}

      {pestana === 'rentabilidad' && <Rentabilidad />}

      <CobroModal cobrar={cobrar} onClose={() => setCobrar(null)} onListo={refrescar} />
      <PagoModal pagar={pagar} onClose={() => setPagar(null)} onListo={refrescar} />
    </>
  )
}

function Rentabilidad() {
  const [dias, setDias] = useState(30)
  const desde = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
  const hasta = new Date().toISOString().slice(0, 10)

  const productos = useQuery({
    queryKey: ['margen-producto', dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('margin_by_product', { _desde: desde, _hasta: hasta })
      if (error) throw error
      return data as Margen[]
    },
  })

  const clientes = useQuery({
    queryKey: ['margen-cliente', dias],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('margin_by_customer', { _desde: desde, _hasta: hasta })
      if (error) throw error
      return data as Margen[]
    },
  })

  return (
    <>
      <div className="mb-3 flex gap-1 rounded-lg bg-slate-200/60 p-1 text-sm sm:w-fit">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => setDias(d)}
            className={`rounded-md px-4 py-1.5 font-medium ${dias === d ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-500'}`}
          >
            {d} días
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <TablaMargen
          titulo="Margen por producto"
          columna="Producto"
          filas={productos.data ?? []}
          cargando={productos.isLoading}
          campo="producto"
        />
        <TablaMargen
          titulo="Margen por cliente"
          columna="Cliente"
          filas={clientes.data ?? []}
          cargando={clientes.isLoading}
          campo="cliente"
        />
      </div>

      <Card className="mt-4 p-4 text-xs text-slate-500">
        El costo usado es el costo real de los lotes que salieron en cada pedido: incluye el flete y
        los costos de compra prorrateados, y en los productos procesados el costo del pescado entero
        que entró al fileteo. No es una estimación sobre el precio de lista del proveedor.
      </Card>
    </>
  )
}

function TablaMargen({
  titulo, columna, filas, cargando, campo,
}: { titulo: string; columna: string; filas: Margen[]; cargando: boolean; campo: 'producto' | 'cliente' }) {
  function exportar() {
    const cabecera = [columna, 'Kilos', 'Venta', 'Costo', 'Margen', 'Margen %']
    const datos = filas.map((f) => [
      String(f[campo] ?? ''), String(f.kilos), String(f.venta), String(f.costo),
      String(f.margen), String(f.margen_pct),
    ])
    descargarCsv([cabecera, ...datos], `margen-por-${campo}`)
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
        <button onClick={exportar} className="text-xs font-medium text-navy-600 hover:underline">
          Exportar CSV
        </button>
      </div>
      {cargando && <Skeleton className="m-4 h-40" />}
      {!cargando && filas.length === 0 && <EmptyState title="Sin ventas en el período" />}
      {filas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">{columna}</th>
                <th className="th">Venta</th>
                <th className="th">Margen</th>
                <th className="th">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filas.slice(0, 12).map((f, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="td">
                    <p className="font-medium text-slate-800">{f[campo]}</p>
                    <p className="text-xs text-slate-400">{Math.round(Number(f.kilos))} kg</p>
                  </td>
                  <td className="td tabular-nums">{moneyShort(f.venta)}</td>
                  <td className={`td tabular-nums ${Number(f.margen) < 0 ? 'text-red-600' : ''}`}>
                    {moneyShort(f.margen)}
                  </td>
                  <td className="td">
                    <span className={`badge ${Number(f.margen_pct) >= 25 ? 'bg-emerald-100 text-emerald-700' : Number(f.margen_pct) >= 10 ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'}`}>
                      {pct(f.margen_pct)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function CobroModal({
  cobrar, onClose, onListo,
}: { cobrar: Cobrar | null; onClose: () => void; onListo: () => void }) {
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia')
  const [referencia, setReferencia] = useState('')

  const guardar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('register_collection', {
        _origen: cobrar!.origen,
        _ref_id: cobrar!.ref_id,
        _amount: Number(monto) || cobrar!.saldo,
        _method: metodo,
        _reference: referencia.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      onListo()
      onClose()
      setMonto('')
      setReferencia('')
    },
  })

  return (
    <Modal
      open={!!cobrar}
      onClose={onClose}
      title={`Cobro · ${cobrar?.cliente ?? ''}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => guardar.mutate()} disabled={guardar.isPending} className="btn-primary">
            Registrar cobro
          </button>
        </>
      }
    >
      {cobrar && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-sm text-slate-600">{cobrar.code}</p>
            <p className="text-lg font-semibold text-slate-900">Saldo {money(cobrar.saldo)}</p>
            {cobrar.dias_atraso > 0 && (
              <p className="text-xs text-red-600">{cobrar.dias_atraso} días de atraso</p>
            )}
          </div>
          <div>
            <label className="label">Monto</label>
            <input className="input" type="number" placeholder={String(cobrar.saldo)} value={monto} onChange={(e) => setMonto(e.target.value)} />
            <p className="mt-1 text-xs text-slate-400">Vacío = saldo completo</p>
          </div>
          <div>
            <label className="label">Método</label>
            <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value as PaymentMethod)}>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Referencia</label>
            <input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="N° de transferencia" />
          </div>
          {guardar.isError && <ErrorState error={guardar.error} />}
        </div>
      )}
    </Modal>
  )
}

function PagoModal({
  pagar, onClose, onListo,
}: { pagar: Pagar | null; onClose: () => void; onListo: () => void }) {
  const [monto, setMonto] = useState('')
  const [metodo, setMetodo] = useState<PaymentMethod>('transferencia')
  const [referencia, setReferencia] = useState('')

  const guardar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('register_payment_out', {
        _origen: pagar!.origen,
        _ref_id: pagar!.ref_id,
        _amount: Number(monto) || pagar!.saldo,
        _method: metodo,
        _reference: referencia.trim() || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      onListo()
      onClose()
      setMonto('')
      setReferencia('')
    },
  })

  return (
    <Modal
      open={!!pagar}
      onClose={onClose}
      title={`Pago a ${pagar?.proveedor ?? ''}`}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancelar</button>
          <button onClick={() => guardar.mutate()} disabled={guardar.isPending} className="btn-primary">
            Registrar pago
          </button>
        </>
      }
    >
      {pagar && (
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-sm text-slate-600">{pagar.code}</p>
            <p className="text-lg font-semibold text-slate-900">Saldo {money(pagar.saldo)}</p>
          </div>
          <div>
            <label className="label">Monto</label>
            <input className="input" type="number" placeholder={String(pagar.saldo)} value={monto} onChange={(e) => setMonto(e.target.value)} />
          </div>
          <div>
            <label className="label">Método</label>
            <select className="input" value={metodo} onChange={(e) => setMetodo(e.target.value as PaymentMethod)}>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Referencia</label>
            <input className="input" value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="N° de transferencia o cheque" />
          </div>
          {guardar.isError && <ErrorState error={guardar.error} />}
        </div>
      )}
    </Modal>
  )
}

function mensajeCobranza(c: Cobrar) {
  const texto =
    `Hola ${c.cliente}, te escribimos de Pescadería Bilagay.\n\n` +
    `Tienes un saldo pendiente de ${money(c.saldo)} del pedido ${c.code}` +
    (c.invoice_number ? ` (factura ${c.invoice_number})` : '') +
    (c.due_date ? `, con vencimiento el ${dateShort(c.due_date)}` : '') +
    (c.dias_atraso > 0 ? `, con ${c.dias_atraso} días de atraso` : '') +
    `.\n\nCualquier duda nos avisas. ¡Gracias!`
  return `https://wa.me/${(c.whatsapp ?? '').replace(/\D/g, '')}?text=${encodeURIComponent(texto)}`
}

