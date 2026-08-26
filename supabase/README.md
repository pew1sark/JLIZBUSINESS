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
| `ar_documentos_y_pagos` | **Cuentas por cobrar.** `invoices` / `invoice_items` (documentos tributarios), `payment_allocations` (un pago repartido entre varias facturas), `customer_portal_tokens`, `payment_reports`, RLS y permisos del recurso `invoices`. |
| `ar_vistas` | `v_cuentas_por_cobrar` reescrita para incluir facturas, `v_notas_credito_pendientes`, `v_pagos_sin_imputar` y `v_estado_cuenta_cliente` (antigüedad por tramos). |
| `ar_funciones_imputacion` | `recalc_receivable`, `allocate_payment`, `auto_allocate_payment` (imputación por vencimiento más antiguo), `register_customer_payment`, `void_payment`. `trg_apply_payment` queda solo con el lado de proveedores. |
| `ar_cartola_y_portal` | `customer_statement`, `mark_overdue_orders` extendida a facturas, `finance_kpis` con documentos importados, ajuste `cobranza` en `settings`. |
| `portal_pagos_cliente` | `portal_link`, `portal_revoke`, `portal_get` y `portal_report_payment` (las dos últimas con `execute` para `anon`), `confirm_payment_report`, `reject_payment_report`. |
| `importacion_ventas` + `importacion_ventas_robusta` + `staging_fecha_texto` | `sales_import_batches` / `sales_import_rows` y `process_sales_import`: carga repetible del detalle de ventas del sistema de facturación electrónica. |
| `dashboard_incluye_facturas` + `finance_kpis_margen_honesto` | `dashboard_kpis` y `finance_kpis` pasan a sumar los documentos importados además de los pedidos, sin doble conteo. La venta es siempre neta. El margen se calcula solo sobre la venta con costo cargado y se expone `cobertura_costo_pct`: sin eso, las facturas importadas (que no traen costo) daban 100% de margen. |
| `reiniciar_cobranza` | `reset_collections(_confirm, _customer_id, _dry_run)`: borra los cobros y sus imputaciones para deshacer una prueba. Solo admin, exige escribir `REINICIAR COBRANZA`, simula por defecto y queda en `audit_logs`. No toca facturas, clientes ni productos. |
| `saldo_cliente_y_serie_con_facturas` + `dashboard_riesgo_y_cobertura` | `v_customer_balance` (que alimenta el mapa del dashboard y la pantalla de Clientes) y `sales_series` pasan a incluir los documentos importados; sin esto los 39 clientes salían con saldo cero y el gráfico plano. `dashboard_kpis` suma `vencido_grave` (+30 días), `documentos_mes`, `documentos_por_cobrar`, `clientes_con_deuda` y `cobertura_costo_pct`. |

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
5. Cuánto está pagado un documento **no se escribe a mano**: sale siempre de la suma de sus
   `payment_allocations`, vía `recalc_receivable`. Es lo que permite reimputar un pago sin
   que queden saldos fantasma.
