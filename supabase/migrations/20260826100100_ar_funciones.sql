-- ============================================================
-- JLIZ BUSINESS · CUENTAS POR COBRAR · lógica
-- Imputación de pagos, cartola por cliente y vistas de cobranza.
-- ============================================================

-- ---------- RECÁLCULO DE UN DOCUMENTO ----------
-- Único lugar donde se decide cuánto está pagado un documento:
-- siempre la suma de sus imputaciones, nunca un valor escrito a mano.
create or replace function public.recalc_receivable(_kind text, _id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_total numeric; v_paid numeric; v_due date;
begin
  if _id is null then return; end if;

  if _kind = 'factura' then
    select total, due_date into v_total, v_due from public.invoices where id = _id;
    select coalesce(sum(amount),0) into v_paid from public.payment_allocations where invoice_id = _id;
    update public.invoices set
      amount_paid = v_paid,
      payment_status = (case
        when v_total > 0 and v_paid >= v_total then 'pagado'
        when v_total < 0 and v_paid >= abs(v_total) then 'pagado'
        when v_paid > 0 then 'parcial'
        when v_due is not null and v_due < current_date then 'vencido'
        else 'pendiente' end)::public.payment_status
    where id = _id;

  elsif _kind = 'pedido' then
    select total, due_date into v_total, v_due from public.orders where id = _id;
    select coalesce(sum(amount),0) into v_paid from public.payment_allocations where order_id = _id;
    update public.orders set
      amount_paid = v_paid,
      payment_status = (case
        when v_total > 0 and v_paid >= v_total then 'pagado'
        when v_paid > 0 then 'parcial'
        when v_due is not null and v_due < current_date then 'vencido'
        else 'pendiente' end)::public.payment_status
    where id = _id;

  elsif _kind = 'saldo_inicial' then
    select coalesce(sum(amount),0) into v_paid from public.payment_allocations where opening_receivable_id = _id;
    update public.opening_receivables set amount_paid = v_paid where id = _id;
  end if;
end $$;

create or replace function public.trg_recalc_allocation()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op in ('INSERT','UPDATE') then
    perform public.recalc_receivable('factura',       new.invoice_id);
    perform public.recalc_receivable('pedido',        new.order_id);
    perform public.recalc_receivable('saldo_inicial', new.opening_receivable_id);
  end if;
  if tg_op in ('UPDATE','DELETE') then
    perform public.recalc_receivable('factura',       old.invoice_id);
    perform public.recalc_receivable('pedido',        old.order_id);
    perform public.recalc_receivable('saldo_inicial', old.opening_receivable_id);
  end if;
  return null;
end $$;

create trigger allocations_recalc after insert or update or delete on public.payment_allocations
  for each row execute function public.trg_recalc_allocation();

-- El trigger antiguo escribía amount_paid desde payments directamente.
-- Ahora la verdad de las cuentas por cobrar vive en payment_allocations,
-- así que este se queda solo con el lado de proveedores.
create or replace function public.trg_apply_payment()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_total numeric; v_paid numeric;
begin
  if new.purchase_id is not null then
    select total into v_total from public.purchases where id = new.purchase_id;
    select coalesce(sum(amount),0) into v_paid from public.payments
      where purchase_id = new.purchase_id and direction = 'pago';
    update public.purchases set
      amount_paid = v_paid,
      payment_status = (case
        when v_paid >= v_total and v_total > 0 then 'pagado'
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

-- ---------- IMPUTAR UN PAGO ----------
-- _allocations: [{"kind":"factura","id":"uuid","amount":12345}, ...]
create or replace function public.allocate_payment(_payment_id uuid, _allocations jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  a jsonb; v_monto numeric; v_suma numeric := 0; v_saldo numeric; v_kind text; v_id uuid;
begin
  if not (public.is_admin() or public.has_perm('payments','update') or public.has_perm('payments','create')) then
    raise exception 'Sin permiso para imputar pagos';
  end if;

  select amount into v_monto from public.payments where id = _payment_id;
  if v_monto is null then raise exception 'El pago no existe'; end if;

  -- Reimputar es borrar y volver a repartir: nunca queda un resto viejo colgando.
  delete from public.payment_allocations where payment_id = _payment_id;

  for a in select * from jsonb_array_elements(coalesce(_allocations,'[]'::jsonb)) loop
    v_kind := a->>'kind';
    v_id   := (a->>'id')::uuid;
    v_suma := v_suma + (a->>'amount')::numeric;

    if (a->>'amount')::numeric <= 0 then
      raise exception 'Cada imputación debe ser mayor a cero';
    end if;

    -- No se puede imputar más de lo que el documento debe.
    if v_kind = 'factura' then
      select total - amount_paid into v_saldo from public.invoices where id = v_id;
    elsif v_kind = 'pedido' then
      select total - amount_paid into v_saldo from public.orders where id = v_id;
    elsif v_kind = 'saldo_inicial' then
      select amount - amount_paid into v_saldo from public.opening_receivables where id = v_id;
    else
      raise exception 'Tipo de documento no válido: %', v_kind;
    end if;

    if v_saldo is null then raise exception 'Documento no encontrado'; end if;
    if (a->>'amount')::numeric > v_saldo + 0.01 then
      raise exception 'La imputación (%) supera el saldo del documento (%)', (a->>'amount')::numeric, v_saldo;
    end if;

    insert into public.payment_allocations (payment_id, invoice_id, order_id, opening_receivable_id, amount, created_by)
    values (
      _payment_id,
      case when v_kind = 'factura'       then v_id end,
      case when v_kind = 'pedido'        then v_id end,
      case when v_kind = 'saldo_inicial' then v_id end,
      (a->>'amount')::numeric,
      auth.uid()
    );
  end loop;

  if v_suma > v_monto + 0.01 then
    raise exception 'Lo imputado (%) supera el monto del pago (%)', v_suma, v_monto;
  end if;

  return jsonb_build_object('ok', true, 'imputado', v_suma, 'sin_imputar', v_monto - v_suma);
end $$;

-- Imputación automática: la factura más antigua por vencer se paga primero.
-- Es la regla que ordena el desorden cuando el cliente transfiere sin decir qué paga.
create or replace function public.auto_allocate_payment(_payment_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_cliente uuid; v_monto numeric; v_restante numeric; v_allocs jsonb := '[]'::jsonb; d record; v_aplica numeric;
begin
  select customer_id, amount into v_cliente, v_monto from public.payments where id = _payment_id;
  if v_cliente is null then raise exception 'El pago no tiene cliente asociado'; end if;

  v_restante := v_monto;

  for d in
    select origen, ref_id, saldo, due_date, issued_at from public.v_cuentas_por_cobrar
     where customer_id = v_cliente and saldo > 0
     order by coalesce(due_date, date '2100-01-01'), issued_at
  loop
    exit when v_restante <= 0;
    v_aplica := least(v_restante, d.saldo);
    v_allocs := v_allocs || jsonb_build_array(jsonb_build_object('kind', d.origen, 'id', d.ref_id, 'amount', v_aplica));
    v_restante := v_restante - v_aplica;
  end loop;

  return public.allocate_payment(_payment_id, v_allocs);
end $$;

-- ---------- REGISTRAR UN COBRO ----------
-- Un solo punto de entrada: la transferencia entra completa y después
-- se decide qué facturas cubre (a mano o por antigüedad).
create or replace function public.register_customer_payment(
  _customer_id uuid,
  _amount      numeric,
  _method      public.payment_method default 'transferencia',
  _paid_at     timestamptz default now(),
  _reference   text default null,
  _notes       text default null,
  _allocations jsonb default null,
  _auto        boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_res jsonb;
begin
  if not (public.is_admin() or public.has_perm('payments','create')) then
    raise exception 'Sin permiso para registrar cobros';
  end if;
  if _amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  if _customer_id is null then raise exception 'Falta el cliente'; end if;

  insert into public.payments (direction, customer_id, amount, method, paid_at, reference, notes, created_by)
  values ('cobro', _customer_id, _amount, _method, _paid_at, _reference, _notes, auth.uid())
  returning id into v_id;

  if _auto then
    v_res := public.auto_allocate_payment(v_id);
  elsif _allocations is not null and jsonb_array_length(_allocations) > 0 then
    v_res := public.allocate_payment(v_id, _allocations);
  else
    v_res := jsonb_build_object('ok', true, 'imputado', 0, 'sin_imputar', _amount);
  end if;

  return v_res || jsonb_build_object('payment_id', v_id);
end $$;

-- Compatibilidad: la pantalla de Finanzas cobra documento por documento.
create or replace function public.register_collection(
  _origen text, _ref_id uuid, _amount numeric,
  _method public.payment_method default 'transferencia', _reference text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_cliente uuid;
begin
  if _origen = 'factura' then
    select customer_id into v_cliente from public.invoices where id = _ref_id;
  elsif _origen = 'pedido' then
    select customer_id into v_cliente from public.orders where id = _ref_id;
  elsif _origen = 'saldo_inicial' then
    select customer_id into v_cliente from public.opening_receivables where id = _ref_id;
  else
    raise exception 'Origen no válido';
  end if;
  if v_cliente is null then raise exception 'El documento no tiene cliente asociado'; end if;

  return public.register_customer_payment(
    v_cliente, _amount, _method, now(), _reference, null,
    jsonb_build_array(jsonb_build_object('kind', _origen, 'id', _ref_id, 'amount', _amount)),
    false
  );
end $$;

-- ---------- ANULAR / DESIMPUTAR ----------
create or replace function public.void_payment(_payment_id uuid, _reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede anular un pago'; end if;
  delete from public.payment_allocations where payment_id = _payment_id;
  delete from public.payments where id = _payment_id;
  insert into public.audit_logs (user_id, action, table_name, record_id, reason)
  values (auth.uid(), 'ANULAR_PAGO', 'payments', _payment_id::text, _reason);
  return jsonb_build_object('ok', true);
end $$;
