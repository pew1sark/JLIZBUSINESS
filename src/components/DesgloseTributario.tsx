import clsx from 'clsx'
import { money } from '../lib/format'

/**
 * El desglose tributario de una factura de compra, tal como cuadra con el SII.
 *
 * Las líneas suman exacto: afecto + exento + IVA = total. Antes se listaba
 * primero «neto de mercadería» y después «exento», y en una factura exenta —un
 * peaje, por ejemplo— la misma plata aparecía dos veces y el total no calzaba
 * con lo de arriba.
 *
 * El neto de mercadería sigue estando, pero como nota debajo del afecto: es la
 * base del costo por kilo, no una línea del documento. La diferencia entre uno
 * y otro son los conceptos que vienen en la misma factura y no son pescado
 * (peajes, combustible, servicios).
 */
export function DesgloseTributario({
  netoMercaderia, netoAfecto, exento, iva, bruto, pagado, saldo, flete = 0,
}: {
  /** `purchases.total`: neto de la mercadería, la base del costeo. */
  netoMercaderia: number
  /** `purchases.net_amount`: el afecto del DTE. null cuando no hay desglose del SII. */
  netoAfecto: number | null
  exento: number
  iva: number
  bruto: number
  pagado?: number
  saldo?: number
  /** Flete y otros costos, que ya están dentro del neto de mercadería. */
  flete?: number
}) {
  const afecto = Number(netoAfecto ?? 0)
  const exe = Number(exento)
  const otros = netoAfecto === null ? 0 : afecto + exe - Number(netoMercaderia)

  return (
    <dl className="divide-y divide-slate-50 px-4 py-1 text-sm">
      {netoAfecto === null ? (
        <Linea k="Neto de mercadería" v={money(netoMercaderia)}
          nota="El documento no trae el desglose del SII" />
      ) : (
        <>
          {afecto !== 0 && (
            <Linea k="Neto afecto" v={money(afecto)}
              nota={Math.round(otros) !== 0
                ? `Mercadería ${money(netoMercaderia - exe)} · otros conceptos ${money(otros)}`
                : undefined} />
          )}
          {exe !== 0 && (
            <Linea k="Exento" v={money(exe)}
              nota={afecto === 0 ? 'Documento sin IVA: peajes, seguros o servicios exentos' : undefined} />
          )}
        </>
      )}

      {flete > 0 && (
        <Linea k="Flete y otros costos" v={money(flete)}
          nota="Ya repartidos en el costo por kilo; vienen dentro del neto" />
      )}

      <Linea k="IVA" v={Number(iva) === 0 ? 'sin IVA' : money(iva)} />
      <Linea k="Total con IVA" v={money(bruto)} fuerte />
      {pagado !== undefined && Number(pagado) > 0 && (
        <Linea k="Pagado" v={`− ${money(pagado)}`} />
      )}
      {saldo !== undefined && <Linea k="Saldo por pagar" v={money(saldo)} fuerte />}
    </dl>
  )
}

function Linea({ k, v, nota, fuerte }: { k: string; v: string; nota?: string; fuerte?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className={clsx('text-slate-500', fuerte && 'font-medium text-slate-700')}>
        {k}
        {nota && <span className="block text-xs text-slate-400">{nota}</span>}
      </dt>
      <dd className={clsx('shrink-0 tabular-nums', fuerte ? 'font-semibold text-navy-900' : 'text-slate-600')}>
        {v}
      </dd>
    </div>
  )
}
