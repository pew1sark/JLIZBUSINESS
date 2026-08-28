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
| `corregir_iva_y_costos_importados` | Quita el `default 0` de `impuestos`/`costo_unit`/`costo_total` en `sales_import_rows`: con 0 el respaldo `coalesce(impuestos, bruto - neto)` nunca se activaba y los documentos importados quedaban con IVA en cero. Recalcula el IVA de lo ya cargado. |
| `bsale_conexion_y_aterrizaje` + `bsale_token_en_vault` | Integración con la API oficial de Bsale: `bsale_connections` (token cifrado en Vault), `bsale_sync_runs`, `bsale_webhook_events` (bandeja idempotente) y las tablas de aterrizaje crudo `bsale_third_party_documents`, `bsale_receptions`, `bsale_reception_details`. Las funciones puente al Vault solo las ejecuta `service_role`. |
| `bsale_volcar_compras_al_erp` | `bsale_apply_purchases(_connection_id, _dry_run)`: pasa el libro de compras aterrizado a `suppliers` + `purchases`. Cruza proveedores por **RUT normalizado** (los nombres vienen con doble codificación desde Bsale) y enlaza 1 a 1 con `purchases.bsale_document_id`, lo que hace la carga repetible. Incluye `fix_mojibake()`. |
| `bsale_detalle_desde_xml` + `bsale_clasificar_lineas_de_compra` + `bsale_aplicar_costos` | Detalle de compra sacado del XML del DTE (`urlXml`), porque ni el libro de compras ni las recepciones lo entregan. Clasifica mercadería vs gasto, mapea al catálogo, crea `purchase_items` y calcula `avg_cost`/`last_cost`, con lo que las ventas quedan costeadas. |
| `contactos_cliente_y_gastos` | `customer_contacts` (quién pide vs quién paga, con principal único por función) + `v_contacto_cobranza`, y `v_gastos_operacionales` con categorización de gasto deducida de la descripción del DTE. |
| `cartola_de_pagos_de_venta` | `payment_statement_rows` + `aplicar_cartola_pagos()`: convierte la cartola de pagos en cobros imputados. Idempotente; nunca escribe `amount_paid` directo. |
| `corte_de_analisis` (+ `_kpis_y_costos`, `_en_kpis`) | `settings.analisis.desde` + `analisis_desde()`: fecha de corte que respetan todas las vistas y KPIs. Lo anterior queda guardado pero fuera de los números. Evita comparar compras de 2025 contra ventas que aún no se cargan. |
| `secreto_de_automatizacion` + `cron_bsale_cada_30_min` + `permitir_service_role_en_importacion` | `pg_cron` cada 30 min llama a la Edge Function `bsale-cron` vía `pg_net`, con el secreto guardado en Vault. `puede_importar()` reconoce a `service_role`, que no tiene `auth.uid()`. |

| `notas_credito` (varias, de `notas_credito_referencia_y_aplicacion` a `cron_aplica_notas_credito`) | **Notas de crédito que no estorban.** La API de Bsale devuelve `references` vacío en las notas, así que el vínculo con la factura se lee del `<Referencia>` del XML del DTE (`FolioRef` + `CodRef`). `aplicar_notas_credito()` descuenta hasta el saldo vivo y lo que sobra queda a favor del cliente. Se agrega el método de pago `nota_credito`: la nota salda la factura pero **no es plata que entró**, así que sale de `cobrado_mes`, de `v_meses_actividad.cobrado`, del `ultimo_pago` del cliente y de los promedios de días de pago —antes una factura anulada figuraba pagada en cero días y bajaba el promedio de todos. `v_facturas_con_pago` suma `nota_credito_aplicada`, `saldada_con_nota` y `notas_credito`. `pg_cron` a los 15 y 45 resuelve y aplica las nuevas. |

| `corregir_factura` | **Corregir una factura a mano.** El estado sale de las imputaciones, que es lo correcto casi siempre; cuando no lo es, antes la única salida era `void_payment`, que borra el pago entero y se lleva por delante las otras facturas que cubría. `corregir_imputacion()` toca solo el vínculo pago↔factura (bajarlo, subirlo o quitarlo) y lo liberado vuelve a quedar disponible. `corregir_estado_factura()` fuerza el estado como último recurso: exige motivo, queda en `audit_logs` y `recalc_receivable` lo respeta, así que la sincronización con Bsale ya no lo pisa. Pasar el estado en null devuelve la factura al cálculo automático. Se agrega `v_imputaciones_factura`. |

| `dos_locales_un_rut` | **Un mismo RUT con dos locales.** Comercial y Gastronómica Internacional factura La Mar (Nueva Costanera 4076) y Panchita (3979) con el mismo RUT, así que en el ERP quedaban como un solo cliente con una sola deuda. Lo que los separa es la dirección que Bsale escribe en cada documento (`raw->>'address'`), no la de la ficha —esa es siempre la de La Mar, y por eso `client_address` del staging no sirve—. Se agrega `customers.bsale_direccion` y `bsale_local_del_documento()`, y `bsale_apply_sales` pasa a resolver **un solo** cliente por documento: el join por RUT devolvía dos filas y la factura caía en cualquiera de los dos, así que la separación se deshacía sola en la siguiente sincronización. Los 66 documentos de enero a mayo se leyeron directo de la API con `pg_net` en vez de traerlos al staging, que habría creado facturas inexistentes. Los dos locales suman exactamente lo que tenía la ficha única. |

| `fechas_de_pago_corridas` | **La planilla de ventas 2026 traía la columna FECHA PAGO desalineada.** En 219 de 242 casos la fecha guardada era la de la factura de la fila anterior (los otros 23, de dos o tres filas antes): el patrón de una columna pegada con una fila de diferencia. Los montos siempre estuvieron bien; solo las fechas, y con ellas los días que tarda en pagar cada cliente, el informe de fechas de pago y la recaudación por mes. 83 facturas se movieron más de 15 días. Además 16 figuraban pagadas sin estarlo —el corrimiento les puso una fecha ajena y con ella un cobro por el total—; se quitaron 15, dejando la 35573 porque su cobro se registró a mano después de guardarse la planilla. No toca notas de crédito. Contra el documento corregido, 1.797 de 1.798 facturas coinciden. |

| `forzar_estado_mueve_la_plata` | **Arregla un defecto de `corregir_factura`.** Forzar el estado cambiaba `payment_status` y nada más, pero la deuda no sale del estado sino del saldo: marcar una factura como "pendiente" con su cobro todavía imputado la dejaba en saldo cero y no aparecía en cuentas por cobrar —la etiqueta decía una cosa y la plata otra—. Ahora forzar 'pendiente' o 'vencido' suelta las imputaciones (el cobro no se borra: queda sin imputar, para reasignarlo o darlo de baja) y forzar 'pagado' saca la factura de `v_cuentas_por_cobrar` aunque le quede saldo. Las notas de crédito nunca se sueltan. |

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
