-- ============================================================
-- JLIZ BUSINESS · IVA DE COMPRAS
--
-- `purchases` nunca guardó el IVA: recalc_purchase_totals arma
-- total = subtotal + flete + otros, todo neto. Como cuentas por pagar
-- muestra ese total, el sistema decía que a los proveedores se les debe
-- el neto de la mercadería, cuando lo que se paga es la factura completa:
-- con IVA y con las líneas que no son mercadería (peajes, combustible,
-- servicios), que hoy solo viven en v_gastos_operacionales.
--
-- El desglose bueno ya estaba llegando de Bsale en
-- bsale_third_party_documents (neto, exento, IVA, total del SII).
-- Esto lo baja a `purchases` y deja `total` intacto, porque de ahí
-- cuelga el costeo y el margen: el costo es neto, la deuda es bruta.
-- ============================================================

alter table public.purchases
  add column if not exists net_amount     numeric(14,2),
  add column if not exists exempt_amount  numeric(14,2) not null default 0,
  add column if not exists tax_amount     numeric(14,2) not null default 0,
  add column if not exists gross_total    numeric(14,2),
  add column if not exists dte_type       int,
  add column if not exists is_credit_note boolean not null default false;

comment on column public.purchases.total       is 'Costo neto de la mercadería (subtotal + flete + otros). Base del costeo y del margen.';
comment on column public.purchases.net_amount  is 'Neto afecto del documento tributario completo, según el SII.';
comment on column public.purchases.tax_amount  is 'IVA del documento tributario.';
comment on column public.purchases.gross_total is 'Lo que efectivamente se le paga al proveedor: neto + exento + IVA.';

update public.purchases p set
  net_amount     = d.net_amount,
  exempt_amount  = coalesce(d.exempt_amount, 0),
  tax_amount     = coalesce(d.iva_amount, 0),
  dte_type       = d.dte_type,
  is_credit_note = coalesce(d.dte_type = 61, false),
  gross_total    = case when d.dte_type = 61 then -d.total_amount else d.total_amount end
from public.bsale_third_party_documents d
where d.bsale_id = p.bsale_document_id;

-- Compras cargadas a mano, sin documento de Bsale: no hay desglose que bajar.
-- Quedan con net_amount nulo para poder distinguirlas en la pantalla.
update public.purchases
   set gross_total = total, tax_amount = 0, exempt_amount = 0
 where gross_total is null;

create index if not exists purchases_dte_idx on public.purchases (dte_type) where dte_type is not null;

-- ---------- LA DEUDA SE MIDE SOBRE EL BRUTO ----------
create or replace function public.trg_apply_payment()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_total numeric; v_paid numeric;
begin
  if new.purchase_id is not null then
    -- gross_total, no total: al proveedor se le paga la factura con IVA.
    select coalesce(gross_total, total) into v_total from public.purchases where id = new.purchase_id;
    select coalesce(sum(amount),0) into v_paid from public.payments
      where purchase_id = new.purchase_id and direction = 'pago';
    update public.purchases set
      amount_paid = v_paid,
      payment_status = (case
        when v_total > 0 and v_paid >= v_total then 'pagado'
        when v_paid > 0 then 'parcial' else 'pendiente' end)::public.payment_status
    where id = new.purchase_id;
  end if;

  if new.opening_payable_id is not null then
    select coalesce(sum(amount),0) into v_paid from public.payments
      where opening_payable_id = new.opening_payable_id and direction = 'pago';
    update public.opening_payables set amount_paid = v_paid where id = new.opening_payable_id;
  end if;

  return new;
end $$;

-- ---------- CUENTAS POR PAGAR, YA CON IVA ----------
drop view if exists public.v_cuentas_por_pagar;
create view public.v_cuentas_por_pagar as
  select 'compra'::text as origen,
         p.id as ref_id, p.id as purchase_id, null::uuid as payable_id,
         p.code, p.supplier_id, s.name as proveedor, s.phone,
         p.purchase_date as issued_at, p.due_date,
         coalesce(p.gross_total, p.total)             as total,
         p.total                                      as neto_mercaderia,
         p.net_amount, p.exempt_amount, p.tax_amount,
         p.invoice_number, p.document_url, p.dte_type,
         p.amount_paid,
         coalesce(p.gross_total, p.total) - p.amount_paid as saldo,
         greatest(current_date - coalesce(p.due_date, p.purchase_date + s.payment_terms_days), 0) as dias_atraso
    from public.purchases p
    join public.suppliers s on s.id = p.supplier_id
   where p.status = 'recibida'
     and not p.is_credit_note
     and (coalesce(p.gross_total, p.total) - p.amount_paid) > 0
     and p.purchase_date >= analisis_desde()

  union all
  select 'nota_credito', p.id, p.id, null::uuid,
         p.code, p.supplier_id, s.name, s.phone,
         p.purchase_date, p.due_date,
         coalesce(p.gross_total, -p.total), -p.total,
         -p.net_amount, -p.exempt_amount, -p.tax_amount,
         p.invoice_number, p.document_url, p.dte_type,
         0::numeric, coalesce(p.gross_total, -p.total), 0
    from public.purchases p
    join public.suppliers s on s.id = p.supplier_id
   where p.is_credit_note and p.purchase_date >= analisis_desde()

  union all
  select 'saldo_inicial', a.id, null::uuid, a.id,
         a.code, a.supplier_id, coalesce(s.name, a.supplier_name), s.phone,
         a.issued_at, a.due_date,
         a.amount, a.amount, null::numeric, 0::numeric, 0::numeric,
         a.document_number, null::text, null::int,
         a.amount_paid, a.amount - a.amount_paid,
         greatest(current_date - a.due_date, 0)
    from public.opening_payables a
    left join public.suppliers s on s.id = a.supplier_id
   where (a.amount - a.amount_paid) > 0
     and coalesce(a.issued_at, analisis_desde()) >= analisis_desde();

alter view public.v_cuentas_por_pagar set (security_invoker = on);
comment on view public.v_cuentas_por_pagar is
  'Deuda con proveedores medida sobre el bruto del documento (neto + exento + IVA). Las notas de crédito entran con signo negativo para que el total por proveedor cuadre.';
