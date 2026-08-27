// Resuelve a que factura apunta cada nota de credito, y la aplica.
//
// Por que existe aparte de bsale-cron: la API de Bsale devuelve `references`
// vacio en las notas de credito, asi que el vinculo hay que sacarlo del XML del
// DTE. Es un trabajo chico y con su propio ritmo (solo hay notas de vez en
// cuando), y meterlo en la cadena grande la hacia mas lenta y mas fragil sin
// necesidad.
//
// AUTORIZACION: corre sin JWT porque la invoca pg_cron, que no tiene sesion.
// Exige `x-cron-secret` contra el secreto de Vault.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MAX_POR_CORRIDA = 40
const PAUSA_MS = 150

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))

const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** El DTE declara su codificacion; leerlo como UTF-8 destroza los acentos. */
function decodificar(buf: ArrayBuffer): string {
  const cabeza = new TextDecoder('latin1').decode(buf.slice(0, 200))
  const m = cabeza.match(/encoding=['"]([\w-]+)['"]/i)
  try { return new TextDecoder((m?.[1] ?? 'utf-8').toLowerCase()).decode(buf) }
  catch { return new TextDecoder('utf-8').decode(buf) }
}
const campo = (b: string, tag: string) => {
  const m = b.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
  return m ? m[1].trim() : null
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: esperado } = await db.rpc('automation_secret_get')
  const valido = (esperado as string | null) || Deno.env.get('BSALE_CRON_SECRET') || ''
  if (!valido) return json({ error: 'Automatizacion no configurada' }, 503)
  if ((req.headers.get('x-cron-secret') ?? '') !== valido) return json({ error: 'No autorizado' }, 401)

  const { data: cxs } = await db.from('bsale_connections')
    .select('id').eq('status', 'activa').limit(1)
  const cx = cxs?.[0]
  if (!cx) return json({ error: 'Sin conexion activa' }, 400)

  const cuerpo = await req.json().catch(() => ({} as any))
  // `rehacer` vuelve a leer los XML ya procesados: sirve si se corrigio el
  // parseo y hay que recuperar notas que quedaron sin referencia.
  const rehacer = cuerpo?.rehacer === true

  let q = db.from('bsale_sales_documents')
    .select('bsale_id, number, url_xml')
    .eq('connection_id', cx.id).eq('code_sii', 61)
    .not('url_xml', 'is', null)
  if (!rehacer) q = q.is('xml_synced_at', null)
  const { data: pend } = await q.order('emission_date', { ascending: false }).limit(MAX_POR_CORRIDA)

  let leidas = 0, conReferencia = 0, fallidas = 0
  const detalle: unknown[] = []

  for (const doc of pend ?? []) {
    try {
      const res = await fetch(doc.url_xml as string, { redirect: 'follow' })
      if (!res.ok) throw new Error(`XML ${res.status}`)
      const xml = decodificar(await res.arrayBuffer())

      // <Referencia> es el bloque legal que dice a que documento apunta:
      // FolioRef es el numero de la factura y CodRef que le hace
      // (1 la anula, 2 corrige el texto, 3 corrige los montos).
      const ref = xml.match(/<Referencia>[\s\S]*?<\/Referencia>/)?.[0] ?? ''
      const folio = campo(ref, 'FolioRef')

      await db.from('bsale_sales_documents').update({
        ref_tipo: num(campo(ref, 'TpoDocRef')),
        ref_folio: folio,
        ref_codigo: num(campo(ref, 'CodRef')),
        ref_razon: campo(ref, 'RazonRef'),
        xml_synced_at: new Date().toISOString(),
        xml_error: folio ? null : 'El XML no trae <Referencia>',
      }).eq('connection_id', cx.id).eq('bsale_id', doc.bsale_id)

      leidas++
      if (folio) {
        conReferencia++
        detalle.push({ nota: doc.number, anula: folio,
          codigo: num(campo(ref, 'CodRef')), razon: campo(ref, 'RazonRef') })
      }
    } catch (e) {
      fallidas++
      await db.from('bsale_sales_documents').update({
        xml_synced_at: new Date().toISOString(),
        xml_error: e instanceof Error ? e.message : String(e),
      }).eq('connection_id', cx.id).eq('bsale_id', doc.bsale_id)
    }
    await dormir(PAUSA_MS)
  }

  // Con las referencias ya resueltas, vincular y descontar.
  const aplicado = await db.rpc('aplicar_notas_credito', { _dry_run: false })
  if (aplicado.error) return json({ ok: false, error: aplicado.error.message }, 500)

  return json({ ok: true, xml_leidos: leidas, con_referencia: conReferencia,
    fallidos: fallidas, detalle, aplicacion: aplicado.data })
})
