-- CORREGIR UN PAGO YA REGISTRADO
--
-- Un pago con la fecha mal cargada solo se podía arreglar anulándolo y
-- registrándolo de nuevo, y si era un cobro repartido entre varias facturas había
-- que volver a imputarlo entero. Ahora se corrigen los datos del pago en su lugar:
-- fecha, forma de pago, N° de operación y nota. El monto no se toca acá porque
-- cuelga de las imputaciones; para eso sigue estando anular.

-- 1 · El trigger de la compra también escucha cambios de fecha y monto, para que
--     `purchases.last_payment_at` siga la fecha corregida.
drop trigger if exists payments_apply on public.payments;
create trigger payments_apply
  after insert or delete or update of paid_at, amount on public.payments
  for each row execute function public.trg_apply_payment();

-- 2 · La corrección, con el antes y el después en la auditoría.
create or replace function public.update_payment(
  _payment_id uuid,
  _fecha      date,
  _method     text,
  _reference  text default null,
  _notes      text default null,
  _reason     text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_antes public.payments; v_despues public.payments;
begin
  if not public.is_admin() then raise exception 'Solo un administrador puede corregir un pago'; end if;
  if _fecha is null then raise exception 'Falta la fecha del pago'; end if;

  select * into v_antes from public.payments where id = _payment_id for update;
  if not found then raise exception 'El pago no existe'; end if;

  update public.payments set
    -- Mediodía en Chile, igual que al registrar: la fecha no se corre al leerla.
    paid_at      = case
                     when (paid_at at time zone 'America/Santiago')::date = _fecha then paid_at
                     else (_fecha + time '12:00') at time zone 'America/Santiago'
                   end,
    method       = _method::public.payment_method,
    reference    = nullif(trim(_reference), ''),
    notes        = nullif(trim(_notes), ''),
    -- Alguien revisó la fecha a mano: deja de ser una reconstrucción.
    is_estimated = case when (paid_at at time zone 'America/Santiago')::date = _fecha
                        then is_estimated else false end
  where id = _payment_id
  returning * into v_despues;

  insert into public.audit_logs (user_id, action, table_name, record_id, before, after, reason)
  values (auth.uid(), 'CORREGIR_PAGO', 'payments', _payment_id::text,
          jsonb_build_object('paid_at', v_antes.paid_at, 'method', v_antes.method,
                             'reference', v_antes.reference, 'notes', v_antes.notes),
          jsonb_build_object('paid_at', v_despues.paid_at, 'method', v_despues.method,
                             'reference', v_despues.reference, 'notes', v_despues.notes),
          nullif(trim(_reason), ''));

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.update_payment(uuid, date, text, text, text, text) from public, anon;
grant execute on function public.update_payment(uuid, date, text, text, text, text) to authenticated;
