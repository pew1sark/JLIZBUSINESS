-- ============================================================
-- El desglose de IVA tiene que llenarse solo
--
-- La migración que agregó net_amount / exempt_amount / tax_amount /
-- gross_total rellenó las compras que ya existían, pero las que entran cada
-- 30 minutos por la sincronización de Bsale nacían con esos campos vacíos.
-- Como v_cuentas_por_pagar hace coalesce(gross_total, total), esas compras
-- volvían a mostrarse sin IVA y en silencio: la deuda con el proveedor
-- aparecía otra vez por el neto.
--
-- En vez de parchar bsale_apply_purchases, el desglose se llena con un
-- trigger: así vale para cualquier camino que inserte una compra, hoy o
-- después, sin que haya que acordarse.
-- ============================================================
create or replace function public.trg_purchase_desglose()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare d record;
begin
  if new.bsale_document_id is not null then
    select net_amount, exempt_amount, iva_amount, total_amount, dte_type
      into d
      from public.bsale_third_party_documents
     where bsale_id = new.bsale_document_id
     limit 1;

    if found then
      new.net_amount     := d.net_amount;
      new.exempt_amount  := coalesce(d.exempt_amount, 0);
      new.tax_amount     := coalesce(d.iva_amount, 0);
      new.dte_type       := d.dte_type;
      new.is_credit_note := coalesce(d.dte_type = 61, false);
      -- La nota de crédito descuenta: entra con signo negativo para que el
      -- total por proveedor cuadre solo.
      new.gross_total    := case when d.dte_type = 61
                                 then -d.total_amount else d.total_amount end;
      return new;
    end if;
  end if;

  -- Compra cargada a mano o documento que todavía no llega de Bsale: el bruto
  -- es lo único que se sabe. net_amount queda nulo a propósito, que es como la
  -- pantalla distingue "sin desglose" de "exenta".
  if new.gross_total is null
     or (tg_op = 'UPDATE' and new.total is distinct from old.total
         and new.gross_total = old.total) then
    new.gross_total := new.total;
  end if;
  return new;
end $$;

drop trigger if exists purchases_desglose on public.purchases;
create trigger purchases_desglose
  before insert or update of total, bsale_document_id on public.purchases
  for each row execute function public.trg_purchase_desglose();

comment on function public.trg_purchase_desglose is
  'Llena el desglose tributario de una compra desde el documento de Bsale. Sin documento, el bruto sigue al total.';

-- ---------- REPARAR LAS QUE ENTRARON SIN DESGLOSE ----------
update public.purchases p set
  net_amount     = d.net_amount,
  exempt_amount  = coalesce(d.exempt_amount, 0),
  tax_amount     = coalesce(d.iva_amount, 0),
  dte_type       = d.dte_type,
  is_credit_note = coalesce(d.dte_type = 61, false),
  gross_total    = case when d.dte_type = 61 then -d.total_amount else d.total_amount end
from public.bsale_third_party_documents d
where d.bsale_id = p.bsale_document_id
  and p.gross_total is null;

update public.purchases set gross_total = total where gross_total is null;
