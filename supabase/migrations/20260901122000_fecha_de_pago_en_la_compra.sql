-- LA COMPRA GUARDA CUÁNDO SE PAGÓ, Y ANULAR UN PAGO DEVUELVE EL SALDO
--
-- Dos cosas que faltaban en el mismo trigger:
--
-- 1 · `payments_apply` era AFTER INSERT y nada más. Al anular un pago a proveedor
--     (`void_payment` borra la fila de payments) la compra se quedaba con el
--     amount_paid y el estado de antes: seguía diciendo "pagada" sin ningún pago
--     detrás. En cobranza no pasaba porque ahí el recálculo cuelga de
--     payment_allocations, que sí tiene trigger de DELETE.
--
-- 2 · La pantalla de compras mostraba el estado de pago pero no la fecha, y esa
--     fecha vivía solo dentro del modal de pago. Guardarla en la compra evita que
--     cada pantalla tenga que ir a buscarla a payments.

alter table public.purchases add column if not exists last_payment_at date;
comment on column public.purchases.last_payment_at is
  'Fecha del último pago registrado de esta compra. La mantiene el trigger payments_apply; no escribirla a mano.';

create or replace function public.trg_apply_payment()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare v_total numeric; v_paid numeric; v_fecha date; v_purchase uuid; v_payable uuid;
begin
  -- En DELETE la fila que importa es OLD; en INSERT, NEW.
  v_purchase := coalesce(new.purchase_id, old.purchase_id);
  v_payable  := coalesce(new.opening_payable_id, old.opening_payable_id);

  if v_purchase is not null then
    -- gross_total, no total: al proveedor se le paga la factura con IVA.
    select coalesce(gross_total, total) into v_total from public.purchases where id = v_purchase;
    select coalesce(sum(amount), 0), max((paid_at at time zone 'America/Santiago')::date)
      into v_paid, v_fecha
      from public.payments where purchase_id = v_purchase and direction = 'pago';
    update public.purchases set
      amount_paid = v_paid,
      last_payment_at = v_fecha,
      payment_status = (case
        when v_total > 0 and v_paid >= v_total then 'pagado'
        when v_paid > 0 then 'parcial' else 'pendiente' end)::public.payment_status
    where id = v_purchase;
  end if;

  if v_payable is not null then
    select coalesce(sum(amount), 0) into v_paid from public.payments
      where opening_payable_id = v_payable and direction = 'pago';
    update public.opening_payables set amount_paid = v_paid where id = v_payable;
  end if;

  return coalesce(new, old);
end $fn$;

drop trigger if exists payments_apply on public.payments;
create trigger payments_apply
  after insert or delete on public.payments
  for each row execute function public.trg_apply_payment();

-- Rellenar la fecha de lo que ya estaba pagado.
update public.purchases p
   set last_payment_at = t.fecha
  from (select purchase_id, max((paid_at at time zone 'America/Santiago')::date) as fecha
          from public.payments
         where direction = 'pago' and purchase_id is not null
         group by purchase_id) t
 where p.id = t.purchase_id and p.last_payment_at is distinct from t.fecha;
