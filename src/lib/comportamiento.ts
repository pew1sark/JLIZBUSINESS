/**
 * Comportamiento de pago de los clientes, mes a mes.
 *
 * La vista `v_comportamiento_pago_cliente` promedia toda la historia de cada
 * cliente. Sirve para saber cómo paga en general, pero no para responder «¿en
 * marzo pagaron más lento que en febrero?», que es la pregunta que se hace al
 * revisar la cobranza del mes. Estas funciones arman ese mismo resumen sobre un
 * subconjunto de facturas, tomando el mes en que se PAGÓ (no en que se emitió).
 *
 * El promedio principal va ponderado por monto: una factura de $4.000.000 que
 * se pagó a 60 días pesa más que tres de $100.000 pagadas al contado, porque es
 * la que realmente amarra la caja.
 */

import type { ComportamientoPago, FacturaConPago } from './types'

const DOCS_QUE_SE_COBRAN = ['factura', 'boleta', 'nota_debito']

export interface MesComportamiento {
  mes: string
  facturas: number
  clientes: number
  monto: number
  /** Ponderado por monto de la factura. */
  diasPromedio: number | null
  /** Promedio simple, para comparar contra el ponderado. */
  diasSimple: number | null
  mediana: number | null
  minimo: number | null
  maximo: number | null
  aTiempo: number
  fueraDePlazo: number
  pctATiempo: number | null
  /** Días de más respecto del plazo pactado con cada cliente. */
  excesoPromedio: number | null
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function mediana(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function ponderado(xs: { valor: number; peso: number }[]): number | null {
  let suma = 0
  let pesos = 0
  for (const x of xs) {
    if (!Number.isFinite(x.valor) || !Number.isFinite(x.peso) || x.peso <= 0) continue
    suma += x.valor * x.peso
    pesos += x.peso
  }
  return pesos > 0 ? suma / pesos : null
}

/** Solo lo que se cobra y ya está pagado: sin notas de crédito y con días medibles. */
export function pagadasMedibles(facturas: FacturaConPago[]): FacturaConPago[] {
  return facturas.filter((f) =>
    DOCS_QUE_SE_COBRAN.includes(f.doc_type)
    && f.payment_status === 'pagado'
    && f.dias_en_pagar !== null
    && f.mes_pago !== null)
}

/** Un resumen por mes de pago, ordenado del más antiguo al más reciente. */
export function promedioPorMes(facturas: FacturaConPago[]): MesComportamiento[] {
  const porMes = new Map<string, FacturaConPago[]>()
  for (const f of pagadasMedibles(facturas)) {
    const mes = f.mes_pago as string
    const xs = porMes.get(mes)
    if (xs) xs.push(f)
    else porMes.set(mes, [f])
  }

  return [...porMes.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, xs]) => {
      const dias = xs.map((f) => Number(f.dias_en_pagar))
      const vsPlazo = xs.map((f) => num(f.dias_vs_plazo)).filter((v): v is number => v !== null)
      const aTiempo = vsPlazo.filter((v) => v <= 0).length
      return {
        mes,
        facturas: xs.length,
        clientes: new Set(xs.map((f) => f.customer_id)).size,
        monto: xs.reduce((a, f) => a + Number(f.total), 0),
        diasPromedio: ponderado(xs.map((f) => ({
          valor: Number(f.dias_en_pagar), peso: Math.abs(Number(f.total)),
        }))),
        diasSimple: dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : null,
        mediana: mediana(dias),
        minimo: dias.length ? Math.min(...dias) : null,
        maximo: dias.length ? Math.max(...dias) : null,
        aTiempo,
        fueraDePlazo: vsPlazo.length - aTiempo,
        pctATiempo: vsPlazo.length ? Math.round((100 * aTiempo) / vsPlazo.length) : null,
        excesoPromedio: vsPlazo.length ? vsPlazo.reduce((a, b) => a + b, 0) / vsPlazo.length : null,
      }
    })
}

/**
 * El mismo resumen por cliente que entrega la vista, pero sobre las facturas que
 * se le pasen: así el filtro por mes cambia los promedios en vez de solo esconder
 * filas. Las columnas de deuda abierta se toman de `base`, que sí mira la cartera
 * completa: cuánto debe hoy un cliente no depende del mes que se esté mirando.
 */
export function comportamientoDeFacturas(
  facturas: FacturaConPago[],
  base: ComportamientoPago[],
): ComportamientoPago[] {
  const porId = new Map(base.map((c) => [c.customer_id, c]))
  const porCliente = new Map<string, FacturaConPago[]>()
  for (const f of pagadasMedibles(facturas)) {
    const xs = porCliente.get(f.customer_id)
    if (xs) xs.push(f)
    else porCliente.set(f.customer_id, [f])
  }

  const filas: ComportamientoPago[] = []
  for (const [customerId, xs] of porCliente) {
    const b = porId.get(customerId)
    const dias = xs.map((f) => Number(f.dias_en_pagar))
    const promedio = dias.reduce((a, d) => a + d, 0) / dias.length
    const vsPlazo = xs.map((f) => num(f.dias_vs_plazo)).filter((v): v is number => v !== null)
    const aTiempo = vsPlazo.filter((v) => v <= 0).length
    const plazo = b?.plazo_pactado ?? xs[0].payment_terms_days ?? 0
    const desviacion = dias.length > 1
      ? Math.sqrt(dias.reduce((a, d) => a + (d - promedio) ** 2, 0) / (dias.length - 1))
      : null

    filas.push({
      customer_id: customerId,
      cliente: b?.cliente ?? xs[0].cliente,
      rut: b?.rut ?? xs[0].rut,
      razon_social: b?.razon_social ?? xs[0].razon_social,
      plazo_pactado: plazo,
      facturas_totales: xs.length,
      monto_total: xs.reduce((a, f) => a + Number(f.total), 0),
      primera_factura: xs.map((f) => f.issued_at).sort()[0] ?? null,
      ultima_factura: xs.map((f) => f.issued_at).sort().at(-1) ?? null,
      facturas_pagadas: xs.length,
      monto_pagado: xs.reduce((a, f) => a + Number(f.total), 0),
      dias_promedio: Math.round(promedio),
      dias_mediana: mediana(dias),
      dias_minimo: Math.min(...dias),
      dias_maximo: Math.max(...dias),
      dias_desviacion: desviacion === null ? null : Math.round(desviacion),
      // Los últimos 90 días son una ventana móvil sobre toda la historia: no
      // tiene sentido recortarla al mes filtrado, así que se deja la del servidor.
      dias_promedio_90d: b?.dias_promedio_90d ?? null,
      ultimo_pago: xs.map((f) => f.ultimo_pago).filter((v): v is string => !!v).sort().at(-1) ?? null,
      a_tiempo: aTiempo,
      fuera_de_plazo: vsPlazo.length - aTiempo,
      pct_a_tiempo: vsPlazo.length ? Math.round((100 * aTiempo) / vsPlazo.length) : null,
      // La deuda abierta es de hoy, no del mes que se está mirando.
      facturas_abiertas: b?.facturas_abiertas ?? 0,
      saldo_abierto: b?.saldo_abierto ?? 0,
      espera_maxima: b?.espera_maxima ?? null,
      espera_promedio: b?.espera_promedio ?? null,
      exceso_sobre_plazo: plazo > 0 ? Math.round(promedio) - plazo : null,
    })
  }
  return filas
}
