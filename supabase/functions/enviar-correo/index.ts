// Envia un correo desde la casilla de la empresa.
//
// Por que existe: el reporte de cobro tiene que salir SIEMPRE desde
// pescaderiabilagay@gmail.com, no desde la cuenta de quien lo manda, para que
// el cliente reconozca el remitente y las respuestas lleguen a un solo lugar.
// Eso obliga a que el envio pase por el servidor: el navegador no puede
// autenticarse como la casilla de la empresa sin tener su clave, y esa clave no
// puede bajar al navegador.
//
// AUTORIZACION: exige sesion de un administrador. La clave vive en Vault y solo
// la lee esta funcion con la llave de servicio; nunca vuelve al cliente.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { 'Content-Type': 'application/json', ...cors },
  })

/** Un correo valido y no mucho mas: el resto lo rechaza el servidor SMTP. */
const valido = (c: string) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(c.trim())

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Metodo no permitido' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization') ?? ''

  // Quien llama tiene que ser un administrador con sesion viva.
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  })
  const { data: quien } = await comoUsuario.auth.getUser()
  if (!quien?.user) return json({ error: 'Sin sesion' }, 401)

  const db = createClient(url, service)
  const { data: perfil } = await db.from('profiles')
    .select('id, full_name, role, is_active').eq('id', quien.user.id).maybeSingle()
  if (!perfil?.is_active || !['admin', 'soporte'].includes(perfil.role)) {
    return json({ error: 'Solo un administrador puede enviar correos' }, 403)
  }

  const cuerpo = await req.json().catch(() => ({} as Record<string, unknown>))
  const para = (Array.isArray(cuerpo.para) ? cuerpo.para : [])
    .map((c: unknown) => String(c).trim()).filter(valido)
  const asunto = String(cuerpo.asunto ?? '').trim()
  const texto = String(cuerpo.texto ?? '')

  if (para.length === 0) return json({ error: 'Falta a quien enviarlo' }, 400)
  if (para.length > 10) return json({ error: 'Maximo 10 destinatarios por envio' }, 400)
  if (!asunto) return json({ error: 'Falta el asunto' }, 400)
  if (!texto.trim()) return json({ error: 'Falta el mensaje' }, 400)

  // Remitente y clave: la casilla sale de la configuracion de la empresa y la
  // clave de Vault. Si falta cualquiera, no se inventa un remitente.
  const { data: empresa } = await db.from('settings')
    .select('value').eq('key', 'empresa').maybeSingle()
  const remitente = String((empresa?.value as Record<string, string>)?.correo_saliente ?? '').trim()
  const { data: clave } = await db.rpc('correo_clave_get')

  if (!remitente || !clave) {
    return json({
      error: 'El correo saliente no esta configurado. Soporte tiene que cargar la casilla '
           + 'de la empresa y su contrasena de aplicacion.',
    }, 503)
  }

  const nombre = String((empresa?.value as Record<string, string>)?.nombre ?? 'Pescaderia Bilagay')

  const smtp = new SMTPClient({
    connection: {
      hostname: 'smtp.gmail.com',
      port: 465,
      tls: true,
      auth: { username: remitente, password: String(clave) },
    },
  })

  try {
    await smtp.send({
      from: `${nombre} <${remitente}>`,
      to: para,
      // Las respuestas van a la casilla de la empresa, no a quien apreto el boton.
      replyTo: remitente,
      subject: asunto,
      content: texto,
    })
    await smtp.close()
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('correos_enviados').insert({
      customer_id: cuerpo.customer_id ?? null,
      asunto, destinatarios: para, cuerpo: texto,
      tipo: String(cuerpo.tipo ?? 'reporte_cobro'),
      enviado_por: perfil.id, error: msg,
    })
    return json({ ok: false, error: `No se pudo enviar: ${msg}` }, 502)
  }

  await db.from('correos_enviados').insert({
    customer_id: cuerpo.customer_id ?? null,
    asunto, destinatarios: para, cuerpo: texto,
    tipo: String(cuerpo.tipo ?? 'reporte_cobro'),
    enviado_por: perfil.id,
  })

  return json({ ok: true, enviados: para.length, desde: remitente })
})
