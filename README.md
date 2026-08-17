# JLIZ BUSINESS

Sistema de gestión integral (ERP/POS) para una distribuidora de pescado fresco:
compra → recepción → inventario → venta → preparación → despacho → entrega → pago → rentabilidad.

**Estado: Fase 1 completa** — base de datos, seguridad, autenticación, roles, las dos interfaces
y dashboard con datos reales. El detalle está en [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md).

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

## Base de datos

Proyecto Supabase: **JLIZBUSINESS** (`owfvuusxfvzjgxfmllpt`, región us-east-1).

- 30 tablas, 3 vistas, RLS en todas las tablas.
- Funciones de negocio: `receive_purchase`, `confirm_order`, `start_preparation`,
  `finish_preparation`, `dispatch_order`, `complete_delivery`, `register_loss`,
  `adjust_lot_quantity`, `dashboard_kpis`, `sales_series`.
- Datos de demostración cargados (13 productos, 6 clientes, 3 proveedores, 6 compras,
  26 pedidos en distintos estados, mermas y pagos).

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
