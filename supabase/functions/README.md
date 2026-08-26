# Edge Functions

Se despliegan con el conector MCP de Supabase (no hay CLI local). El código
vive en el proyecto Supabase; acá queda la referencia de qué hace cada una.

| Función | JWT | Qué hace |
|---|---|---|
| `bsale-connect` | sí (admin) | Recibe el access token, **lo prueba contra `GET /v1/users.json?limit=1`** y solo si Bsale responde bien lo guarda cifrado en Vault y crea la conexión. El token nunca vuelve al navegador. |
| `bsale-sync` | sí (admin) | Trae el libro de compras (`third_party_documents`, por año/mes), las recepciones (`stocks/receptions`) y sus detalles con costo. Va a ~8 req/s, reintenta con espera creciente ante 429/5xx, corta por número de páginas y guarda un cursor para retomar. |
| `bsale-cron` | **no** | La que dispara `pg_cron`. Corre la cadena completa sobre el mes en curso y el anterior. Exige `x-cron-secret` contra el secreto de Vault; sin ese encabezado no hace nada. |
| `bsale-webhook` | **no** | Recibe los avisos de Bsale. Como la API no documenta firma, exige `?key=<BSALE_WEBHOOK_SECRET>` y trata el payload como no confiable: solo registra qué recurso releer. |

## Secretos que hay que configurar en Supabase

| Secreto | Para qué |
|---|---|
| `BSALE_WEBHOOK_SECRET` | Valor aleatorio que va en la URL registrada en Bsale. Sin él, el receptor responde 503 y no acepta nada. |
| `BSALE_CRON_SECRET` | Permite que un trabajo programado llame a `bsale-sync` sin sesión de usuario. |

Se cargan en *Project Settings → Edge Functions → Secrets*. No van al repositorio.

## Limitación conocida: la llamada desde un cron todavía no funciona

`bsale-sync` y `bsale-xml` traen en el código una ruta alternativa de
autorización por `x-cron-secret`, pensada para que un trabajo programado las
invoque sin sesión de usuario. **Esa ruta hoy no se alcanza**: ambas están
desplegadas con `verify_jwt: true`, así que Supabase rechaza la petición con
401 antes de ejecutar el código. Para habilitarla hay que volver a desplegarlas
con `verify_jwt: false` — la autorización propia que ya tienen (sesión de
administrador **o** secreto de cron) sigue cerrando la puerta a llamadas
anónimas.

Mientras tanto la sincronización se dispara desde la aplicación, que sí manda
la sesión: *Configuración → Conexión con Bsale*.
