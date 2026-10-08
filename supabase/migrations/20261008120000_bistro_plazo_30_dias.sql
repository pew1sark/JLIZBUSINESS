-- BISTRO: EL PLAZO DE PAGO ES DE 30 DÍAS, NO 60
--
-- Qué pasaba: el vencimiento de cada venta importada de Bsale sale de
-- `coalesce(expirationDate de Bsale, emisión + plazo del cliente)`. En Bistro
-- el sistema mostraba 60 días (el plazo del cliente y/o el expirationDate del
-- documento venían a 60), y todo lo que depende del vencimiento —estado
-- vencido, días de atraso, Cobranza, comportamiento de pago— salía mal.
--
-- Qué hace esta migración:
--   1 · `plazo_fijo`: marca a los clientes cuyo plazo manda sobre lo que
--       diga Bsale. Con la marca, el vencimiento SIEMPRE es emisión + plazo.
--   2 · Bistro queda a 30 días y con la marca.
--   3 · Se recalcula el vencimiento de todas sus facturas y el estado de cobro.
--   4 · Si alguien cambia el plazo de un cliente marcado, sus facturas se
--       recalculan solas; las nuevas que entren de Bsale nacen bien.
--
-- Se busca por nombre ('%bistro%'). Si hubiera otro cliente con ese nombre que
-- NO deba ir a 30 días, quitarle la marca después en Clientes.

-- ---------- 1 · LA MARCA ----------
alter table public.customers
  add column if not exists plazo_fijo boolean not null default false;
comment on column public.customers.plazo_fijo is
  'true = el vencimiento de sus facturas es siempre emisión + payment_terms_days, sin importar el expirationDate que traiga Bsale.';

-- ---------- 2 · VENCIMIENTO SEGÚN EL PLAZO DEL CLIENTE ----------
create or replace function public.trg_invoice_vence_por_plazo()
returns trigger language plpgsql set search_path = public as $$
declare v_dias int;
begin
  select c.payment_terms_days into v_dias
    from public.customers c
   where c.id = new.customer_id and c.plazo_fijo;
  if found and v_dias is not null and new.issued_at is not null then
    new.due_date := (new.issued_at::date + v_dias);
  end if;
  return new;
end $$;

drop trigger if exists invoices_vence_por_plazo on public.invoices;
create trigger invoices_vence_por_plazo
  before insert or update of customer_id, issued_at, due_date on public.invoices
  for each row execute function public.trg_invoice_vence_por_plazo();

-- ---------- 3 · RECALCULAR LAS FACTURAS DE UN CLIENTE ----------
create or replace function public.recalcular_vencimientos_cliente(_customer_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.invoices where customer_id = _customer_id loop
    -- El trigger de arriba reescribe due_date; el update solo lo dispara.
    update public.invoices set due_date = due_date where id = r.id;
    perform public.recalc_receivable('factura', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.recalcular_vencimientos_cliente(uuid) from public, anon;

create or replace function public.trg_customer_plazo_recalcula()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.plazo_fijo and (
       new.payment_terms_days is distinct from old.payment_terms_days
       or old.plazo_fijo is distinct from new.plazo_fijo) then
    perform public.recalcular_vencimientos_cliente(new.id);
  end if;
  return new;
end $$;

drop trigger if exists customers_plazo_recalcula on public.customers;
create trigger customers_plazo_recalcula
  after update of payment_terms_days, plazo_fijo on public.customers
  for each row execute function public.trg_customer_plazo_recalcula();

-- ---------- 4 · BISTRO A 30 DÍAS ----------
-- El update dispara el recálculo de todas sus facturas (due_date + estado).
do $$
declare r record;
begin
  for r in
    select id, name, payment_terms_days from public.customers
     where name ilike '%bistro%'
  loop
    raise notice 'Bistro: % (plazo % -> 30)', r.name, r.payment_terms_days;
  end loop;
end $$;

update public.customers
   set payment_terms_days = 30, plazo_fijo = true
 where name ilike '%bistro%';

-- Si el plazo ya estaba en 30 y solo la marca cambió, el trigger también corre
-- (cambia plazo_fijo). Este paso cubre el caso de clientes ya marcados.
select public.recalcular_vencimientos_cliente(id)
  from public.customers
 where name ilike '%bistro%';
