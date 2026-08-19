import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { History, Search, ShieldCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { AuditLog } from '../../lib/types'
import { dateTime } from '../../lib/format'
import { descargarCsv } from '../../lib/csv'
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, TableWrap } from '../../components/ui'

const ACCION_LABEL: Record<string, { texto: string; clase: string }> = {
  INSERT: { texto: 'Creación', clase: 'bg-emerald-100 text-emerald-700' },
  UPDATE: { texto: 'Modificación', clase: 'bg-blue-100 text-blue-700' },
  DELETE: { texto: 'Eliminación', clase: 'bg-red-100 text-red-700' },
  CAMBIO_ROL: { texto: 'Cambio de rol', clase: 'bg-violet-100 text-violet-700' },
  ACTIVAR_CUENTA: { texto: 'Cuenta activada', clase: 'bg-emerald-100 text-emerald-700' },
  DESACTIVAR_CUENTA: { texto: 'Cuenta desactivada', clase: 'bg-red-100 text-red-700' },
}

const TABLA_LABEL: Record<string, string> = {
  orders: 'Pedidos',
  order_items: 'Líneas de pedido',
  products: 'Productos',
  inventory_lots: 'Lotes',
  purchases: 'Compras',
  customers: 'Clientes',
  payments: 'Pagos',
  deliveries: 'Entregas',
  losses: 'Mermas',
  profiles: 'Usuarios',
  role_permissions: 'Permisos',
  settings: 'Configuración',
  user_invitations: 'Invitaciones',
}

export function Auditoria() {
  const [tabla, setTabla] = useState('')
  const [busca, setBusca] = useState('')
  const [detalle, setDetalle] = useState<AuditLog | null>(null)

  const registros = useQuery({
    queryKey: ['audit', tabla],
    queryFn: async () => {
      let q = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300)
      if (tabla) q = q.eq('table_name', tabla)
      const { data, error } = await q
      if (error) throw error
      return data as AuditLog[]
    },
  })

  const filtrados = useMemo(() => {
    const t = busca.trim().toLowerCase()
    if (!t) return registros.data ?? []
    return (registros.data ?? []).filter(
      (r) =>
        (r.user_email ?? '').toLowerCase().includes(t) ||
        (r.record_id ?? '').toLowerCase().includes(t) ||
        (r.reason ?? '').toLowerCase().includes(t),
    )
  }, [registros.data, busca])

  function exportar() {
    const filas = [['Fecha', 'Usuario', 'Acción', 'Tabla', 'Registro', 'Motivo']]
    for (const r of filtrados) {
      filas.push([
        dateTime(r.created_at), r.user_email ?? 'sistema', r.action,
        TABLA_LABEL[r.table_name] ?? r.table_name, r.record_id ?? '', r.reason ?? '',
      ])
    }
    descargarCsv(filas, 'auditoria')
  }

  return (
    <>
      <PageHeader
        title="Auditoría"
        subtitle="Quién cambió qué, cuándo y con qué valores"
        actions={
          <>
            <select className="input w-auto" value={tabla} onChange={(e) => setTabla(e.target.value)}>
              <option value="">Todas las áreas</option>
              {Object.entries(TABLA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <div className="relative">
              <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-slate-400" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Usuario, registro…" className="input w-52 pl-9" />
            </div>
            <button onClick={exportar} className="btn-secondary">Exportar</button>
          </>
        }
      />

      {registros.isError && <ErrorState error={registros.error} />}
      {registros.isLoading && <Skeleton className="h-64" />}
      {!registros.isLoading && filtrados.length === 0 && (
        <Card><EmptyState title="Sin registros" icon={<History className="h-8 w-8" />} /></Card>
      )}

      {filtrados.length > 0 && (
        <TableWrap>
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Fecha</th>
              <th className="th">Usuario</th>
              <th className="th">Acción</th>
              <th className="th">Área</th>
              <th className="th">Registro</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtrados.map((r) => {
              const a = ACCION_LABEL[r.action] ?? { texto: r.action, clase: 'bg-slate-100 text-slate-600' }
              return (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="td whitespace-nowrap text-slate-500">{dateTime(r.created_at)}</td>
                  <td className="td text-slate-700">{r.user_email ?? <span className="text-slate-400">sistema</span>}</td>
                  <td className="td"><span className={`badge ${a.clase}`}>{a.texto}</span></td>
                  <td className="td text-slate-600">{TABLA_LABEL[r.table_name] ?? r.table_name}</td>
                  <td className="td font-mono text-xs text-slate-400">{(r.record_id ?? '').slice(0, 14)}</td>
                  <td className="td text-right">
                    {r.changes && Object.keys(r.changes).length > 0 && (
                      <button onClick={() => setDetalle(r)} className="text-xs font-medium text-navy-600 hover:underline">
                        Ver cambios
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </TableWrap>
      )}

      {detalle && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={() => setDetalle(null)}>
          <div className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-semibold text-slate-900">
                {TABLA_LABEL[detalle.table_name] ?? detalle.table_name}
              </h3>
              <p className="text-xs text-slate-500">
                {detalle.user_email ?? 'sistema'} · {dateTime(detalle.created_at)}
              </p>
              {detalle.reason && <p className="mt-1 text-xs text-slate-600">{detalle.reason}</p>}
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
              {Object.entries(detalle.changes ?? {}).map(([campo, v]) => (
                <div key={campo} className="rounded-lg border border-slate-100 p-3">
                  <p className="text-xs font-medium text-slate-500">{campo}</p>
                  <div className="mt-1 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded bg-red-50 px-2 py-1">
                      <p className="text-[10px] text-red-500 uppercase">Antes</p>
                      <p className="break-all text-red-900">{formatear(v.antes)}</p>
                    </div>
                    <div className="rounded bg-emerald-50 px-2 py-1">
                      <p className="text-[10px] text-emerald-600 uppercase">Después</p>
                      <p className="break-all text-emerald-900">{formatear(v.despues)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Card className="mt-4 flex items-start gap-3 p-4 text-xs text-slate-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>
          La bitácora es inmutable: nadie —tampoco el administrador— puede editarla ni borrarla, y
          la escribe la base de datos por sí sola en cada cambio de pedidos, inventario, precios,
          pagos, cuentas y configuración.
        </p>
      </Card>
    </>
  )
}

function formatear(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 160)
  return String(v)
}
