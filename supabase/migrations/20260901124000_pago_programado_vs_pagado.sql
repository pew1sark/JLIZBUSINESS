-- UN PAGO CON FECHA FUTURA ES UNA PROGRAMACIÓN, NO UN PAGO
--
-- El cliente registra la fecha en que va a transferir o en que se cobra el
-- cheque (la que negoció con el proveedor), no solo la del día en que la plata
-- salió. Con fecha futura la factura quedaba en 'pagado' y entraba al promedio
-- de "pago real" como si ya hubiera ocurrido: el mes en curso siempre se vería
-- mejor de lo que todavía es.
--
-- La vista los separa en el tramo 'programada'. El dato del cliente no se toca:
-- la fecha que él cargó es la que él quiso cargar.

drop view if exists public.v_pago_proveedores;
create view public.v_pago_proveedores as
with pagos as (
  select purchase_id,
         min(paid_at at time zone 'America/Santiago')::date as primer_pago,
         max(paid_at at time zone 'America/Santiago')::date as ultimo_pago,
         count(*)                                            as n_pagos,
         bool_and(is_estimated)                              as todo_estimado,
         bool_or(is_estimated)                               as algo_estimado,
         string_agg(distinct method::text, ', ')             as metodos
    from public.payments
   where direction = 'pago' and purchase_id is not null
   group by purchase_id
)
select
  p.id                                    as purchase_id,
  p.code,
  p.invoice_number,
  p.dte_type,
  p.is_credit_note,
  p.origin,
  p.purchase_date                         as emitida,
  to_char(p.purchase_date, 'YYYY-MM')     as mes,
  p.supplier_id,
  s.name                                  as proveedor,
  s.company                               as razon_social,
  s.rut,

  -- Desglose tributario del SII. Para costear se usa el neto; para pagar, el bruto.
  p.total                                 as neto_mercaderia,
  p.net_amount                            as neto_afecto,
  p.exempt_amount                         as exento,
  p.tax_amount                            as iva,
  coalesce(p.gross_total, p.total)        as bruto,
  (p.net_amount is null)                  as sin_desglose,

  -- Plazo pactado ≠ fecha de vencimiento ≠ fecha real de pago ≠ días de atraso.
  p.terms_days                            as plazo_pactado,
  (p.purchase_date + coalesce(p.terms_days, 0))::date as vence,
  p.due_date                              as vence_dte,

  p.amount_paid                           as pagado,
  coalesce(p.gross_total, p.total) - p.amount_paid as saldo,
  p.payment_status::text                  as estado_pago,
  pg.n_pagos,
  pg.metodos,
  pg.primer_pago,
  pg.ultimo_pago,
  coalesce(pg.todo_estimado, false)       as pago_estimado,
  coalesce(pg.algo_estimado, false)       as tiene_pago_estimado,
  -- La plata todavía no sale: la fecha registrada está por delante de hoy.
  coalesce(pg.ultimo_pago > current_date, false) as pago_programado,

  -- La factura se considera saldada el día del último pago que la cierra.
  case when p.payment_status = 'pagado' then pg.ultimo_pago end as fecha_pago,
  case when p.payment_status = 'pagado' then pg.ultimo_pago - p.purchase_date end as dias_en_pagar,
  -- Negativo = se pagó antes del vencimiento.
  case when p.payment_status = 'pagado'
       then pg.ultimo_pago - (p.purchase_date + coalesce(p.terms_days, 0)) end as dias_atraso,
  -- Lo que lleva esperando una factura que todavía no se paga.
  case when p.payment_status <> 'pagado' and coalesce(p.gross_total, p.total) - p.amount_paid > 0
       then current_date - (p.purchase_date + coalesce(p.terms_days, 0)) end as dias_vencida,

  case
    when p.is_credit_note                                                      then 'nota_credito'
    when p.payment_status = 'pagado' and pg.ultimo_pago > current_date         then 'programada'
    when p.payment_status = 'pagado'                                           then 'pagada'
    when coalesce(p.gross_total, p.total) - p.amount_paid <= 0                 then 'pagada'
    when current_date > (p.purchase_date + coalesce(p.terms_days, 0))          then 'vencida'
    else 'por_vencer'
  end                                     as tramo,

  p.document_url,
  d.url_pdf,
  d.url_xml
from public.purchases p
join public.suppliers s on s.id = p.supplier_id
left join public.bsale_third_party_documents d on d.bsale_id = p.bsale_document_id
left join pagos pg on pg.purchase_id = p.id
where p.status = 'recibida';

alter view public.v_pago_proveedores set (security_invoker = on);
comment on view public.v_pago_proveedores is
  'Una fila por factura de compra recibida, con desglose de IVA, plazo pactado, vencimiento, fecha real de pago y días de atraso. Un pago con fecha futura queda en el tramo "programada" y no entra al promedio de pago real.';
