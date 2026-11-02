-- OSAKA Y LAMAR A 60 DÍAS · EDITAR NOTAS DE CRÉDITO
--
-- 1 · OSAKA y LAMAR cobran a 60 días. Igual que Bistro (ver
--     `bistro_plazo_30_dias`): se les pone `plazo_fijo`, así el vencimiento de
--     cada factura es SIEMPRE emisión + 60, diga lo que diga Bsale, y todo lo que
--     cuelga del vencimiento —vencido, días de atraso, Cobranza— sale bien.
--     Solo estos dos clientes: el resto queda como está.
--
-- 2 · Recalcular vencimientos ya no toca las notas de crédito. El recálculo
--     de Bistro pasaba también por las notas, y `recalc_receivable` les ponía
--     `amount_paid` en cero: una nota no tiene imputaciones encima, lo aplicado
--     lo escribe `aplicar_notas_credito` (o vino de la planilla). Con eso la nota
--     volvía a figurar como saldo a favor aunque ya estuviera descontada: la
--     misma plata contada dos veces. Ahora el recálculo deja las notas como están.
--
-- 3 · Editar una nota de crédito. La aplicación era solo automática (según el
--     XML del DTE) y no había cómo corregirla: si iba a la factura equivocada, o
--     por otro monto, o no tenía que aplicarse, no quedaba otra que pedirlo por
--     fuera. Ahora se puede decidir a mano a qué factura(s) y por cuánto se
--     aplica, o dejarla como saldo a favor; la nota editada queda marcada para que
--     la aplicación automática no la vuelva a tocar. Se puede devolver al
--     automático cuando se quiera.

-- ---------- 2 · EL RECÁLCULO NO TOCA LAS NOTAS ----------
create or replace function public.recalc_receivable(_kind text, _id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_total numeric; v_paid numeric; v_due date; v_forzado public.payment_status;
        v_tipo public.doc_type;
begin
  if _id is null then return; end if;

  if _kind = 'factura' then
    select total, due_date, estado_forzado, doc_type
      into v_total, v_due, v_forzado, v_tipo
      from public.invoices where id = _id;

    -- Lo aplicado de una nota no sale de imputaciones: no se toca.
    if v_tipo = 'nota_credito' then return; end if;

    select coalesce(sum(amount),0) into v_paid
      from public.payment_allocations where invoice_id = _id;

    update public.invoices set
      amount_paid = v_paid,
      payment_status = coalesce(v_forzado, (case
        when v_total > 0 and v_paid >= v_total then 'pagado'
        when v_total < 0 and v_paid >= abs(v_total) then 'pagado'
        when v_paid > 0 then 'parcial'
        when v_due is not null and v_due < current_date then 'vencido'
        else 'pendiente' end)::public.payment_status)
    where id = _id;

  elsif _kind = 'pedido' then
    select total, due_date into v_total, v_due from public.orders where id = _id;
    select coalesce(sum(amount),0) into v_paid
      from public.payment_allocations where order_id = _id;
    update public.orders set
      amount_paid = v_paid,
      payment_status = (case
        when v_total > 0 and v_paid >= v_total then 'pagado'
        when v_paid > 0 then 'parcial'
        when v_due is not null and v_due < current_date then 'vencido'
        else 'pendiente' end)::public.payment_status
    where id = _id;

  elsif _kind = 'saldo_inicial' then
    select coalesce(sum(amount),0) into v_paid
      from public.payment_allocations where opening_receivable_id = _id;
    update public.opening_receivables set amount_paid = v_paid where id = _id;
  end if;
end $function$;

-- ---------- 1 · OSAKA Y LAMAR A 60 DÍAS ----------
-- Por nombre exacto: en la base son 'OSAKA' y 'LA MAR' (un '%lamar%' suelto
-- agarraría también "Calamares").
do $$
declare r record;
begin
  for r in
    select id, name, payment_terms_days, plazo_fijo from public.customers
     where upper(trim(name)) in ('OSAKA', 'LA MAR')
  loop
    raise notice 'A 60 dias: % (plazo % -> 60, plazo_fijo % -> true)',
      r.name, r.payment_terms_days, r.plazo_fijo;
  end loop;
end $$;

-- El trigger `customers_plazo_recalcula` recalcula sus facturas al cambiar el
-- plazo o la marca.
update public.customers
   set payment_terms_days = 60, plazo_fijo = true
 where upper(trim(name)) in ('OSAKA', 'LA MAR');

-- Por si alguno ya estaba en 60 y marcado (el trigger no corre si no cambió nada).
select public.recalcular_vencimientos_cliente(id)
  from public.customers
 where upper(trim(name)) in ('OSAKA', 'LA MAR');

-- ---------- 3 · EDITAR UNA NOTA DE CRÉDITO ----------
alter table public.invoices
  add column if not exists nc_manual boolean not null default false;
comment on column public.invoices.nc_manual is
  'Nota de crédito cuya aplicación se decidió a mano: aplicar_notas_credito no la toca.';

-- La aplicación automática se salta las notas editadas a mano. Es la misma
-- función de `notas_credito`; solo cambia el `and not i.nc_manual`.
create or replace function public.aplicar_notas_credito(_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  n record; v_aplica numeric; v_pago uuid;
  v_vinculadas int := 0; v_aplicadas int := 0; v_monto numeric := 0;
  v_sin_ref int := 0; v_sin_factura int := 0; v_a_favor numeric := 0;
  v_detalle jsonb := '[]'::jsonb;
begin
  if not (public.puede_importar() or public.has_perm('invoices','update')) then
    raise exception 'Sin permiso para aplicar notas de credito';
  end if;

  for n in
    select i.id, i.doc_number, i.customer_id, abs(i.total) as monto, i.issued_at,
           coalesce(s.ref_folio, i.related_doc_number) as folio,
           s.ref_codigo, s.ref_razon, i.amount_paid,
           f.id as factura_id, (f.total - f.amount_paid) as saldo_factura
      from public.invoices i
      left join public.bsale_sales_documents s
        on s.code_sii = 61 and s.number::text = i.doc_number
      left join public.invoices f
        on f.doc_type = 'factura'
       and f.doc_number = coalesce(s.ref_folio, i.related_doc_number)
       and f.customer_id = i.customer_id
     where i.doc_type = 'nota_credito'
       and not i.nc_manual
       and i.amount_paid < abs(i.total)
     order by i.doc_number
  loop
    if n.folio is null then
      v_sin_ref := v_sin_ref + 1;
      continue;
    end if;

    if not _dry_run then
      update public.invoices set related_doc_number = n.folio
       where id = n.id and related_doc_number is distinct from n.folio;
    end if;

    if n.factura_id is null then
      v_sin_factura := v_sin_factura + 1;
      v_detalle := v_detalle || jsonb_build_object(
        'nota', n.doc_number, 'apunta_a', n.folio, 'estado', 'la factura no esta cargada');
      continue;
    end if;

    v_vinculadas := v_vinculadas + 1;
    v_aplica := least(n.monto - n.amount_paid, greatest(n.saldo_factura, 0));

    if v_aplica <= 0 then
      v_a_favor := v_a_favor + (n.monto - n.amount_paid);
      v_detalle := v_detalle || jsonb_build_object(
        'nota', n.doc_number, 'apunta_a', n.folio,
        'estado', 'la factura ya no tiene saldo; queda a favor del cliente',
        'monto', n.monto - n.amount_paid);
      continue;
    end if;

    v_detalle := v_detalle || jsonb_build_object(
      'nota', n.doc_number, 'apunta_a', n.folio, 'motivo', n.ref_razon,
      'codigo', n.ref_codigo, 'descuenta', v_aplica);

    if not _dry_run then
      insert into public.payments (direction, customer_id, amount, method, paid_at, reference, notes)
      values ('cobro', n.customer_id, v_aplica, 'nota_credito',
              (n.issued_at::text || ' 12:00:00')::timestamptz,
              'NC ' || n.doc_number,
              'Nota de crédito ' || n.doc_number || ' aplicada a la factura ' || n.folio)
      returning id into v_pago;

      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (v_pago, n.factura_id, v_aplica);

      update public.invoices
         set amount_paid = amount_paid + v_aplica,
             payment_status = case when amount_paid + v_aplica >= abs(total)
                                   then 'pagado' else 'parcial' end::public.payment_status
       where id = n.id;
    end if;

    v_aplicadas := v_aplicadas + 1;
    v_monto := v_monto + v_aplica;
  end loop;

  return jsonb_build_object(
    'dry_run', _dry_run,
    'notas_con_factura', v_vinculadas,
    'aplicadas', v_aplicadas,
    'monto_aplicado', v_monto,
    'sin_referencia_en_el_xml', v_sin_ref,
    'referencian_una_factura_que_no_esta', v_sin_factura,
    'quedan_a_favor_del_cliente', v_a_favor,
    'detalle', v_detalle);
end $$;

-- A qué facturas se aplicó cada nota, para mostrarlo y editarlo.
create or replace view public.v_aplicaciones_nota_credito with (security_invoker = on) as
 select n.id           as nota_id,
        p.id           as payment_id,
        a.id           as allocation_id,
        a.invoice_id,
        f.doc_number   as factura,
        f.issued_at    as factura_emitida,
        a.amount       as monto
   from public.invoices n
   join public.payments p
     on p.direction = 'cobro' and p.method = 'nota_credito'
    and p.customer_id = n.customer_id and p.reference = 'NC ' || n.doc_number
   join public.payment_allocations a on a.payment_id = p.id
   left join public.invoices f on f.id = a.invoice_id
  where n.doc_type = 'nota_credito';

-- _aplicaciones: [{"invoice_id": "uuid", "monto": 12345}, ...]. Vacío deja la
-- nota entera como saldo a favor del cliente. Con _automatico la nota vuelve a
-- la aplicación automática (según el XML) y _aplicaciones se ignora.
create or replace function public.editar_nota_credito(
  _nota_id      uuid,
  _aplicaciones jsonb,
  _motivo       text,
  _automatico   boolean default false
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_nota public.invoices; v_ref text; v_antes jsonb; v_despues jsonb;
  x record; v_f public.invoices; v_total numeric := 0; v_pago uuid; v_primera text;
begin
  if not (public.is_admin() or public.has_perm('invoices','update')) then
    raise exception 'Sin permiso para editar notas de credito';
  end if;
  if _motivo is null or length(trim(_motivo)) < 3 then
    raise exception 'Hay que decir por que se edita la nota';
  end if;

  select * into v_nota from public.invoices where id = _nota_id for update;
  if not found or v_nota.doc_type <> 'nota_credito' then
    raise exception 'Esa nota de credito no existe';
  end if;
  v_ref := 'NC ' || v_nota.doc_number;

  select coalesce(jsonb_agg(jsonb_build_object('factura', a.factura, 'monto', a.monto)), '[]'::jsonb)
    into v_antes from public.v_aplicaciones_nota_credito a where a.nota_id = _nota_id;

  -- Se borra lo aplicado y se vuelve a armar. El trigger de las imputaciones
  -- recalcula las facturas que cubrían.
  delete from public.payment_allocations a
   using public.payments p
   where a.payment_id = p.id and p.direction = 'cobro' and p.method = 'nota_credito'
     and p.customer_id = v_nota.customer_id and p.reference = v_ref;
  delete from public.payments
   where direction = 'cobro' and method = 'nota_credito'
     and customer_id = v_nota.customer_id and reference = v_ref;

  if _automatico then
    -- Parte de cero: la aplicación automática la vuelve a descontar de la
    -- factura que referencia, hasta el saldo que esa factura tenga.
    update public.invoices
       set nc_manual = false, amount_paid = 0, payment_status = 'pendiente'
     where id = _nota_id;
    perform public.aplicar_notas_credito(false);
  else
    update public.invoices set nc_manual = true where id = _nota_id;

    for x in
      select (e->>'invoice_id')::uuid as invoice_id, round((e->>'monto')::numeric) as monto
        from jsonb_array_elements(coalesce(_aplicaciones, '[]'::jsonb)) e
    loop
      continue when x.monto is null or x.monto <= 0;

      select * into v_f from public.invoices where id = x.invoice_id for update;
      if not found or v_f.doc_type = 'nota_credito' then
        raise exception 'La factura elegida no existe';
      end if;
      if v_f.customer_id <> v_nota.customer_id then
        raise exception 'La factura % es de otro cliente', v_f.doc_number;
      end if;
      if x.monto > v_f.total - v_f.amount_paid then
        raise exception 'La factura % solo tiene % de saldo',
          v_f.doc_number, round(greatest(v_f.total - v_f.amount_paid, 0));
      end if;
      v_total := v_total + x.monto;
      if v_total > abs(v_nota.total) then
        raise exception 'La nota es por %; no se puede aplicar mas que eso', round(abs(v_nota.total));
      end if;

      insert into public.payments (direction, customer_id, amount, method, paid_at, reference, notes)
      values ('cobro', v_nota.customer_id, x.monto, 'nota_credito',
              (v_nota.issued_at::text || ' 12:00:00')::timestamptz, v_ref,
              'Nota de crédito ' || v_nota.doc_number || ' aplicada a mano a la factura '
                || v_f.doc_number || ': ' || trim(_motivo))
      returning id into v_pago;

      insert into public.payment_allocations (payment_id, invoice_id, amount)
      values (v_pago, x.invoice_id, x.monto);

      v_primera := coalesce(v_primera, v_f.doc_number);
    end loop;

    -- Lo aplicado de la nota es exactamente lo que se decidió acá.
    update public.invoices
       set amount_paid = v_total,
           payment_status = (case when v_total >= abs(total) then 'pagado'
                                  when v_total > 0 then 'parcial'
                                  else 'pendiente' end)::public.payment_status,
           related_doc_number = coalesce(v_primera, related_doc_number)
     where id = _nota_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('factura', a.factura, 'monto', a.monto)), '[]'::jsonb)
    into v_despues from public.v_aplicaciones_nota_credito a where a.nota_id = _nota_id;

  insert into public.audit_logs (user_id, action, table_name, record_id, before, after, reason)
  values (auth.uid(), 'EDITAR_NOTA_CREDITO', 'invoices', _nota_id::text,
          jsonb_build_object('aplicaciones', v_antes, 'aplicado', v_nota.amount_paid,
                             'manual', v_nota.nc_manual),
          jsonb_build_object('aplicaciones', v_despues, 'manual', not _automatico),
          _motivo);

  return (select jsonb_build_object('ok', true, 'nota', i.doc_number, 'aplicado', i.amount_paid,
                 'disponible', abs(i.total) - i.amount_paid, 'manual', i.nc_manual)
            from public.invoices i where i.id = _nota_id);
end $$;

revoke all on function public.editar_nota_credito(uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.editar_nota_credito(uuid, jsonb, text, boolean) to authenticated;
