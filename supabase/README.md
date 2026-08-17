# Migraciones

El esquema se aplicó al proyecto Supabase `owfvuusxfvzjgxfmllpt` mediante el conector MCP de
Supabase. El historial vive en la tabla `supabase_migrations.schema_migrations` del proyecto:

| Migración | Contenido |
|---|---|
| `01_core` | Enums, `profiles`, `role_permissions`, `settings`, `audit_logs`, `notifications`, funciones de seguridad (`auth_role`, `is_admin`, `has_perm`), triggers de auditoría y alta de usuario, RLS y matriz de permisos por defecto. |
| `02_catalog_purchasing_inventory` | Correlativos, especies, categorías, productos, listas de precios, proveedores, compras, lotes, movimientos, mermas, vista `v_product_stock`, RLS. |
| `03_customers_orders_delivery_payments` | Clientes y direcciones, pedidos e ítems, historial de estados, rutas, entregas, pagos, tareas, vistas `v_customer_balance` y `v_order_profit`, RLS. |
| `04_business_logic` | `stock_reservations` y toda la lógica: recálculo de totales, alertas de stock bajo, `receive_purchase`, reserva FIFO, transiciones de pedido, `complete_delivery`, aplicación de pagos, mermas, ajustes, KPIs del dashboard. |
| `05_harden_function_grants` | Revoca `execute` a `anon` en todas las funciones y quita acceso anónimo a las tablas. |
| `06_seed_catalog`, `09_seed_orders` | Datos de demostración. |
| `08_fix_payment_status_cast` | Corrección de casteo de enum en el trigger de pagos. |

El archivo `migrations/20260817120000_01_core.sql` está incluido como referencia legible.

## Sincronizar los archivos locales con la base

Para dejar el historial completo en el repositorio (recomendado antes de la Fase 2):

```bash
npm install -g supabase
supabase login
supabase link --project-ref owfvuusxfvzjgxfmllpt
supabase db pull
```

Eso descarga a `supabase/migrations/` el esquema exacto que hoy está en producción.
Desde ahí, el flujo normal pasa a ser `supabase migration new <nombre>` + `supabase db push`.

## Reglas al modificar el esquema

1. Toda tabla nueva nace con `alter table … enable row level security` y sus políticas.
2. Toda función nace con `set search_path = public` y sin `execute` para `anon`.
3. La lógica que toca stock o dinero va en funciones `security definer`, nunca en el cliente.
4. Nada de `delete` sobre datos históricos: se usan estados (`activo`, `cancelado`, `anulado`, `archivado`).
