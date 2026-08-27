-- ============================================================
-- JLIZ BUSINESS · HISTORIAL DE PAGOS
--
-- Hasta acá cobranza solo sabía mirar deuda viva: v_cuentas_por_cobrar
-- filtra saldo > 0, así que apenas una factura se paga desaparece de la
-- pantalla y con ella la fecha en que se pagó. Eso deja dos preguntas sin
-- respuesta: "¿qué día pagó esta factura?" y "¿cuánto se demora este
-- cliente en pagarme?".
--
-- Estas vistas guardan el otro lado: el documento pagado, cuándo se pagó
-- y cuántos días tardó desde que se emitió.
-- ============================================================

-- ---------- UNA FILA POR DOCUMENTO, PAGADO O NO ----------
drop view if exists public.v_facturas_con_pago;
create view public.v_facturas_con_pago as
  select
    i.id                        as invoice_id,
    i.code,
    i.doc_type::text            as doc_type,
    i.doc_number,
    i.customer_id,
    c.name                      as cliente,
    c.rut,
    c.payment_terms_days,
    i.issued_at,
    i.due_date,
    to_char(i.issued_at, 'YYYY-MM')  as mes_emision,
    i.net_amount,
    i.tax_amount,
    i.total,
    i.amount_paid,
    (i.total - i.amount_paid)   as saldo,
    i.payment_status::text      as payment_status,
    p.primer_pago,
    p.ultimo_pago,
    to_char(p.ultimo_pago, 'YYYY-MM') as mes_pago,
    coalesce(p.n_pagos, 0)      as n_pagos,
    p.metodos,
    p.referencias,

    -- Días que tardó en pagarse. Solo tiene sentido cuando el documento
    -- quedó saldado: en una factura a medio pagar el reloj sigue corriendo.
    case when i.payment_status = 'pagado' and p.ultimo_pago is not null
         then (p.ultimo_pago - i.issued_at) end            as dias_en_pagar,

    -- Contra el plazo pactado: negativo es pagar antes de tiempo.
    case when i.payment_status = 'pagado' and p.ultimo_pago is not null and i.due_date is not null
         then (p.ultimo_pago - i.due_date) end             as dias_vs_plazo,

    -- Para lo que sigue impago: cuántos días lleva esperando.
    case when i.payment_status <> 'pagado'
         then greatest(current_date - i.issued_at, 0) end  as dias_esperando,
    case when i.payment_status <> 'pagado' and i.due_date is not null
         then greatest(current_date - i.due_date, 0) end   as dias_atraso
  from public.invoices i
  join public.customers c on c.id = i.customer_id
  left join lateral (
    select min(pg.paid_at::date)                        as primer_pago,
           max(pg.paid_at::date)                        as ultimo_pago,
           count(*)                                     as n_pagos,
           string_agg(distinct pg.method::text, ', ')   as metodos,
           string_agg(distinct pg.reference, ', ')      as referencias
      from public.payment_allocations a
      join public.payments pg on pg.id = a.payment_id
     where a.invoice_id = i.id
  ) p on true;

alter view public.v_facturas_con_pago set (security_invoker = on);
comment on view public.v_facturas_con_pago is
  'Todas las facturas, pagadas y no pagadas, con la fecha en que se pagó cada una y cuántos días tardó.';

-- ---------- CADA IMPUTACIÓN, CON SU FECHA ----------
-- El informe detallado de fechas de pago: una fila por "este día entró
-- esta plata y cubrió esta factura".
drop view if exists public.v_pagos_detalle;
create view public.v_pagos_detalle as
  select
    pg.id                        as payment_id,
    pg.code                      as pago_code,
    pg.paid_at::date             as fecha_pago,
    to_char(pg.paid_at::date, 'YYYY-MM') as mes_pago,
    pg.method::text              as metodo,
    pg.reference,
    pg.notes,
    pg.amount                    as monto_pago,
    pg.customer_id,
    c.name                       as cliente,
    c.rut,
    a.amount                     as monto_imputado,
    case when a.invoice_id is not null then 'factura'
         when a.order_id   is not null then 'pedido'
         when a.opening_receivable_id is not null then 'saldo_inicial'
         else 'sin_imputar' end  as destino,
    coalesce(i.doc_number, o.invoice_number, r.document_number) as documento,
    coalesce(i.issued_at, o.order_date::date, r.issued_at)      as emitido,
    coalesce(i.due_date,  o.due_date,        r.due_date)        as vence,
    coalesce(i.total,     o.total,           r.amount)          as total_documento,
    -- Cuántos días pasaron entre que se emitió el documento y este pago.
    (pg.paid_at::date - coalesce(i.issued_at, o.order_date::date, r.issued_at)) as dias_desde_emision,
    (pg.paid_at::date - coalesce(i.due_date,  o.due_date,        r.due_date))   as dias_vs_vencimiento
  from public.payments pg
  join public.customers c on c.id = pg.customer_id
  left join public.payment_allocations a  on a.payment_id = pg.id
  left join public.invoices i             on i.id = a.invoice_id
  left join public.orders o               on o.id = a.order_id
  left join public.opening_receivables r  on r.id = a.opening_receivable_id
 where pg.direction = 'cobro';

alter view public.v_pagos_detalle set (security_invoker = on);
comment on view public.v_pagos_detalle is
  'Informe detallado de fechas de pago: una fila por cada imputación de un cobro a un documento.';

-- ---------- CUÁNTO SE DEMORA CADA CLIENTE ----------
-- La pregunta de negocio no es "cuánto debe" sino "cuándo paga".
-- Un cliente que siempre paga a 45 días es predecible; uno que paga
-- entre 5 y 90 días obliga a tener caja de más.
drop view if exists public.v_comportamiento_pago_cliente;
create view public.v_comportamiento_pago_cliente as
  with base as (
    select * from public.v_facturas_con_pago
     where doc_type in ('factura','boleta','nota_debito')
  ), pagadas as (
    select customer_id,
           count(*)                                                    as facturas_pagadas,
           round(avg(dias_en_pagar))::int                              as dias_promedio,
           percentile_cont(0.5) within group (order by dias_en_pagar)  as dias_mediana,
           min(dias_en_pagar)                                          as dias_minimo,
           max(dias_en_pagar)                                          as dias_maximo,
           round(stddev_samp(dias_en_pagar))::int                      as dias_desviacion,
           sum(total)                                                  as monto_pagado,
           max(ultimo_pago)                                            as ultimo_pago,
           count(*) filter (where dias_vs_plazo is not null and dias_vs_plazo <= 0) as a_tiempo,
           count(*) filter (where dias_vs_plazo is not null and dias_vs_plazo  > 0) as fuera_de_plazo,
           -- Últimos 90 días: sirve para ver si está empeorando.
           round(avg(dias_en_pagar) filter (where ultimo_pago >= current_date - 90))::int as dias_promedio_90d
      from base
     where payment_status = 'pagado' and dias_en_pagar is not null
     group by customer_id
  ), abiertas as (
    select customer_id,
           count(*)                        as facturas_abiertas,
           sum(saldo)                      as saldo_abierto,
           max(dias_esperando)             as espera_maxima,
           round(avg(dias_esperando))::int as espera_promedio
      from base
     where payment_status <> 'pagado' and saldo > 0
     group by customer_id
  ), emitidas as (
    select customer_id, count(*) as facturas_totales, sum(total) as monto_total,
           min(issued_at) as primera_factura, max(issued_at) as ultima_factura
      from base group by customer_id
  )
  select
    c.id                                    as customer_id,
    c.name                                  as cliente,
    c.rut,
    c.payment_terms_days                    as plazo_pactado,
    coalesce(e.facturas_totales, 0)         as facturas_totales,
    coalesce(e.monto_total, 0)              as monto_total,
    e.primera_factura,
    e.ultima_factura,
    coalesce(p.facturas_pagadas, 0)         as facturas_pagadas,
    coalesce(p.monto_pagado, 0)             as monto_pagado,
    p.dias_promedio,
    p.dias_mediana,
    p.dias_minimo,
    p.dias_maximo,
    p.dias_desviacion,
    p.dias_promedio_90d,
    p.ultimo_pago,
    coalesce(p.a_tiempo, 0)                 as a_tiempo,
    coalesce(p.fuera_de_plazo, 0)           as fuera_de_plazo,
    case when coalesce(p.a_tiempo, 0) + coalesce(p.fuera_de_plazo, 0) > 0
         then round(100.0 * p.a_tiempo / (p.a_tiempo + p.fuera_de_plazo))::int end as pct_a_tiempo,
    coalesce(a.facturas_abiertas, 0)        as facturas_abiertas,
    coalesce(a.saldo_abierto, 0)            as saldo_abierto,
    a.espera_maxima,
    a.espera_promedio,
    -- Cuánto se desvía de lo pactado: el número que ordena la lista de a quién apretar.
    case when p.dias_promedio is not null and c.payment_terms_days > 0
         then p.dias_promedio - c.payment_terms_days end as exceso_sobre_plazo
  from public.customers c
  left join emitidas e on e.customer_id = c.id
  left join pagadas  p on p.customer_id = c.id
  left join abiertas a on a.customer_id = c.id
 where c.status = 'activo';

alter view public.v_comportamiento_pago_cliente set (security_invoker = on);
comment on view public.v_comportamiento_pago_cliente is
  'Cuánto se demora cada cliente en pagar: promedio, mediana, dispersión y cumplimiento del plazo pactado.';

-- ---------- MESES CON MOVIMIENTO ----------
-- Alimenta el selector de mes de ventas, compras y cobranza: solo se
-- ofrecen meses que de verdad tienen documentos.
drop view if exists public.v_meses_actividad;
create view public.v_meses_actividad as
  select mes,
         sum(facturas)      as facturas,
         sum(venta)         as venta,
         sum(compras)       as compras,
         sum(costo_compras) as costo_compras,
         sum(cobros)        as cobros,
         sum(cobrado)       as cobrado
  from (
    select to_char(issued_at,'YYYY-MM') mes, count(*) facturas, sum(total) venta,
           0::bigint compras, 0::numeric costo_compras, 0::bigint cobros, 0::numeric cobrado
      from public.invoices group by 1
    union all
    select to_char(purchase_date,'YYYY-MM'), 0::bigint, 0::numeric, count(*), sum(total), 0::bigint, 0::numeric
      from public.purchases group by 1
    union all
    select to_char(paid_at,'YYYY-MM'), 0::bigint, 0::numeric, 0::bigint, 0::numeric, count(*), sum(amount)
      from public.payments where direction = 'cobro' group by 1
  ) t
  group by mes;

alter view public.v_meses_actividad set (security_invoker = on);
comment on view public.v_meses_actividad is
  'Meses que tienen movimiento, para poblar los selectores de mes sin ofrecer meses vacíos.';
