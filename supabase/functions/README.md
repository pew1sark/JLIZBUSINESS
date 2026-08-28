# Edge Functions

Se despliegan con el conector MCP de Supabase (no hay CLI local). El código
vive en el proyecto Supabase; acá queda la referencia de qué hace cada una.

| Función | JWT | Qué hace |
|---|---|---|
| `bsale-connect` | sí (admin) | Recibe el access token, **lo prueba contra `GET /v1/users.json?limit=1`** y solo si Bsale responde bien lo guarda cifrado en Vault y crea la conexión. El token nunca vuelve al navegador. |
| `bsale-sync` | sí (admin) | Trae el libro de compras (`third_party_documents`, por año/mes), las recepciones (`stocks/receptions`) y sus detalles con costo. Va a ~8 req/s, reintenta con espera creciente ante 429/5xx, corta por número de páginas y guarda un cursor para retomar. |
| `bsale-cron` | **no** | La que dispara `pg_cron` cada 30 min. Corre la cadena completa sobre el mes en curso y el anterior: **compras** (libro de compras → XML del DTE → `purchases` → costos) y **ventas** (`/documents.json` → `bsale_sales_documents` → `invoices`). Exige `x-cron-secret` contra el secreto de Vault; sin ese encabezado no hace nada. Acepta `{"solo":"ventas"}` y `{"desde":"YYYY-MM-DD","hasta":"..."}` para forzar una ventana concreta. |
| `bsale-notas-credito` | **no** | Lee el XML del DTE de cada nota de crédito para sacar a qué factura apunta: la API devuelve `references: {count: 0}` en todas, así que por ahí no viene. Del bloque `<Referencia>` toma `FolioRef` (la factura), `CodRef` (1 anula, 2 corrige texto, 3 corrige montos) y `RazonRef`. Después llama a `aplicar_notas_credito()`. La dispara `pg_cron` a los 15 y 45, desfasada de la sincronización. Acepta `{"rehacer": true}` para releer los XML ya procesados. |
| `enviar-correo` | sí (admin) | Manda un correo desde la casilla de la empresa. El reporte de cobro tiene que salir siempre desde el mismo remitente, no desde la cuenta de quien aprieta el botón, y eso obliga a que el envío pase por el servidor: el navegador no puede autenticarse como la casilla sin tener su clave. La clave es una **contraseña de aplicación de Gmail** guardada en Vault (`correo_app_password`), la carga solo `soporte` y nunca vuelve al cliente. Va por SMTP a smtp.gmail.com:465. Máximo 10 destinatarios. Todo lo enviado —y lo que falló, con su error— queda en `correos_enviados`. |
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


## Qué se sincroniza solo

| | Origen en Bsale | Destino | Cada cuánto |
|---|---|---|---|
| Compras | `third_party_documents` (libro de compras del SII) + XML del DTE | `suppliers`, `purchases`, `purchase_items` | 30 min |
| Ventas | `documents.json` (documentos emitidos) | `customers`, `invoices`, `invoice_items` | 30 min |
| Notas de crédito | XML del DTE (`<Referencia>`) | `invoices.related_doc_number` + imputación | 30 min (a los 15 y 45) |

Ambas corren sobre el mes en curso y el anterior. El histórico anterior a esa
ventana se carga una vez a mano y no se vuelve a tocar.

### Qué documentos de venta entran y cuáles no

`/documents.json` devuelve **todo** lo que sale del sistema. Solo se vuelcan los
que son tributarios, por su `codeSii`:

| Entra | No entra |
|---|---|
| 33 factura afecta | (vacío) nota de venta y cotización |
| 34 factura exenta | 52 guía de despacho |
| 39 / 41 boleta | anulados (`state = 1` o `cancellationStatus ≠ 0`) |
| 56 nota de débito | documentos sin RUT de cliente |
| 61 nota de crédito (entra en negativo) | |

### Reglas que hay que respetar al tocar esto

- **El volcado nunca pisa `amount_paid` ni `payment_status`.** Los mantiene
  `recalc_receivable` desde las imputaciones; sobrescribirlos borraría la
  cobranza registrada a mano. Por eso el insert es `on conflict do nothing`.
- **Es idempotente por `doc_type` + `doc_number`.** Se puede correr las veces
  que sea sin duplicar.
- **El nombre del producto sale del SKU.** La API entrega la variante con su
  código de barra pero sin el nombre, así que se resuelve contra
  `products.sku`. Si un SKU no está en el catálogo, la línea queda con la
  descripción de la variante.
- **`expand=[details]` trae como máximo 25 líneas por documento.** Cuando hay
  más, la función las pide por separado.
