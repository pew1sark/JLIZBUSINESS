/**
 * Análisis de pagos a proveedores.
 *
 * Todo el cálculo vive acá y no en la pantalla para poder probarlo con `npx tsx`
 * y porque la misma cuenta se usa en tres lugares: el resumen ejecutivo, la
 * evolución mensual y el ranking por proveedor.
 *
 * La distinción que ordena el módulo son cuatro fechas que no son la misma:
 *   · plazo pactado  — los días de crédito acordados con el proveedor
 *   · vencimiento    — emisión + plazo pactado
 *   · pago real      — cuándo se pagó de verdad
 *   · días de atraso — pago real − vencimiento (negativo = se pagó antes)
 */

export interface PagoProveedor {
  purchase_id: string
  code: string
  invoice_number: string | null
  dte_type: number | null
  is_credit_note: boolean
  origin: string | null
  emitida: string
  mes: string
  supplier_id: string
  proveedor: string
  razon_social: string | null
  rut: string | null
  neto_mercaderia: number
  neto_afecto: number | null
  exento: number
  iva: number
  bruto: number
  sin_desglose: boolean
  plazo_pactado: number | null
  vence: string
  vence_dte: string | null
  pagado: number
  saldo: number
  estado_pago: string
  n_pagos: number | null
  metodos: string | null
  primer_pago: string | null
  ultimo_pago: string | null
  pago_estimado: boolean
  tiene_pago_estimado: boolean
  /** La fecha de pago registrada está por delante de hoy: la plata todavía no sale. */
  pago_programado: boolean
  fecha_pago: string | null
  dias_en_pagar: number | null
  dias_atraso: number | null
  dias_vencida: number | null
  tramo: 'pagada' | 'programada' | 'por_vencer' | 'vencida' | 'nota_credito'
  document_url: string | null
  url_pdf: string | null
  url_xml: string | null
}

/**
 * Promedio ponderado por monto: una factura de $5.000.000 a 40 días pesa más que
 * una de $2.000.000 a 10 días. El promedio simple de esas dos daría 25 días; el
 * ponderado, 31,43 — que es el plazo al que efectivamente está financiada la plata.
 */
export function ponderado(
  filas: PagoProveedor[],
  valor: (f: PagoProveedor) => number | null,
  peso: (f: PagoProveedor) => number = (f) => Math.abs(Number(f.bruto)),
): number | null {
  let suma = 0
  let pesos = 0
  for (const f of filas) {
    const v = valor(f)
    if (v === null || v === undefined || !Number.isFinite(Number(v))) continue
    const p = Number(peso(f))
    if (!Number.isFinite(p) || p <= 0) continue
    suma += Number(v) * p
    pesos += p
  }
  return pesos > 0 ? suma / pesos : null
}

export function simple(filas: PagoProveedor[], valor: (f: PagoProveedor) => number | null): number | null {
  const xs = filas.map(valor).filter((v): v is number => v !== null && Number.isFinite(Number(v)))
  return xs.length ? xs.reduce((a, b) => a + Number(b), 0) / xs.length : null
}

export interface ResumenPagos {
  documentos: number
  facturado: number
  /** Lo que todavía se le debe a los proveedores, ya descontadas las notas de crédito. */
  deuda: number
  porVencer: { docs: number; monto: number }
  vencidas: { docs: number; monto: number }
  notasCredito: { docs: number; monto: number }
  pagadas: { docs: number; monto: number }
  /** Pagos ya cargados con fecha futura: comprometidos, todavía no salidos. */
  programadas: { docs: number; monto: number }
  /** Σ(monto × días de crédito) / Σ(monto). */
  plazoPonderado: number | null
  plazoSimple: number | null
  /** Días que se demoró en pagar, contados desde la emisión. */
  pagoReal: number | null
  pagoRealSimple: number | null
  /** Pago real − vencimiento. Negativo significa que se pagó antes. */
  atraso: number | null
  atrasoSimple: number | null
  /** Cuánto del período se pagó dentro del plazo. */
  aTiempo: number
  fueraDePlazo: number
  pctATiempo: number | null
  /** Facturas cuyo pago se reconstruyó a plazo fijo, no se comprobó contra el banco. */
  estimadas: number
  montoEstimado: number
  /** IVA de compras del período: es crédito fiscal, no costo. */
  neto: number
  iva: number
}

export function resumenPagos(filas: PagoProveedor[]): ResumenPagos {
  const suma = (xs: PagoProveedor[], v: (f: PagoProveedor) => number) =>
    xs.reduce((a, f) => a + Number(v(f) ?? 0), 0)

  const notas = filas.filter((f) => f.tramo === 'nota_credito')
  const porVencer = filas.filter((f) => f.tramo === 'por_vencer')
  const vencidas = filas.filter((f) => f.tramo === 'vencida')
  // Una factura con fecha de pago futura no entra al promedio de pago real: si
  // entrara, el mes en curso siempre se vería mejor de lo que todavía es.
  const pagadas = filas.filter((f) => f.tramo === 'pagada')
  const programadas = filas.filter((f) => f.tramo === 'programada')
  // El atraso solo se puede medir en lo que ya se pagó.
  const medibles = pagadas.filter((f) => f.dias_atraso !== null)
  const aTiempo = medibles.filter((f) => Number(f.dias_atraso) <= 0).length

  return {
    documentos: filas.length,
    facturado: suma(filas.filter((f) => f.tramo !== 'nota_credito'), (f) => f.bruto),
    // La nota de crédito entra con bruto negativo, así que sumarla resta deuda.
    deuda: suma([...porVencer, ...vencidas, ...notas], (f) => f.saldo),
    porVencer: { docs: porVencer.length, monto: suma(porVencer, (f) => f.saldo) },
    vencidas: { docs: vencidas.length, monto: suma(vencidas, (f) => f.saldo) },
    notasCredito: { docs: notas.length, monto: suma(notas, (f) => f.bruto) },
    pagadas: { docs: pagadas.length, monto: suma(pagadas, (f) => f.bruto) },
    programadas: { docs: programadas.length, monto: suma(programadas, (f) => f.bruto) },
    plazoPonderado: ponderado(filas.filter((f) => f.tramo !== 'nota_credito'), (f) => f.plazo_pactado),
    plazoSimple: simple(filas.filter((f) => f.tramo !== 'nota_credito'), (f) => f.plazo_pactado),
    pagoReal: ponderado(pagadas, (f) => f.dias_en_pagar),
    pagoRealSimple: simple(pagadas, (f) => f.dias_en_pagar),
    atraso: ponderado(medibles, (f) => f.dias_atraso),
    atrasoSimple: simple(medibles, (f) => f.dias_atraso),
    aTiempo,
    fueraDePlazo: medibles.length - aTiempo,
    pctATiempo: medibles.length ? Math.round((100 * aTiempo) / medibles.length) : null,
    estimadas: pagadas.filter((f) => f.pago_estimado).length,
    montoEstimado: suma(pagadas.filter((f) => f.pago_estimado), (f) => f.bruto),
    neto: suma(filas, (f) => (f.neto_afecto ?? f.neto_mercaderia)),
    iva: suma(filas, (f) => f.iva),
  }
}

export interface MesPagos {
  mes: string
  documentos: number
  facturado: number
  pagadas: number
  programadas: number
  deuda: number
  plazoPonderado: number | null
  pagoReal: number | null
  atraso: number | null
  pctATiempo: number | null
  estimadas: number
}

/** Evolución mensual por mes de EMISIÓN de la factura de compra. */
export function evolucionMensual(filas: PagoProveedor[]): MesPagos[] {
  const porMes = new Map<string, PagoProveedor[]>()
  for (const f of filas) {
    const xs = porMes.get(f.mes)
    if (xs) xs.push(f)
    else porMes.set(f.mes, [f])
  }
  return [...porMes.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, xs]) => {
      const r = resumenPagos(xs)
      return {
        mes,
        documentos: r.documentos,
        facturado: r.facturado,
        pagadas: r.pagadas.docs,
        programadas: r.programadas.docs,
        deuda: r.deuda,
        plazoPonderado: r.plazoPonderado,
        pagoReal: r.pagoReal,
        atraso: r.atraso,
        pctATiempo: r.pctATiempo,
        estimadas: r.estimadas,
      }
    })
}

export interface ProveedorPagos {
  supplier_id: string
  proveedor: string
  razon_social: string | null
  rut: string | null
  documentos: number
  facturado: number
  deuda: number
  vencidas: number
  montoVencido: number
  plazoPonderado: number | null
  pagoReal: number | null
  atraso: number | null
  pctATiempo: number | null
  estimadas: number
  ultimaCompra: string | null
  ultimoPago: string | null
}

export function rankingProveedores(filas: PagoProveedor[]): ProveedorPagos[] {
  const porProv = new Map<string, PagoProveedor[]>()
  for (const f of filas) {
    const xs = porProv.get(f.supplier_id)
    if (xs) xs.push(f)
    else porProv.set(f.supplier_id, [f])
  }
  const max = (xs: (string | null)[]) => {
    const v = xs.filter((x): x is string => !!x).sort()
    return v.length ? v[v.length - 1] : null
  }
  return [...porProv.values()]
    .map((xs) => {
      const r = resumenPagos(xs)
      const p = xs[0]
      return {
        supplier_id: p.supplier_id,
        proveedor: p.proveedor,
        razon_social: p.razon_social,
        rut: p.rut,
        documentos: r.documentos,
        facturado: r.facturado,
        deuda: r.deuda,
        vencidas: r.vencidas.docs,
        montoVencido: r.vencidas.monto,
        plazoPonderado: r.plazoPonderado,
        pagoReal: r.pagoReal,
        atraso: r.atraso,
        pctATiempo: r.pctATiempo,
        estimadas: r.estimadas,
        ultimaCompra: max(xs.map((f) => f.emitida)),
        ultimoPago: max(xs.map((f) => f.fecha_pago)),
      }
    })
    .sort((a, b) => b.deuda - a.deuda || b.facturado - a.facturado)
}

/** Un día redondeado, con signo cuando importa el signo (atraso o adelanto). */
export const dias = (v: number | null | undefined, conSigno = false) => {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  const n = Math.round(Number(v) * 10) / 10
  return `${conSigno && n > 0 ? '+' : ''}${n.toLocaleString('es-CL', { maximumFractionDigits: 1 })} d`
}
