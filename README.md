# PESCADERÍA BILAGAY SpA

Sistema de gestión integral (ERP/POS) para una distribuidora de pescado fresco:
compra → recepción → inventario → venta → preparación → despacho → entrega → pago → rentabilidad.

**Estado: fases 1 a 5 completas + portal de trabajadores + control de cuentas + cobranza** — base de datos, seguridad, autenticación, roles, las dos interfaces,
dashboard, productos, inventario, lotes, procesamiento, compras, proveedores, clientes, pedidos,
ventas, entregas, finanzas, reportes exportables, auditoría, cuentas y accesos, configuración, y el
portal móvil del personal (pedidos, hoja de ruta, stock y reportes) sin acceso a información
financiera, y el módulo de **cobranza** con portal de pagos para el cliente. El modelo está ajustado a las 107 respuestas del levantamiento. El detalle está en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

## Stack

React 19 · TypeScript · Vite · Tailwind CSS v4 · TanStack Query · Recharts · PWA
· Supabase (PostgreSQL, Auth, Storage, Realtime) · GitHub Pages

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completa la clave publicable de Supabase
npm run dev
```

La app queda en `http://localhost:5173/JLIZBUSINESS/`.

### Primer ingreso

1. Abre la app y entra a **Crear cuenta**.
2. **El primer usuario que se registra queda como administrador** (lo decide el trigger
   `handle_new_user` en la base de datos).
3. Los siguientes usuarios entran con rol `ventas` y el administrador les cambia el rol.

Mientras la pantalla de Trabajadores no esté implementada (Fase 2), el rol se cambia con SQL:

```sql
update public.profiles set role = 'reparto' where email = 'persona@empresa.cl';
```

Roles disponibles: `admin`, `ventas`, `compras`, `inventario`, `empaque`, `reparto`.

## Cobranza y portal de pagos

El problema que resuelve: los clientes no pagan las facturas en orden. Uno transfiere un monto
que cubre tres facturas, otro abona sin decir a cuál corresponde, otro paga la última y deja la
primera colgando. Sin una capa de imputación no hay forma de saber qué se pagó.

- **`payment_allocations`** — un pago se reparte entre N documentos. Es la pieza que faltaba:
  antes un pago solo podía apuntar a una factura (`payments.order_id`), así que un abono que
  cubría varias no tenía dónde registrarse.
- **Imputación automática o manual.** Por defecto el pago se aplica a las facturas con
  vencimiento más antiguo. Se puede repartir a mano y reimputar después sin perder el rastro.
- **Pago a cuenta.** Si llega plata sin destino claro, queda como saldo a favor del cliente y
  aparece en *Cobranza → Pagos* hasta que se sepa a qué factura va.
- **Cartola por cliente** con antigüedad por tramos (por vencer, 1-15, 16-30, 31-60, +60 días).
- **Portal del cliente** en `#/portal/:token` — el cliente ve sus facturas impagas, los
  vencimientos y su deuda total, y puede informar una transferencia. El enlace se genera desde
  la cartola y se envía por WhatsApp; no necesita cuenta ni contraseña, y se puede revocar.
  Solo expone datos de ese cliente: nunca costos ni márgenes.

### Importar las ventas del mes

Las facturas se emiten en el sistema de facturación electrónica, no en la plataforma. El
detalle de ventas se carga en `sales_import_rows` y se transforma con:

```sql
select public.process_sales_import('<batch_id>'::uuid, 30);  -- 30 = días de plazo
```

Crea los clientes y productos que falten (reconocidos por RUT y SKU), los documentos y sus
líneas. Es idempotente: volver a cargar el mismo período no duplica nada. Las notas de crédito
entran con total negativo y se descuentan del saldo del cliente.

## Base de datos

Proyecto Supabase: **JLIZBUSINESS** (`owfvuusxfvzjgxfmllpt`, región us-east-1).

- Tablas de cobranza: `invoices`, `invoice_items`, `payment_allocations`, `payment_reports`,
  `customer_portal_tokens`, `sales_import_batches`, `sales_import_rows`. RLS en todas.
- Funciones de negocio: `receive_purchase`, `confirm_order`, `start_preparation`,
  `finish_preparation`, `dispatch_order`, `complete_delivery`, `register_loss`,
  `adjust_lot_quantity`, `dashboard_kpis`, `sales_series`.
- Funciones de cobranza: `register_customer_payment`, `allocate_payment`, `auto_allocate_payment`,
  `customer_statement`, `process_sales_import`, `portal_get`, `portal_report_payment`.
- Datos reales cargados: 38 clientes, 41 productos y 745 documentos de venta del período
  1-jun a 26-ago 2026 ($136.815.280 brutos), importados desde el detalle de ventas.

Ver [`supabase/README.md`](supabase/README.md) para trabajar con las migraciones.

### Quitar los datos de demostración

Antes de operar con datos reales, vaciar en este orden:

```sql
truncate public.payments, public.deliveries, public.order_status_history,
         public.stock_reservations, public.order_items, public.orders,
         public.losses, public.inventory_movements, public.inventory_lots,
         public.purchase_items, public.purchases cascade;
-- y luego, si corresponde, clientes/proveedores/productos de prueba
```

## Levantamiento de información del cliente

Antes de la Fase 2 hay que reemplazar los supuestos por datos reales. Para eso hay dos formatos
con el mismo contenido (107 preguntas en 7 secciones):

- **Planilla Excel** — [`docs/Levantamiento_Cliente_JLIZ.xlsx`](docs/Levantamiento_Cliente_JLIZ.xlsx),
  con tres hojas extra para cargar productos, clientes y proveedores reales.
- **Formulario web** — el administrador crea un enlace en *Levantamiento*, se lo envía al cliente
  y este responde desde su teléfono sin cuenta ni contraseña. Cada respuesta se guarda sola.

El formulario web se genera desde la planilla, así que ambos no se desalinean:

```bash
python3 scripts/survey_from_xlsx.py
```

El acceso anónimo está acotado a tres funciones (`survey_get`, `survey_save`, `survey_submit`)
validadas por token; el resto del esquema sigue cerrado para usuarios sin sesión.

## Despliegue

Cada push a `main` publica en GitHub Pages mediante `.github/workflows/deploy.yml`.
Requiere activar Pages con origen **GitHub Actions** en *Settings → Pages*.

URL de producción: `https://pew1sark.github.io/JLIZBUSINESS/`

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compila TypeScript y genera `dist/` |
| `npm run preview` | Sirve el build local |
| `npm run lint` | ESLint |
