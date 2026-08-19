/**
 * Consultas del portal de trabajadores.
 * Todas van contra vistas que NO contienen dinero: ni costos, ni precios, ni
 * márgenes, ni deudas. El personal de terreno no tiene acceso a las tablas
 * con valores, así que aunque llamen la API directamente no los alcanzan.
 */
import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { DeliveryStatus, OrderStatus, UnitMeasure } from './types'

export interface StockOperativo {
  product_id: string
  name: string
  sku: string | null
  presentation: string | null
  base_unit: UnitMeasure
  min_stock: number
  on_hand: number
  reserved: number
  available: number
  bajo_minimo: boolean
  lotes: number
  proximo_vencimiento: string | null
}

export interface PedidoOperativo {
  order_id: string
  code: string
  status: OrderStatus
  cliente: string
  telefono: string | null
  whatsapp: string | null
  direccion: string | null
  comuna: string | null
  delivery_date: string | null
  delivery_window: string | null
  notes: string | null
  driver_id: string | null
  total_kilos: number
  lineas: number
}

export interface ItemOperativo {
  item_id: string
  order_id: string
  product_id: string
  producto: string
  sku: string | null
  quantity_ordered: number
  quantity_prepared: number | null
  gross_weight: number | null
  ice_weight: number | null
  unit: UnitMeasure
  lote: string | null
}

export interface ParadaRuta {
  delivery_id: string
  code: string
  order_id: string
  pedido: string
  cliente: string
  telefono: string | null
  whatsapp: string | null
  direccion: string | null
  comuna: string | null
  latitude: number | null
  longitude: number | null
  horario: string | null
  status: DeliveryStatus
  sequence: number | null
  scheduled_date: string | null
  started_at: string | null
  delivered_at: string | null
  received_by_name: string | null
  notes: string | null
  total_kilos: number
}

export interface ReporteDia {
  dia: string
  pedidos: number
  entregados: number
  kilos_recibidos: number
  kilos_despachados: number
  kilos_merma: number
  kilos_procesados: number
}

export const useStockOperativo = () =>
  useQuery({
    queryKey: ['op-stock'],
    refetchInterval: 120_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_stock_operativo').select('*').order('name')
      if (error) throw error
      return data as StockOperativo[]
    },
  })

export const usePedidosOperativos = (estados?: OrderStatus[]) =>
  useQuery({
    queryKey: ['op-pedidos', estados],
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase.from('v_pedidos_operativos').select('*').order('delivery_date')
      if (estados?.length) q = q.in('status', estados)
      const { data, error } = await q
      if (error) throw error
      return data as PedidoOperativo[]
    },
  })

export const useItemsOperativos = (orderId?: string) =>
  useQuery({
    queryKey: ['op-items', orderId],
    enabled: !!orderId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_pedido_items_operativos')
        .select('*')
        .eq('order_id', orderId)
      if (error) throw error
      return data as ItemOperativo[]
    },
  })

export const useHojaRuta = (fecha?: string) =>
  useQuery({
    queryKey: ['op-ruta', fecha],
    refetchInterval: 60_000,
    queryFn: async () => {
      let q = supabase.from('v_hoja_ruta').select('*').order('sequence', { nullsFirst: false })
      if (fecha) q = q.eq('scheduled_date', fecha)
      const { data, error } = await q
      if (error) throw error
      return data as ParadaRuta[]
    },
  })

export const useReportesOperativos = () =>
  useQuery({
    queryKey: ['op-reportes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_reportes_operativos')
        .select('*')
        .order('dia', { ascending: false })
      if (error) throw error
      return data as ReporteDia[]
    },
  })

/** Abre la dirección en la aplicación de mapas del teléfono. */
export function abrirMapa(direccion: string, comuna?: string | null) {
  const q = encodeURIComponent([direccion, comuna, 'Chile'].filter(Boolean).join(', '))
  const esApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
  window.open(esApple ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`, '_blank')
}
