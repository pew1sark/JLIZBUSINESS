-- TODOS LOS PAGOS REGISTRADOS, COBROS Y PAGOS EN LA MISMA LISTA
--
-- Hasta ahora un cobro solo se podía buscar desde la cartola del cliente y un
-- pago a proveedor solo desde el modal de la compra: no había dónde preguntar
-- "qué transferencias se registraron en marzo" ni "dónde quedó la referencia
-- 4417", que es lo que se necesita al cuadrar contra la cartola del banco.
-- Esta vista pone las dos direcciones en una sola fila comparable.
drop view if exists public.v_pagos_registrados;
create view public.v_pagos_registrados as
select
  p.id                                                        as payment_id,
  p.code,
  p.direction,                                                -- 'cobro' | 'pago'
  p.amount,
  p.method::text                                              as metodo,
  (p.paid_at at time zone 'America/Santiago')::date            as fecha,
  to_char(p.paid_at at time zone 'America/Santiago', 'YYYY-MM') as mes,
  p.paid_at,
  p.reference,
  p.notes,
  p.is_estimated,
  p.created_at                                                as registrado_at,
  pf.email                                                    as registrado_por,

  -- La contraparte según la dirección: al proveedor se le paga, al cliente se le cobra.
  case when p.direction = 'pago' then s.name    else c.name    end as contraparte,
  case when p.direction = 'pago' then s.company else c.company end as razon_social,
  case when p.direction = 'pago' then s.rut     else c.rut     end as rut,
  p.supplier_id,
  p.customer_id,
  p.purchase_id,

  co.code                                                     as compra_code,
  co.invoice_number                                           as compra_factura,
  co.purchase_date                                            as compra_fecha,
  coalesce(co.gross_total, co.total)                          as compra_total,

  -- Un cobro se reparte entre varias facturas; lo que no se imputó queda a cuenta.
  (select string_agg(coalesce(i.doc_number, i.code), ', ' order by i.doc_number)
     from public.payment_allocations a
     join public.invoices i on i.id = a.invoice_id
    where a.payment_id = p.id)                                as documentos,
  (select coalesce(sum(a.amount), 0)
     from public.payment_allocations a where a.payment_id = p.id) as imputado,

  op.document_number                                          as saldo_inicial_doc
from public.payments p
left join public.suppliers s         on s.id  = p.supplier_id
left join public.customers c         on c.id  = p.customer_id
left join public.purchases co        on co.id = p.purchase_id
left join public.opening_payables op on op.id = p.opening_payable_id
left join public.profiles pf         on pf.id = p.created_by;

alter view public.v_pagos_registrados set (security_invoker = on);
comment on view public.v_pagos_registrados is
  'Un registro por pago o cobro, con su contraparte, su documento y quién lo registró. Base de la pestaña Pagos registrados de Finanzas.';
