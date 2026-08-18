# JLIZ BUSINESS — Arquitectura del sistema

Sistema de gestión (ERP/POS) para distribuidora de pescado fresco.
Documento base: decisiones, modelo de datos, permisos, flujos y plan por fases.

Última actualización: 18 de agosto de 2026 · Fases 1 y 2 implementadas, modelo ajustado al levantamiento.

---

## 1. Arquitectura general

```
┌─────────────────────────────────────────────────────────────┐
│  CLIENTE (PWA · React + TypeScript + Tailwind)              │
│                                                             │
│  Interfaz A · ADMIN            Interfaz B · TERRENO         │
│  sidebar, tablas, gráficos     móvil, botones grandes       │
│           │                              │                  │
│           └──────────┬───────────────────┘                  │
│                  supabase-js                                │
└──────────────────────┼──────────────────────────────────────┘
                       │ HTTPS (JWT del usuario)
┌──────────────────────┼──────────────────────────────────────┐
│  SUPABASE                                                   │
│  ├── Auth            sesiones, roles, recuperación          │
│  ├── PostgREST       CRUD sobre tablas y vistas             │
│  ├── Realtime        notificaciones y pedidos en vivo       │
│  ├── Storage         fotos de lotes, firmas, documentos     │
│  └── PostgreSQL                                             │
│       ├── 30 tablas + vistas de negocio                     │
│       ├── RLS en TODAS las tablas                           │
│       ├── Funciones SECURITY DEFINER (lógica de negocio)    │
│       └── Triggers (totales, auditoría, historial, alertas) │
└─────────────────────────────────────────────────────────────┘
```

**Principio rector: la lógica crítica vive en la base de datos, no en el navegador.**
Reservar stock, recibir una compra, cerrar una preparación o confirmar una entrega son
funciones de Postgres. El frontend solo las invoca. Así, aunque alguien manipule el cliente
o llame directo a la API, no puede dejar el inventario inconsistente ni saltarse permisos.

### Decisiones tecnológicas

| Decisión | Elección | Por qué |
|---|---|---|
| Frontend | React 19 + TypeScript + Vite | Rápido, tipado, ecosistema maduro. |
| Estilos | Tailwind CSS v4 | Consistencia visual sin arrastrar un framework UI pesado. |
| Datos en cliente | TanStack Query | Caché, revalidación e invalidación tras cada mutación. |
| Routing | React Router (HashRouter) | Compatible con GitHub Pages sin configuración de servidor. |
| Backend | Supabase (Postgres + Auth + Storage + Realtime) | Un solo proveedor para BD, sesiones, archivos y tiempo real; RLS nativo. |
| Gráficos | Recharts | Declarativo y liviano. |
| Hosting | GitHub Pages + GitHub Actions | Gratis, deploy automático desde `main`, sin servidor que mantener. |
| PWA | vite-plugin-pwa (Workbox) | Instalable en el teléfono del repartidor y del bodeguero. |
| Moneda / formato | CLP, `es-CL`, zona `America/Santiago` | Negocio chileno. |

**Por qué no Next.js:** hoy no hay nada que exija servidor. Cuando llegue la facturación
electrónica (SII) o integraciones con secretos, se agregan como *Edge Functions* de Supabase
sin tocar el frontend.

---

## 2. Estructura de carpetas

```
JLIZBUSINESS/
├── src/
│   ├── components/
│   │   ├── layout/        AdminLayout · WorkerLayout
│   │   ├── ui.tsx         tarjetas, badges, modal, tabla, estados vacíos
│   │   ├── GlobalSearch.tsx
│   │   ├── NotificationBell.tsx
│   │   └── ProtectedRoute.tsx
│   ├── context/AuthContext.tsx      sesión, perfil, permisos
│   ├── lib/
│   │   ├── supabase.ts    cliente
│   │   ├── types.ts       tipos del dominio
│   │   ├── permissions.ts espejo de role_permissions (solo UI)
│   │   ├── constants.ts   etiquetas y estilos por estado
│   │   └── format.ts      CLP, kilos, fechas, %
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── admin/         Dashboard + módulos
│   │   └── worker/        Mi jornada + tareas de terreno
│   ├── App.tsx            rutas y guardas por rol
│   └── index.css          design tokens
├── supabase/migrations/   esquema versionado
├── docs/                  este documento
└── .github/workflows/     deploy a GitHub Pages
```

---

## 3. Modelo de base de datos

30 tablas en `public`. Todas con RLS activo.

### Núcleo y seguridad
| Tabla | Contenido |
|---|---|
| `profiles` | Usuario del sistema (1:1 con `auth.users`), rol y estado. |
| `role_permissions` | Matriz rol × recurso × acción. |
| `settings` | Datos de la empresa y parámetros (IVA, días de crédito, stock negativo). |
| `audit_logs` | Bitácora inmutable: quién, qué tabla, qué registro, antes/después. |
| `notifications` | Avisos por usuario o por rol. |
| `counters` | Correlativos anuales (`PED-2026-000145`). |

### Catálogo
`fish_species` · `product_categories` · `products` · `price_lists` · `price_list_items`

### Abastecimiento
`suppliers` · `supplier_products` (precio histórico por proveedor) · `purchases` · `purchase_items`

### Inventario
`inventory_lots` (el corazón de la trazabilidad) · `inventory_movements` (libro mayor de stock) ·
`stock_reservations` (reserva por lote y línea de pedido) · `losses` (mermas)

### Comercial
`customers` · `customer_addresses` · `orders` · `order_items` · `order_status_history`

### Logística y dinero
`routes` · `deliveries` · `payments` · `tasks`

### Vistas
- `v_product_stock` — físico / reservado / disponible / valorizado por producto.
- `v_customer_balance` — facturado, pagado, pendiente y vencido por cliente.
- `v_order_profit` — margen y % por pedido.

### Manejo de peso
Toda cantidad se guarda en la **unidad base del producto** (`kg` o `unidad`) con 3 decimales.
`quantity_available` es una columna **generada** (`on_hand - reserved`): es imposible que se
desincronice. Formatos como caja o bandeja se modelan como presentación con factor de conversión.

```
Salmón   físico 120 kg · reservado 35 kg → disponible 85 kg
Pedido de 12,5 kg  → reserva sobre lotes por FIFO
                   → disponible 72,5 kg (automático)
```

---

## 4. Relaciones y trazabilidad

```
suppliers → purchases → purchase_items
                              ↓  receive_purchase()
                        inventory_lots ────────────┐
                              ↓                    │
   customers → orders → order_items                │
                    ↓  confirm_order()             │
             stock_reservations ───────────────────┤ (por lote)
                    ↓  finish_preparation()        │
             inventory_movements ──────────────────┘
                    ↓  dispatch_order()
                deliveries → routes
                    ↓  complete_delivery()
                 payments → cuentas por cobrar
                    ↓
             v_order_profit (rentabilidad real)
```

Cualquier kilo entregado se puede rastrear hasta su lote, su compra, su proveedor, su fecha de
recepción y el trabajador que lo recibió. Y al revés: desde un lote se ve a qué clientes se vendió.

---

## 5. Roles y permisos

Seis roles: `admin`, `ventas`, `compras`, `inventario`, `empaque`, `reparto`.

Tres capas, en este orden de autoridad:

1. **RLS en cada tabla** — políticas que llaman a `has_perm(recurso, acción)`.
2. **Funciones de negocio** — validan permiso y reglas antes de escribir.
3. **Interfaz** — oculta lo que no corresponde (comodidad, nunca seguridad).

| Recurso | admin | ventas | compras | inventario | empaque | reparto |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Productos | CRUD | leer | leer/crear | leer | leer | — |
| Inventario y lotes | CRUD | leer | leer | leer/editar | leer | — |
| Compras | CRUD | — | crear/editar | leer | — | — |
| Proveedores | CRUD | — | crear/editar | — | — | — |
| Clientes | CRUD | crear/editar | — | — | — | leer |
| Pedidos | CRUD | crear/editar | — | editar | editar | leer |
| Entregas | CRUD | leer | — | — | — | **solo las suyas** |
| Pagos | CRUD | registrar | — | — | — | cobrar en terreno |
| Mermas | CRUD | — | — | registrar | registrar | — |
| Auditoría | leer | — | — | — | — | — |
| Usuarios y configuración | CRUD | — | — | — | — | — |

Un repartidor solo ve las entregas donde `driver_id = auth.uid()`: está escrito en la política de
la tabla, no en el frontend.

---

## 6. Flujo completo del negocio

```
1 COMPRA        compras registra proveedor, especie, kilos, precio/kg, flete, origen
2 RECEPCIÓN     receive_purchase() → crea LOTE, prorratea flete → costo real por kilo
3 INVENTARIO    stock disponible por producto y lote, con vencimiento y ubicación
4 PEDIDO        ventas crea el pedido con la lista de precios del cliente
5 CONFIRMACIÓN  confirm_order() → reserva stock por FIFO (vencimiento más próximo primero)
6 PREPARACIÓN   empaque registra el PESO REAL → finish_preparation() descuenta los lotes,
                libera el sobrante, recalcula costo y total del pedido
7 DESPACHO      dispatch_order() asigna repartidor y crea la entrega
8 ENTREGA       complete_delivery() guarda hora, receptor, ubicación, foto/firma y cobro
9 PAGO          payments actualiza el estado de pago y las cuentas por cobrar
10 RENTABILIDAD v_order_profit: venta − costo de los lotes consumidos − transporte
```

Reglas duras del sistema:
- No hay stock negativo (restricciones `check` en los lotes).
- No se borran movimientos históricos: se anulan o cancelan con estado.
- Un pedido entregado no se cancela.
- Toda modificación relevante queda en `audit_logs` automáticamente.

---

## 7. Las dos interfaces

**A · Administración (escritorio, también usable en tablet/móvil).**
Sidebar de 14 secciones, buscador global (pedido, cliente, producto, lote, proveedor),
notificaciones en vivo, dashboard con KPIs y gráficos. Densidad alta, tablas con filtros.

**B · Terreno (móvil primero).**
Cabecera con nombre y rol, máximo cinco destinos en la barra inferior, botones grandes y
pantalla principal "Mi jornada" con lo que hay que hacer hoy. Cada tarea se resuelve en
3–4 toques. Los repartidores no ven precios de compra ni márgenes.

El enrutamiento decide la interfaz según el rol: `admin` entra a `/`, el resto a `/t`.

---

## 8. Plan por fases

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Arquitectura, base de datos completa, RLS, auth, roles, dashboard, datos demo | ✅ **Hecha** |
| 2 | Productos, inventario, lotes, compras, proveedores, procesamiento (UI) | ✅ **Hecha** |
| 3 | Clientes, ventas, pedidos + tablero Kanban | ⬜ |
| 4 | Preparación, tareas de trabajadores, entregas y rutas | ⬜ |
| 5 | Pagos, cuentas por cobrar, rentabilidad, reportes exportables | ⬜ |
| 6 | Auditoría en UI, notificaciones avanzadas, configuración | ⬜ |
| 7 | PWA offline, optimización de bundle, rendimiento móvil | ⬜ parcial (PWA ya instalable) |

La base de datos de las fases 2 a 6 **ya está construida y probada**: lo que falta en cada una
es la interfaz. Por eso los módulos aparecen marcados en la app con su fase.

---

## 9. Escalabilidad futura

La arquitectura deja lugar, sin rehacer nada, para: facturación electrónica e integración con el
SII (Edge Functions), WhatsApp, Mercado Pago / Transbank, impresoras térmicas, códigos QR y de
barras, Google Maps con optimización de rutas, sensores de temperatura (IoT) y pronóstico de
demanda con IA sobre el historial de `inventory_movements` y `orders`.

---

## 10. Riesgos detectados

| Riesgo | Impacto | Mitigación aplicada |
|---|---|---|
| **Peso solicitado ≠ peso real** (es la norma en pescado) | Cobros y stock mal calculados | El pedido guarda `quantity_ordered` y `quantity_prepared`; el total se calcula sobre el peso real y el sobrante reservado se libera solo. |
| **Costo real por kilo** distinto al precio de lista del proveedor | Margen ficticio | `receive_purchase()` prorratea flete y otros costos entre los ítems según su participación. |
| **Producto altamente perecible** | Pérdidas por vencimiento | Reserva FIFO por fecha de vencimiento + alerta de stock bajo + módulo de mermas que impacta la rentabilidad. |
| **Concurrencia** (dos personas venden el mismo lote) | Sobreventa | `SELECT … FOR UPDATE` en las funciones de reserva y preparación. |
| **Conectividad en terreno** | Trabajo detenido | PWA instalable; caché de assets. *Pendiente: cola de escritura offline (Fase 7).* |
| **Errores humanos en inventario** | Descuadres | Ajustes solo por función que exige motivo y deja movimiento + auditoría. |
| **Un solo administrador** | Punto único de falla | Roles reales desde el día uno; conviene crear un segundo admin. |
| **Bundle inicial ~925 KB** | Primera carga lenta en 3G | *Pendiente: code-splitting por ruta (Fase 7).* |
| **Datos de demostración en la base** | Confusión con datos reales | Documentado; se eliminan con un script antes de operar en producción. |
| **Backups en plan gratuito de Supabase** | Pérdida de datos | Evaluar plan Pro (backups diarios) antes de la puesta en marcha real. |

---

## 11. Ajustes tras el levantamiento con el cliente

El 18 de agosto de 2026 el cliente (**Pescadería Bilagay SpA**, La Florida) respondió las 107
preguntas. Ocho respuestas obligaron a cambiar el modelo; el resto confirmó lo construido.

### Lo que cambió

| Respuesta | Qué obligó a cambiar |
|---|---|
| **B4/B5** — compra entero y filetea en el terminal | Módulo nuevo de **procesamiento**: `processing_orders`, `processing_outputs`, `processing_yields` y la función `process_lot()`. Un lote entra, salen lotes nuevos con el costo del origen traspasado completo, y el rendimiento queda medido por par producto-origen → producto-salida. |
| **A11** — compra y almacena en el terminal, más una cámara de 300 kg | Tabla `locations` (terminal, cámara, 3 vehículos) y `inventory_lots.location_id`. |
| **B8/B9/B11** — el precio cambia por oferta y demanda, y se negocia caso a caso | Se abandonan las listas fijas por segmento: ahora hay **precio vigente por producto** con bitácora automática (`product_price_history`), **precio especial por cliente** (`customer_special_prices`) y la función `price_for()`. |
| **E6** — se agrega hielo y se descuenta del peso | `order_items.gross_weight` y `ice_weight`; el peso facturable es el neto. |
| **E2/A18** — se pesa con la balanza del local del cliente | `update_delivery_weights()`: el repartidor ajusta el peso en la entrega y el pedido se recalcula. |
| **D9/G7** — nunca se vende lo que no hay | `confirm_order()` ahora **rechaza** el pedido si falta stock, en vez de reservar de forma parcial. |
| **D11** — tolerancia de 5% | `finish_preparation()` avisa cuando la diferencia entre lo pedido y lo preparado la supera. |
| **F6/F13** — hay un gerente de pagos y cobranza | Rol nuevo **`finanzas`** con permisos propios. |
| **F8/F9** — factura con Bsale y quiere que el sistema la emita | Campos `invoice_number`, `invoice_status`, `invoice_url` en `orders`, preparados para la integración con Bsale (Fase 5). |

### Parámetros reales cargados en `settings`

IVA 19% sobre precios netos · crédito 30 días · vencido a los 35 · límite de crédito $10.000.000 ·
corte de pedidos 01:30 · recepción 01:00–07:00 · reparto 09:00–14:00 · tolerancia de peso 5% ·
descuento por volumen desde 40 kg · markup objetivo 50% · vida útil 3 días · merma en cámara 2%/día ·
merma esperada 1,5% de la compra · costos fijos $9.000.000/mes · sin venta sin stock · sin cobro de
despacho · el hielo se descuenta del peso.

### Una decisión contable importante

El desecho del fileteo **no se cuenta como pérdida económica**. Su costo ya está absorbido en el
precio por kilo del producto procesado: si además se registrara como merma valorizada, el margen se
castigaría dos veces por lo mismo. Se conserva el registro en kilos —sirve para medir rendimiento—
con costo cero. Las mermas reales (producto que se bota, según la respuesta G4) sí se valorizan.

### Lo que sigue pendiente de datos

El cliente aún no entregó el catálogo real de productos, clientes y proveedores (las tres hojas de
datos de la planilla). Hasta que lleguen, el sistema opera con los datos de demostración.
