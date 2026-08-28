import { dateShort, money } from './format'

/**
 * Una fila de deuda, venga de la cartola o de la pantalla de finanzas.
 * Solo se pide lo que entra en el mensaje.
 */
export interface DocDeuda {
  documento: string
  issued_at: string | null
  due_date: string | null
  total: number
  saldo: number
  dias_atraso: number
}

/**
 * Presupuesto de caracteres del mensaje ya codificado para la URL. WhatsApp
 * empieza a cortar mensajes pasados los ~2000 y el cliente se llevaría una
 * lista incompleta sin darse cuenta, así que se recorta acá y se dice cuántos
 * documentos quedaron fuera.
 */
const PRESUPUESTO_URL = 1900

/**
 * Arma el mensaje de cobranza. Es la carta que el encargado de pagos va a
 * reenviar a su jefatura, así que va en tono formal, con el detalle documento
 * por documento y sin reproches: el objetivo es que paguen, no que se ofendan.
 */
export function mensajeCobro(
  cliente: string,
  docs: DocDeuda[],
  opts: {
    soloVencido: boolean
    empresa: string
    deudaTotal: number
    /**
     * El recorte existe solo por el límite de la URL de WhatsApp. Por correo
     * sobra: cortar la lista ahí dejaría al cliente con un detalle incompleto
     * sin ninguna razón.
     */
    sinRecorte?: boolean
  },
): string {
  const monto = docs.reduce((a, d) => a + Number(d.saldo), 0)
  const linea = (d: DocDeuda) => {
    const partes = [`Factura ${d.documento}`]
    if (d.issued_at) partes.push(`emitida el ${dateShort(d.issued_at)}`)
    if (d.due_date) {
      partes.push(d.dias_atraso > 0
        ? `venció el ${dateShort(d.due_date)} (${d.dias_atraso} ${d.dias_atraso === 1 ? 'día' : 'días'})`
        : `vence el ${dateShort(d.due_date)}`)
    }
    return `• ${partes.join(', ')} — ${money(d.saldo)}`
  }

  /** Arma el mensaje completo mostrando las primeras `n` facturas. */
  const armar = (n: number) => {
    const resto = docs.length - n
    const l: string[] = []
    l.push(`Estimados de ${cliente}:`)
    l.push('')
    l.push(`Junto con saludar, les escribimos de ${empresaLarga(opts.empresa)} para informar el estado de sus documentos pendientes de pago a la fecha.`)
    l.push('')
    l.push(opts.soloVencido
      ? `DOCUMENTOS VENCIDOS (${docs.length})`
      : `DOCUMENTOS PENDIENTES (${docs.length})`)
    l.push(...docs.slice(0, n).map(linea))
    if (resto > 0) l.push(`• … y ${resto} ${resto === 1 ? 'documento más' : 'documentos más'}`)
    l.push('')
    l.push(opts.soloVencido ? `Total vencido: ${money(monto)}` : `Total pendiente: ${money(monto)}`)
    if (opts.soloVencido && opts.deudaTotal > monto) {
      l.push(`Deuda total con documentos por vencer: ${money(opts.deudaTotal)}`)
    }
    if (resto > 0) l.push('El detalle completo va adjunto o disponible en el portal de pagos.')
    l.push('')
    l.push('Agradeceremos regularizar a la brevedad o indicarnos una fecha estimada de pago para coordinar internamente.')
    l.push('')
    l.push('Si detectan alguna diferencia en los documentos, quedamos atentos para revisarla en conjunto.')
    l.push('')
    l.push('Saludos cordiales,')
    l.push(empresaLarga(opts.empresa))
    return l.join('\n')
  }

  // Se muestra el máximo de facturas que quepa. Se mide el mensaje completo y
  // no solo el listado, porque el saludo y el cierre ya gastan buena parte del
  // presupuesto y con 40 facturas WhatsApp cortaba la lista en silencio.
  let n = docs.length
  let texto = armar(n)
  if (opts.sinRecorte) return texto
  while (n > 1 && encodeURIComponent(texto).length > PRESUPUESTO_URL) {
    n -= 1
    texto = armar(n)
  }
  return texto
}

const empresaLarga = (n: string) => n || 'Pescadería Bilagay SpA'
