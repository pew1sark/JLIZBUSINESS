import { useState } from 'react'
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { descargarCsv } from '../../lib/csv'
import { dateShort, money } from '../../lib/format'
import { ORDER_STATUS_LABEL, LOSS_REASON_LABEL, MOVEMENT_LABEL } from '../../lib/constants'
import { Card, ErrorState, PageHeader } from '../../components/ui'

type Rango = { desde: string; hasta: string }

interface Reporte {
  id: string
  titulo: string
  descripcion: string
  generar: (r: Rango) => Promise<(string | number | null)[][]>
}

const hoy = () => new Date().toISOString().slice(0, 10)
const haceDias = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)

const REPORTES: Reporte[] = [
  {
    id: 'ventas',
    titulo: 'Ventas del período',
    descripcion: 'Pedido a pedido: cliente, estado, neto, IVA, total, pagado y saldo. Es el que pide el contador.',
    generar: async ({ desde, hasta }) => {
      const { data, error } = await supabase
        .from('orders')
        .select('code, order_date, delivery_date, status, total, cost_total, amount_paid, payment_status, invoice_number, customers(name)')
        .neq('status', 'cancelado')
        .gte('order_date', desde)
        .lte('order_date', hasta + 'T23:59:59')
        .order('order_date')
      if (error) throw error
      const filas: (string | number | null)[][] = [[
        'Pedido', 'Fecha', 'Entrega', 'Cliente', 'Estado', 'Neto', 'IVA 19%', 'Total con IVA',
        'Costo', 'Margen', 'Pagado', 'Saldo', 'Estado de pago', 'Factura',
      ]]
      for (const o of data as never[] as {
        code: string; order_date: string; delivery_date: string | null; status: keyof typeof ORDER_STATUS_LABEL
        total: number; cost_total: number; amount_paid: number; payment_status: string
        invoice_number: string | null; customers: { name: string } | null
      }[]) {
        const iva = Math.round(Number(o.total) * 0.19)
        filas.push([
          o.code, dateShort(o.order_date), dateShort(o.delivery_date), o.customers?.name ?? '',
          ORDER_STATUS_LABEL[o.status], o.total, iva, Number(o.total) + iva,
          o.cost_total, Number(o.total) - Number(o.cost_total),
          o.amount_paid, Number(o.total) - Number(o.amount_paid), o.payment_status, o.invoice_number,
        ])
      }
      return filas
    },
  },
  {
    id: 'compras',
    titulo: 'Compras del período',
    descripcion: 'Proveedor, neto, flete, otros costos, total real y estado de pago.',
    generar: async ({ desde, hasta }) => {
      const { data, error } = await supabase
        .from('purchases')
        .select('code, purchase_date, status, subtotal, freight_cost, other_costs, total, amount_paid, payment_status, invoice_number, origin, suppliers(name)')
        .gte('purchase_date', desde)
        .lte('purchase_date', hasta)
        .order('purchase_date')
      if (error) throw error
      const filas: (string | number | null)[][] = [[
        'Compra', 'Fecha', 'Proveedor', 'Origen', 'Estado', 'Neto', 'Flete', 'Otros costos',
        'Total', 'Pagado', 'Saldo', 'Estado de pago', 'Factura',
      ]]
      for (const p of data as never[] as {
        code: string; purchase_date: string; status: string; subtotal: number; freight_cost: number
        other_costs: number; total: number; amount_paid: number; payment_status: string
        invoice_number: string | null; origin: string | null; suppliers: { name: string } | null
      }[]) {
        filas.push([
          p.code, dateShort(p.purchase_date), p.suppliers?.name ?? '', p.origin, p.status,
          p.subtotal, p.freight_cost, p.other_costs, p.total, p.amount_paid,
          Number(p.total) - Number(p.amount_paid), p.payment_status, p.invoice_number,
        ])
      }
      return filas
    },
  },
  {
    id: 'inventario',
    titulo: 'Inventario valorizado',
    descripcion: 'Stock actual por producto: físico, reservado, disponible y valor a costo real.',
    generar: async () => {
      const { data, error } = await supabase.from('v_product_stock').select('*').order('name')
      if (error) throw error
      const filas: (string | number | null)[][] = [[
        'Producto', 'SKU', 'Físico', 'Reservado', 'Disponible', 'Mínimo', 'Costo promedio',
        'Precio venta', 'Valor del stock', 'Lotes',
      ]]
      for (const p of data as {
        name: string; sku: string | null; on_hand: number; reserved: number; available: number
        min_stock: number; avg_cost: number; sale_price: number; stock_value: number; active_lots: number
      }[]) {
        filas.push([p.name, p.sku, p.on_hand, p.reserved, p.available, p.min_stock,
          p.avg_cost, p.sale_price, p.stock_value, p.active_lots])
      }
      return filas
    },
  },
  {
    id: 'margen-producto',
    titulo: 'Margen por producto',
    descripcion: 'Kilos vendidos, venta, costo real y margen por producto en el período.',
    generar: async ({ desde, hasta }) => {
      const { data, error } = await supabase.rpc('margin_by_product', { _desde: desde, _hasta: hasta })
      if (error) throw error
      const filas: (string | number | null)[][] = [['Producto', 'Kilos', 'Venta', 'Costo', 'Margen', 'Margen %']]
      for (const m of data as { producto: string; kilos: number; venta: number; costo: number; margen: number; margen_pct: number }[]) {
        filas.push([m.producto, m.kilos, m.venta, m.costo, m.margen, m.margen_pct])
      }
      return filas
    },
  },
  {
    id: 'margen-cliente',
    titulo: 'Margen por cliente',
    descripcion: 'Cuánto deja realmente cada cliente, no solo cuánto compra.',
    generar: async ({ desde, hasta }) => {
      const { data, error } = await supabase.rpc('margin_by_customer', { _desde: desde, _hasta: hasta })
      if (error) throw error
      const filas: (string | number | null)[][] = [['Cliente', 'Pedidos', 'Kilos', 'Venta', 'Costo', 'Margen', 'Margen %']]
      for (const m of data as { cliente: string; pedidos: number; kilos: number; venta: number; costo: number; margen: number; margen_pct: number }[]) {
        filas.push([m.cliente, m.pedidos, m.kilos, m.venta, m.costo, m.margen, m.margen_pct])
      }
      return filas
    },
  },
  {
    id: 'cobranza',
    titulo: 'Cuentas por cobrar',
    descripcion: 'Todo lo pendiente con días de atraso, para la gestión de cobranza.',
    generar: async () => {
      const { data, error } = await supabase.from('v_cuentas_por_cobrar').select('*').order('dias_atraso', { ascending: false })
      if (error) throw error
      const filas: (string | number | null)[][] = [[
        'Cliente', 'Pedido', 'Factura', 'Vence', 'Total', 'Pagado', 'Saldo', 'Días de atraso',
      ]]
      for (const c of data as {
        cliente: string; code: string; invoice_number: string | null; due_date: string | null
        total: number; amount_paid: number; saldo: number; dias_atraso: number
      }[]) {
        filas.push([c.cliente, c.code, c.invoice_number, dateShort(c.due_date),
          c.total, c.amount_paid, c.saldo, c.dias_atraso])
      }
      return filas
    },
  },
  {
    id: 'mermas',
    titulo: 'Mermas y pérdidas',
    descripcion: 'Kilos y costo perdidos por motivo. El desecho de fileteo va aparte, con costo cero.',
    generar: async ({ desde, hasta }) => {
      const { data, error } = await supabase
        .from('losses')
        .select('code, created_at, quantity, unit, reason, cost, notes, products(name), inventory_lots(code)')
        .gte('created_at', desde)
        .lte('created_at', hasta + 'T23:59:59')
        .order('created_at')
      if (error) throw error
      const filas: (string | number | null)[][] = [['Registro', 'Fecha', 'Producto', 'Lote', 'Cantidad', 'Motivo', 'Costo', 'Observaciones']]
      for (const l of data as never[] as {
        code: string; created_at: string; quantity: number; reason: keyof typeof LOSS_REASON_LABEL
        cost: number; notes: string | null; products: { name: string } | null; inventory_lots: { code: string } | null
      }[]) {
        filas.push([l.code, dateShort(l.created_at), l.products?.name ?? '', l.inventory_lots?.code ?? '',
          l.quantity, LOSS_REASON_LABEL[l.reason], l.cost, l.notes])
      }
      return filas
    },
  },
  {
    id: 'movimientos',
    titulo: 'Movimientos de inventario',
    descripcion: 'Libro mayor del stock: cada entrada, salida, reserva, proceso y ajuste.',
    generar: async ({ desde, hasta }) => {
      const { data, error } = await supabase
        .from('inventory_movements')
        .select('created_at, type, quantity, unit, unit_cost, reason, reference_code, products(name), inventory_lots(code)')
        .gte('created_at', desde)
        .lte('created_at', hasta + 'T23:59:59')
        .order('created_at')
        .limit(5000)
      if (error) throw error
      const filas: (string | number | null)[][] = [['Fecha', 'Movimiento', 'Producto', 'Lote', 'Cantidad', 'Costo unitario', 'Referencia', 'Motivo']]
      for (const m of data as never[] as {
        created_at: string; type: keyof typeof MOVEMENT_LABEL; quantity: number; unit_cost: number | null
        reason: string | null; reference_code: string | null
        products: { name: string } | null; inventory_lots: { code: string } | null
      }[]) {
        filas.push([dateShort(m.created_at), MOVEMENT_LABEL[m.type] ?? m.type, m.products?.name ?? '',
          m.inventory_lots?.code ?? '', m.quantity, m.unit_cost, m.reference_code, m.reason])
      }
      return filas
    },
  },
  {
    id: 'entregas',
    titulo: 'Entregas',
    descripcion: 'Cumplimiento del reparto: hora de salida, entrega, receptor y fallidas.',
    generar: async ({ desde, hasta }) => {
      const { data, error } = await supabase
        .from('deliveries')
        .select('code, status, scheduled_date, started_at, delivered_at, received_by_name, failure_reason, orders(code, customers(name))')
        .gte('scheduled_date', desde)
        .lte('scheduled_date', hasta)
        .order('scheduled_date')
      if (error) throw error
      const filas: (string | number | null)[][] = [['Entrega', 'Pedido', 'Cliente', 'Fecha', 'Estado', 'Salida', 'Entrega', 'Recibió', 'Motivo de falla']]
      for (const d of data as never[] as {
        code: string; status: string; scheduled_date: string | null; started_at: string | null
        delivered_at: string | null; received_by_name: string | null; failure_reason: string | null
        orders: { code: string; customers: { name: string } | null } | null
      }[]) {
        filas.push([d.code, d.orders?.code ?? '', d.orders?.customers?.name ?? '',
          dateShort(d.scheduled_date), d.status, d.started_at, d.delivered_at,
          d.received_by_name, d.failure_reason])
      }
      return filas
    },
  },
]

export function Reportes() {
  const [rango, setRango] = useState<Rango>({ desde: haceDias(30), hasta: hoy() })
  const [generando, setGenerando] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [ultimo, setUltimo] = useState<{ id: string; filas: number } | null>(null)

  async function generar(r: Reporte) {
    setGenerando(r.id)
    setError(null)
    try {
      const filas = await r.generar(rango)
      if (filas.length <= 1) {
        setUltimo({ id: r.id, filas: 0 })
      } else {
        descargarCsv(filas, r.id)
        setUltimo({ id: r.id, filas: filas.length - 1 })
      }
    } catch (e) {
      setError(e)
    } finally {
      setGenerando(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Reportes"
        subtitle="Exportables a CSV, listos para Excel o para el contador"
        actions={
          <>
            <input
              type="date"
              className="input w-auto"
              value={rango.desde}
              onChange={(e) => setRango({ ...rango, desde: e.target.value })}
            />
            <input
              type="date"
              className="input w-auto"
              value={rango.hasta}
              onChange={(e) => setRango({ ...rango, hasta: e.target.value })}
            />
          </>
        }
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {([['Este mes', 1], ['30 días', 30], ['90 días', 90], ['Este año', 365]] as [string, number][]).map(
          ([label, d]) => (
            <button
              key={label}
              onClick={() =>
                setRango({
                  desde: d === 1 ? new Date().toISOString().slice(0, 8) + '01' : haceDias(d),
                  hasta: hoy(),
                })
              }
              className="btn-secondary px-3 py-1.5 text-xs"
            >
              {label}
            </button>
          ),
        )}
      </div>

      {!!error && <div className="mb-3"><ErrorState error={error} /></div>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {REPORTES.map((r) => (
          <Card key={r.id} className="flex flex-col p-4">
            <div className="mb-3 flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-navy-50 text-navy-700">
                <FileSpreadsheet className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-slate-900">{r.titulo}</p>
                <p className="mt-0.5 text-xs text-slate-500">{r.descripcion}</p>
              </div>
            </div>
            <button
              onClick={() => generar(r)}
              disabled={generando === r.id}
              className="btn-secondary mt-auto w-full"
            >
              {generando === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Descargar CSV
            </button>
            {ultimo?.id === r.id && (
              <p className={`mt-1.5 text-center text-xs ${ultimo.filas ? 'text-emerald-600' : 'text-amber-600'}`}>
                {ultimo.filas ? `${ultimo.filas} filas descargadas` : 'Sin datos en el período'}
              </p>
            )}
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-4 text-xs text-slate-500">
        Los montos van netos, sin IVA, salvo la columna que lo indica: el negocio maneja precios
        netos y el impuesto se agrega al facturar. El período seleccionado aplica a todos los
        reportes salvo Inventario y Cuentas por cobrar, que muestran la foto de hoy. Para montos en
        Excel, revisa que la columna quede con formato número: el archivo trae {money(0).slice(0, 1)} sin separadores.
      </Card>
    </>
  )
}
