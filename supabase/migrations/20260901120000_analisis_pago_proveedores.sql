-- ANÁLISIS DE PAGOS A PROVEEDORES
--
-- Hasta ahora la pantalla de pagos solo sabía cuánto se le debe a cada proveedor.
-- Faltaba lo que hace falta para decidir: a qué plazo se pactó cada factura, cuándo
-- vence de verdad, cuándo se pagó y cuántos días de atraso hubo. Este archivo agrega
-- esas cuatro cosas, que son distintas entre sí y se confundían en una sola columna.
--
-- Dos datos que había que inventar porque la fuente no los trae:
--
-- 1 · El PLAZO PACTADO. Bsale entrega `expirationDate` y en 1.034 de 1.427 compras
--     viene igual a la fecha de emisión ("contado"), aunque el negocio en realidad
--     paga a ~32 días. El plazo se resuelve en cascada: lo que diga el documento si
--     es mayor que cero → el plazo configurado del proveedor → el default de la
--     empresa. Queda guardado en `purchases.terms_days` para que se pueda corregir
--     por compra sin tocar el resto.
--
-- 2 · La FECHA REAL DE PAGO de lo histórico, que nunca se registró. Se carga con
--     `registrar_pagos_proveedor_historico()`, que marca esos pagos con
--     `payments.is_estimated` para que ningún informe los confunda con un pago
--     comprobado contra la cartola del banco.

-- ---------- 1 · DEFAULT DE LA EMPRESA ----------
update public.settings
   set value = value || jsonb_build_object('dias_pago_proveedor_default', 32)
 where key = 'operacion'
   and not (value ? 'dias_pago_proveedor_default');

-- ---------- 2 · PLAZO PACTADO POR COMPRA ----------
alter table public.purchases add column if not exists terms_days integer;
comment on column public.purchases.terms_days is
  'Plazo de crédito pactado con el proveedor, en días. Base del vencimiento real: el expirationDate del DTE viene en cero en la mayoría de las facturas.';

create or replace function public.plazo_proveedor_default()
returns integer language sql stable security definer set search_path = public as $fn$
  select coalesce((select (value->>'dias_pago_proveedor_default')::int
                     from public.settings where key = 'operacion'), 32);
$fn$;

create or replace function public.plazo_proveedor(_supplier_id uuid, _purchase_date date, _due_date date)
returns integer language sql stable security definer set search_path = public as $fn$
  select coalesce(
    nullif(greatest(_due_date - _purchase_date, 0), 0),
    nullif((select payment_terms_days from public.suppliers where id = _supplier_id), 0),
    public.plazo_proveedor_default()
  );
$fn$;

create or replace function public.trg_purchase_terms()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- Solo se rellena cuando está vacío: si alguien corrige el plazo de una compra
  -- a mano, la sincronización de Bsale no debe volver a pisarlo.
  if new.terms_days is null then
    new.terms_days := public.plazo_proveedor(new.supplier_id, new.purchase_date, new.due_date);
  end if;
  return new;
end $fn$;

drop trigger if exists purchases_terms on public.purchases;
create trigger purchases_terms
  before insert or update of due_date, supplier_id, purchase_date on public.purchases
  for each row execute function public.trg_purchase_terms();

update public.purchases p
   set terms_days = public.plazo_proveedor(p.supplier_id, p.purchase_date, p.due_date)
 where p.terms_days is null;

-- ---------- 3 · UN PAGO PUEDE SER ESTIMADO ----------
alter table public.payments add column if not exists is_estimated boolean not null default false;
comment on column public.payments.is_estimated is
  'true = el pago no se registró cuando ocurrió, se reconstruyó a plazo fijo en la carga histórica. Nunca mezclar con un pago comprobado al medir cumplimiento.';

-- ---------- 4 · UNA FILA POR FACTURA DE COMPRA, CON SU HISTORIA DE PAGO ----------
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
    when p.is_credit_note                                                        then 'nota_credito'
    when p.payment_status = 'pagado'                                             then 'pagada'
    when coalesce(p.gross_total, p.total) - p.amount_paid <= 0                   then 'pagada'
    when current_date > (p.purchase_date + coalesce(p.terms_days, 0))            then 'vencida'
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
  'Una fila por factura de compra recibida, con desglose de IVA, plazo pactado, vencimiento, fecha real de pago y días de atraso. Base del módulo Análisis de pagos a proveedores.';
