-- ============================================================
-- JLIZ BUSINESS · CUENTAS POR COBRAR · vistas
-- ============================================================

-- Deuda viva, documento por documento, venga de donde venga.
-- Las notas de crédito no entran acá: son saldo a favor, no deuda.
drop view if exists public.v_cuentas_por_cobrar;
create view public.v_cuentas_por_cobrar as
  select 'factura'::text as origen,
         i.id as ref_id, null::uuid as order_id, null::uuid as receivable_id, i.id as invoice_id,
         i.code, i.doc_type::text as doc_type, i.doc_number,
         i.customer_id, c.name as cliente, c.phone, c.whatsapp, c.email,
         i.issued_at, i.due_date, i.total, i.amount_paid, (i.total - i.amount_paid) as saldo,
         i.doc_number as invoice_number,
         greatest(current_date - i.due_date, 0) as dias_atraso,
         case when i.due_date is null then 'sin_plazo'
              when current_date <= i.due_date then 'al_dia'
              when current_date - i.due_date <= 15 then 'atraso_leve'
              when current_date - i.due_date <= 30 then 'atraso_medio'
              else 'atraso_grave' end as tramo
    from public.invoices i
    join public.customers c on c.id = i.customer_id
   where i.doc_type in ('factura','boleta','nota_debito')
     and (i.total - i.amount_paid) > 0

  union all
  select 'pedido', o.id, o.id, null::uuid, null::uuid,
         o.code, 'pedido', o.invoice_number,
         o.customer_id, c.name, c.phone, c.whatsapp, c.email,
         o.order_date::date, o.due_date, o.total, o.amount_paid, (o.total - o.amount_paid),
         o.invoice_number,
         greatest(current_date - o.due_date, 0),
         case when o.due_date is null then 'sin_plazo'
              when current_date <= o.due_date then 'al_dia'
              when current_date - o.due_date <= 15 then 'atraso_leve'
              when current_date - o.due_date <= 30 then 'atraso_medio'
              else 'atraso_grave' end
    from public.orders o
    join public.customers c on c.id = o.customer_id
   where o.status <> 'cancelado' and (o.total - o.amount_paid) > 0
     and not exists (select 1 from public.invoices i2 where i2.order_id = o.id)

  union all
  select 'saldo_inicial', r.id, null::uuid, r.id, null::uuid,
         r.code, 'saldo_inicial', r.document_number,
         r.customer_id, coalesce(c.name, r.customer_name), c.phone, c.whatsapp, c.email,
         r.issued_at, r.due_date, r.amount, r.amount_paid, (r.amount - r.amount_paid),
         r.document_number,
         greatest(current_date - r.due_date, 0),
         case when r.due_date is null then 'sin_plazo'
              when current_date <= r.due_date then 'al_dia'
              when current_date - r.due_date <= 15 then 'atraso_leve'
              when current_date - r.due_date <= 30 then 'atraso_medio'
              else 'atraso_grave' end
    from public.opening_receivables r
    left join public.customers c on c.id = r.customer_id
   where (r.amount - r.amount_paid) > 0;

alter view public.v_cuentas_por_cobrar set (security_invoker = on);

-- Notas de crédito todavía no descontadas: plata a favor del cliente.
create or replace view public.v_notas_credito_pendientes as
  select i.id, i.code, i.doc_number, i.customer_id, c.name as cliente,
         i.issued_at, i.related_doc_number,
         abs(i.total) as monto, i.amount_paid as aplicado,
         (abs(i.total) - i.amount_paid) as disponible
    from public.invoices i
    join public.customers c on c.id = i.customer_id
   where i.doc_type = 'nota_credito' and (abs(i.total) - i.amount_paid) > 0;

alter view public.v_notas_credito_pendientes set (security_invoker = on);

-- Transferencias recibidas que todavía no se sabe qué factura pagan.
create or replace view public.v_pagos_sin_imputar as
  select p.id, p.code, p.customer_id, c.name as cliente, p.amount, p.method, p.paid_at, p.reference, p.notes,
         coalesce(sum(a.amount), 0) as imputado,
         p.amount - coalesce(sum(a.amount), 0) as sin_imputar
    from public.payments p
    join public.customers c on c.id = p.customer_id
    left join public.payment_allocations a on a.payment_id = p.id
   where p.direction = 'cobro'
   group by p.id, p.code, p.customer_id, c.name, p.amount, p.method, p.paid_at, p.reference, p.notes
  having p.amount - coalesce(sum(a.amount), 0) > 0;

alter view public.v_pagos_sin_imputar set (security_invoker = on);

-- Una fila por cliente: cuánto debe, hace cuánto y qué tiene a favor.
create or replace view public.v_estado_cuenta_cliente as
  with deuda as (
    select customer_id,
           count(*)                                                              as documentos,
           sum(saldo)                                                            as deuda_total,
           sum(saldo) filter (where dias_atraso = 0)                             as por_vencer,
           sum(saldo) filter (where dias_atraso between 1 and 15)                as atraso_1_15,
           sum(saldo) filter (where dias_atraso between 16 and 30)               as atraso_16_30,
           sum(saldo) filter (where dias_atraso between 31 and 60)               as atraso_31_60,
           sum(saldo) filter (where dias_atraso > 60)                            as atraso_60_mas,
           sum(saldo) filter (where dias_atraso > 0)                             as vencido,
           max(dias_atraso)                                                      as peor_atraso,
           min(due_date) filter (where saldo > 0)                                as vence_primero
      from public.v_cuentas_por_cobrar group by customer_id
  ), credito as (
    select customer_id, sum(disponible) as nota_credito from public.v_notas_credito_pendientes group by customer_id
  ), acuenta as (
    select customer_id, sum(sin_imputar) as pago_a_cuenta from public.v_pagos_sin_imputar group by customer_id
  ), ultimo as (
    select customer_id, max(paid_at) as ultimo_pago from public.payments where direction = 'cobro' group by customer_id
  )
  select c.id as customer_id, c.name as cliente, c.rut, c.comuna, c.phone, c.whatsapp, c.email,
         c.credit_limit, c.payment_terms_days,
         coalesce(d.documentos, 0)      as documentos,
         coalesce(d.deuda_total, 0)     as deuda_total,
         coalesce(d.por_vencer, 0)      as por_vencer,
         coalesce(d.atraso_1_15, 0)     as atraso_1_15,
         coalesce(d.atraso_16_30, 0)    as atraso_16_30,
         coalesce(d.atraso_31_60, 0)    as atraso_31_60,
         coalesce(d.atraso_60_mas, 0)   as atraso_60_mas,
         coalesce(d.vencido, 0)         as vencido,
         coalesce(d.peor_atraso, 0)     as peor_atraso,
         d.vence_primero,
         coalesce(cr.nota_credito, 0)   as nota_credito,
         coalesce(ac.pago_a_cuenta, 0)  as pago_a_cuenta,
         coalesce(d.deuda_total, 0) - coalesce(cr.nota_credito, 0) - coalesce(ac.pago_a_cuenta, 0) as saldo_neto,
         u.ultimo_pago,
         case when c.credit_limit > 0 and coalesce(d.deuda_total,0) > c.credit_limit then true else false end as sobre_limite
    from public.customers c
    left join deuda   d  on d.customer_id  = c.id
    left join credito cr on cr.customer_id = c.id
    left join acuenta ac on ac.customer_id = c.id
    left join ultimo  u  on u.customer_id  = c.id
   where c.status = 'activo';

alter view public.v_estado_cuenta_cliente set (security_invoker = on);
