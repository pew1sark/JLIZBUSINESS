// Sincronizacion programada de Bsale, de punta a punta.
//
// Corre la cadena completa sobre una ventana corta (el mes en curso y el
// anterior), que es donde aparecen los documentos nuevos y las correcciones:
//
//   COMPRAS
//   1. libro de compras             -> bsale_third_party_documents
//   2. detalle desde el XML del DTE -> bsale_document_items
//   3. volcado al ERP               -> suppliers + purchases
//   4. clasificacion y costos       -> purchase_items + avg_cost + ventas costeadas
//
//   VENTAS
//   5. documentos emitidos          -> bsale_sales_documents + bsale_sales_items
//   6. volcado al ERP               -> customers + invoices + invoice_items
//
// AUTORIZACION: esta funcion corre sin JWT porque la invoca pg_cron, que
// no tiene sesion. Exige `x-cron-secret` contra el secreto guardado en
// Vault. Sin ese encabezado no hace nada, asi que exponerla no abre nada.
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const PAGINA = 50        // maximo documentado por Bsale
const PAUSA_MS = 130     // ~7 req/s, holgado frente al limite de 10 req/s
const MAX_PAGINAS = 30
const MAX_XML = 80

// Documentos de venta que SI son tributarios. La nota de venta, la cotizacion
// y la guia de despacho no son ventas facturadas y se dejan fuera.
const SII_VENTA = [33, 34, 39, 41, 56, 61]

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms))
const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---------- LA RED HACIA LA PROPIA API DEL PROYECTO ----------
//
// Esta funcion le habla a su propio proyecto por la URL publica, asi que cada
// consulta sale a internet y vuelve a entrar por el gateway. Ese tramo pierde
// peticiones: en 24 horas, 51 de 255 llamadas (1 de cada 5) volvieron con un
// 504 instantaneo —instantaneo, o sea que la consulta nunca llego a Postgres;
// la base estaba sana y el navegador, que entra por el mismo sitio, no vio
// ninguno—. Una corrida hace unas veinte llamadas seguidas, de modo que sin
// reintento casi ninguna terminaba: bastaba un 504 en cualquiera de ellas.
//
// De ahi salian los cuatro mensajes que mostraba Soporte —"Al guardar ventas:
// Gateway Timeout", "Al guardar documentos: Gateway Timeout", "Sin conexion
// activa", "Automatizacion no configurada"—: eran el mismo 504 cayendo en
// distintos puntos de la cadena.
const REINTENTABLES = new Set([408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524])
const MAX_INTENTOS = 5

/**
 * `fetch` con reintento para todo lo que sale hacia la API del proyecto.
 *
 * Solo reintenta los codigos de arriba, que son del gateway y no de la
 * consulta: un 400 o un 409 los devuelve tal cual para que supabase-js los
 * reporte como siempre. Es seguro porque todo lo que escribe esta cadena es
 * idempotente —upsert con `on_conflict`, y funciones de volcado pensadas para
 * correr las veces que sea— asi que repetir una llamada que quizas si llego no
 * duplica nada.
 */
async function fetchReintentando(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let ultimo = ''
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    // 250, 500, 1000 y 2000 ms, con un poco de ruido para no sincronizar
    // reintentos cuando caen varias llamadas a la vez.
    if (intento > 0) await dormir(250 * 2 ** (intento - 1) + Math.random() * 200)
    try {
      const res = await fetch(url, init)
      if (!REINTENTABLES.has(res.status)) return res
      // Hay que soltar el cuerpo o la conexion queda tomada.
      await res.body?.cancel()
      ultimo = `respondio ${res.status}`
    } catch (e) {
      ultimo = mensaje(e)
    }
  }
  const donde = typeof url === 'string' ? new URL(url).pathname : String(url)
  throw new Error(`La API del proyecto fallo en ${MAX_INTENTOS} intentos (${ultimo}) en ${donde}`)
}

async function pedir(base: string, ruta: string, token: string, intento = 0): Promise<any> {
  const res = await fetch(`${base}${ruta}`, {
    headers: { access_token: token, Accept: 'application/json' },
  })
  if (res.status === 429 || res.status >= 500) {
    if (intento >= 4) throw new Error(`Bsale respondio ${res.status} tras varios reintentos`)
    await dormir(1000 * Math.pow(2, intento))
    return pedir(base, ruta, token, intento + 1)
  }
  if (res.status === 401) throw new Error('Bsale rechazo el token (401)')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Bsale respondio ${res.status} en ${ruta}`)
  return res.json()
}

const fecha = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : null
}
const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const texto = (v: unknown) => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s === '' ? null : s
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

async function syncDocumentos(db: SupabaseClient, cx: any, token: string, year: number, month: number) {
  let offset = 0, paginas = 0, guardados = 0
  while (paginas < MAX_PAGINAS) {
    const pag = await pedir(cx.api_base_url,
      `/third_party_documents.json?limit=${PAGINA}&offset=${offset}&year=${year}&month=${month}`, token)
    paginas++
    const items: any[] = pag?.items ?? []
    if (!items.length) break
    const filas = items.map((d) => ({
      connection_id: cx.id, bsale_id: d.id,
      code_sii: num(d.codeSii), number: num(d.number),
      emission_date: fecha(d.emissionDate), sii_reception_date: fecha(d.siiReceptionDate),
      client_code: d.clientCode ?? null, client_activity: d.clientActivity ?? null,
      net_amount: num(d.netAmount), exempt_amount: num(d.exemptAmount),
      iva_amount: num(d.ivaAmount), total_amount: num(d.totalAmount),
      book_type: d.bookType ?? null, canceled: d.canceled === 1 || d.canceled === true,
      url_pdf: d.urlPdf ?? null, url_xml: d.urlXml ?? null,
      raw: d, synced_at: new Date().toISOString(),
    }))
    const { error } = await db.from('bsale_third_party_documents')
      .upsert(filas, { onConflict: 'connection_id,bsale_id' })
    if (error) throw new Error(`Al guardar documentos: ${error.message}`)
    guardados += filas.length
    offset += items.length
    if (items.length < PAGINA) break
    await dormir(PAUSA_MS)
  }
  return guardados
}

async function syncXml(db: SupabaseClient, cx: any) {
  const { data: pend, error: errPend } = await db.from('bsale_third_party_documents')
    .select('bsale_id, url_xml').eq('connection_id', cx.id)
    .is('xml_synced_at', null).not('url_xml', 'is', null)
    .order('emission_date', { ascending: false }).limit(MAX_XML)
  if (errPend) throw new Error(`Al buscar XML pendientes: ${errPend.message}`)

  let lineas = 0
  for (const doc of pend ?? []) {
    try {
      const res = await fetch(doc.url_xml, { redirect: 'follow' })
      if (!res.ok) throw new Error(`XML ${res.status}`)
      const xml = decodificar(await res.arrayBuffer())
      const bloques = xml.match(/<Detalle>[\s\S]*?<\/Detalle>/g) ?? []
      const usados = new Set<number>()
      const filas = bloques.map((b, i) => {
        let ln = num(campo(b, 'NroLinDet')) ?? i + 1
        while (usados.has(ln)) ln += 1000
        usados.add(ln)
        const q = num(campo(b, 'QtyItem'))
        const p = num(campo(b, 'PrcItem'))
        const t = num(campo(b, 'MontoItem'))
        return {
          connection_id: cx.id, bsale_document_id: doc.bsale_id, line_no: ln,
          item_code: campo(b, 'VlrCodigo'), description: campo(b, 'NmbItem') ?? 'Sin detalle',
          // El punto del DTE es separador DECIMAL, jamas de miles.
          quantity: q, unit: campo(b, 'UnmdItem'),
          unit_price: p ?? (q && t ? t / q : null),
          line_total: t, synced_at: new Date().toISOString(),
        }
      })
      if (filas.length) {
        const { error } = await db.from('bsale_document_items')
          .upsert(filas, { onConflict: 'connection_id,bsale_document_id,line_no' })
        if (error) throw new Error(error.message)
        lineas += filas.length
      }
      await db.from('bsale_third_party_documents').update({
        xml_synced_at: new Date().toISOString(), xml_error: filas.length ? null : 'Sin <Detalle>',
        supplier_name: campo(xml, 'RznSoc'), dte_type: num(campo(xml, 'TipoDTE')),
      }).eq('connection_id', cx.id).eq('bsale_id', doc.bsale_id)
    } catch (e) {
      await db.from('bsale_third_party_documents').update({
        xml_synced_at: new Date().toISOString(), xml_error: mensaje(e),
      }).eq('connection_id', cx.id).eq('bsale_id', doc.bsale_id)
    }
    await dormir(PAUSA_MS)
  }
  return lineas
}

/**
 * Documentos EMITIDOS. `/documents.json` devuelve todo lo que sale del sistema,
 * incluida la nota de venta y la guia de despacho, que no son ventas
 * facturadas: el filtro por codeSii se hace aca y no en la base para no
 * guardar basura en el staging.
 *
 * `expand=[details]` trae las lineas en la misma respuesta, pero con tope de
 * 25 por documento; cuando hay mas, se piden aparte.
 */
async function syncVentas(db: SupabaseClient, cx: any, token: string, desde: string, hasta: string) {
  const d1 = Math.floor(Date.parse(`${desde}T00:00:00Z`) / 1000)
  const d2 = Math.floor(Date.parse(`${hasta}T23:59:59Z`) / 1000)
  let offset = 0, paginas = 0, guardados = 0, lineas = 0, omitidos = 0

  while (paginas < MAX_PAGINAS) {
    const pag = await pedir(cx.api_base_url,
      `/documents.json?limit=${PAGINA}&offset=${offset}` +
      `&emissiondaterange=[${d1},${d2}]&expand=[client,document_type,details,references]`, token)
    paginas++
    const items: any[] = pag?.items ?? []
    if (!items.length) break

    const docs: any[] = []
    const dets: any[] = []

    for (const d of items) {
      const sii = num(d.document_type?.codeSii)
      if (sii === null || !SII_VENTA.includes(sii)) { omitidos++; continue }

      const c = d.client ?? {}
      const armado = [texto(c.firstName), texto(c.lastName)].filter(Boolean).join(' ')
      const nombre = texto(c.company) ?? (armado === '' ? null : armado)
      const ref = (d.references?.items ?? [])[0]

      docs.push({
        connection_id: cx.id, bsale_id: d.id, number: num(d.number), code_sii: sii,
        type_name: texto(d.document_type?.name),
        is_credit_note: d.document_type?.isCreditNote === 1 || sii === 61,
        emission_date: fecha(d.emissionDate), expiration_date: fecha(d.expirationDate),
        client_code: texto(c.code), client_name: nombre,
        client_email: texto(c.email), client_phone: texto(c.phone),
        client_address: texto(c.address) ?? texto(d.address),
        client_comuna: texto(c.municipality) ?? texto(d.municipality),
        net_amount: num(d.netAmount), exempt_amount: num(d.exemptAmount),
        tax_amount: num(d.taxAmount), total_amount: num(d.totalAmount),
        // `state` 1 y `cancellationStatus` distinto de 0 son documentos anulados.
        canceled: d.state === 1 || (num(d.cancellationStatus) ?? 0) !== 0,
        url_pdf: texto(d.urlPdf), url_xml: texto(d.urlXml),
        reference_number: ref?.number != null ? String(ref.number) : null,
        details_count: num(d.details?.count) ?? 0,
        raw: d, synced_at: new Date().toISOString(),
      })

      let lista: any[] = d.details?.items ?? []
      // Documento largo: la expansion viene recortada, se pide completo.
      if ((num(d.details?.count) ?? 0) > lista.length) {
        const extra = await pedir(cx.api_base_url, `/documents/${d.id}/details.json?limit=50`, token)
        lista = extra?.items ?? lista
        await dormir(PAUSA_MS)
      }
      lista.forEach((it: any, i: number) => {
        dets.push({
          connection_id: cx.id, bsale_document_id: d.id, line_no: i,
          variant_code: texto(it.variant?.code), variant_desc: texto(it.variant?.description),
          quantity: num(it.quantity), net_unit_value: num(it.netUnitValue),
          net_amount: num(it.netAmount), tax_amount: num(it.taxAmount),
          total_amount: num(it.totalAmount), note: texto(it.note),
          synced_at: new Date().toISOString(),
        })
      })
    }

    if (docs.length) {
      const { error } = await db.from('bsale_sales_documents')
        .upsert(docs, { onConflict: 'connection_id,bsale_id' })
      if (error) throw new Error(`Al guardar ventas: ${error.message}`)
      guardados += docs.length
    }
    if (dets.length) {
      const { error } = await db.from('bsale_sales_items')
        .upsert(dets, { onConflict: 'connection_id,bsale_document_id,line_no' })
      if (error) throw new Error(`Al guardar lineas de venta: ${error.message}`)
      lineas += dets.length
    }

    offset += items.length
    if (items.length < PAGINA) break
    await dormir(PAUSA_MS)
  }
  return { guardados, lineas, omitidos }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const db = createClient(url, service, { global: { fetch: fetchReintentando } })

  // El secreto vive en Vault; la variable de entorno es solo un respaldo.
  //
  // Los tres chequeos de aca abajo miran `error` ademas de `data`. Antes no lo
  // hacian, y una llamada caida se confundia con una respuesta vacia: el cron
  // informaba "Automatizacion no configurada" o "Sin conexion activa" cuando el
  // secreto estaba puesto y la conexion activa. Un problema de red no se puede
  // reportar como un problema de configuracion: manda a revisar el lugar
  // equivocado.
  const { data: esperado, error: errSecreto } = await db.rpc('automation_secret_get')
  if (errSecreto) return json({ error: `No se pudo leer el secreto: ${errSecreto.message}` }, 502)
  const fallback = Deno.env.get('BSALE_CRON_SECRET') ?? ''
  const valido = (esperado as string | null) || fallback
  if (!valido) return json({ error: 'Automatizacion no configurada' }, 503)
  if ((req.headers.get('x-cron-secret') ?? '') !== valido) return json({ error: 'No autorizado' }, 401)

  const { data: cxs, error: errCx } = await db.from('bsale_connections')
    .select('*').eq('status', 'activa').limit(1)
  if (errCx) return json({ error: `No se pudo leer la conexion: ${errCx.message}` }, 502)
  const cx = cxs?.[0]
  if (!cx) return json({ error: 'Sin conexion activa' }, 400)

  // Una corrida que murio sin alcanzar a registrar su error queda 'corriendo'
  // para siempre, y la consola la muestra trabada aunque ya no exista. Se
  // cierran las que a esta altura no pueden seguir vivas.
  await db.from('bsale_sync_runs')
    .update({
      status: 'error', finished_at: new Date().toISOString(),
      error: 'La corrida no alcanzo a cerrar: la funcion murio antes de registrar el resultado',
    })
    .eq('status', 'corriendo')
    .lt('started_at', new Date(Date.now() - 15 * 60_000).toISOString())

  const cuerpo = await req.json().catch(() => ({} as any))
  const soloVentas = cuerpo?.solo === 'ventas'

  // El id lo pone la funcion, no la base. Si el insert se pierde en el camino,
  // la corrida igual sabe cual es su fila y el cierre la escribe con upsert:
  // antes, un 504 en este insert dejaba `run.id` en undefined y la corrida
  // entera terminaba invisible —la consola de Soporte no mostraba nada aunque
  // la sincronizacion hubiera funcionado— y el cierre iba a parar a un
  // `?id=eq.undefined` que la base rechazaba con 400.
  const runId = crypto.randomUUID()
  const inicio = new Date().toISOString()
  const identidad = {
    id: runId, connection_id: cx.id,
    resource: soloVentas ? 'ventas' : 'cron', trigger: 'cron', started_at: inicio,
  }
  const cerrar = (campos: Record<string, unknown>) =>
    db.from('bsale_sync_runs').upsert({ ...identidad, ...campos })

  const { error: errRun } = await db.from('bsale_sync_runs')
    .insert({ ...identidad, status: 'corriendo' })
  if (errRun) console.error('No se pudo abrir la corrida:', errRun.message)

  const resumen: Record<string, unknown> = {}
  // Compras y ventas van por separado: una caida en la cadena de compras no
  // tiene por que dejar al dia sin sus ventas, que es lo que pasaba cuando un
  // solo throw cortaba todo.
  const fallas: string[] = []
  let docs = 0
  let guardadosVentas = 0
  let leidasVentas = 0

  try {
    const { data: token, error: errToken } = await db.rpc('bsale_read_token', { _connection_id: cx.id })
    if (errToken) throw new Error(`No se pudo leer el token: ${errToken.message}`)
    if (!token) throw new Error('La conexion no tiene token guardado')

    const hoy = new Date()

    if (!soloVentas) {
      try {
        // Mes en curso y el anterior: ahi aparecen los documentos nuevos y las
        // correcciones. El historico ya se trajo una vez desde la aplicacion.
        for (const atras of [0, 1]) {
          const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - atras, 1))
          docs += await syncDocumentos(db, cx, token, d.getUTCFullYear(), d.getUTCMonth() + 1)
        }
        resumen.compras_documentos = docs
        resumen.compras_lineas_xml = await syncXml(db, cx)

        const volcado = await db.rpc('bsale_apply_purchases', { _connection_id: cx.id, _dry_run: false })
        if (volcado.error) throw new Error(volcado.error.message)
        resumen.compras_volcado = volcado.data

        const clas = await db.rpc('bsale_clasificar_items', { _dry_run: false })
        if (clas.error) throw new Error(clas.error.message)

        const costos = await db.rpc('bsale_aplicar_costos', { _dry_run: false })
        if (costos.error) throw new Error(costos.error.message)
        resumen.compras_costos = costos.data
      } catch (e) {
        fallas.push(`Compras: ${mensaje(e)}`)
      }
    }

    // ---- VENTAS ----
    // Ventana en dias y no en meses: `/documents.json` filtra por rango de
    // fecha de emision, no por year/month como el libro de compras.
    try {
      const desdeVentas = cuerpo?.desde ??
        new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1)).toISOString().slice(0, 10)
      const hastaVentas = cuerpo?.hasta ?? hoy.toISOString().slice(0, 10)
      const ventas = await syncVentas(db, cx, token, desdeVentas, hastaVentas)
      resumen.ventas = { ...ventas, desde: desdeVentas, hasta: hastaVentas }
      guardadosVentas = ventas.guardados
      leidasVentas = ventas.lineas

      const volcadoV = await db.rpc('bsale_apply_sales', { _connection_id: cx.id, _dry_run: false })
      if (volcadoV.error) throw new Error(volcadoV.error.message)
      resumen.ventas_volcado = volcadoV.data
    } catch (e) {
      fallas.push(`Ventas: ${mensaje(e)}`)
    }
  } catch (e) {
    fallas.push(mensaje(e))
  }

  const error = fallas.length ? fallas.join(' · ') : null

  // El cierre tambien puede caerse, y si se cae no debe tapar el resultado del
  // trabajo: la corrida queda en 'corriendo' y la limpieza de la proxima la
  // cierra. Lo que no puede pasar es que la respuesta se pierda por esto.
  try {
    await cerrar({
      status: error ? 'error' : 'ok', finished_at: new Date().toISOString(), error,
      records_saved: docs + guardadosVentas,
      records_read: Number(resumen.compras_lineas_xml ?? 0) + leidasVentas,
    })
    await db.from('bsale_connections').update(
      error ? { last_error: error } : { last_sync_at: new Date().toISOString(), last_error: null },
    ).eq('id', cx.id)
  } catch (e) {
    console.error('No se pudo registrar el cierre de la corrida:', mensaje(e))
  }

  return error ? json({ ok: false, error, resumen }, 502) : json({ ok: true, resumen })
})
