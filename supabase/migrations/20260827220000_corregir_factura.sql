-- ============================================================
-- JLIZ BUSINESS · CORREGIR EL ESTADO DE UNA FACTURA
--
-- El estado sale solo de las imputaciones (`recalc_receivable`), que es lo
-- correcto casi siempre. Cuando no lo es —un cobro cargado a la factura
-- equivocada, una saldada por fuera del sistema, una cerrada por error— no
-- había arreglo desde la aplicación: la única herramienta era `void_payment`,
-- que borra el pago entero, y si ese pago cubría tres facturas se llevaba las
-- otras dos por delante.
--
-- Se agregan dos niveles, de menos a más invasivo:
--   1. corregir la imputación (lo normal: el monto estaba mal o iba a otra factura)
--   2. forzar el estado, dejando dicho por qué (lo excepcional)
-- ============================================================

alter table public.invoices
  add column if not exists estado_forzado public.payment_status,
  add column if not exists estado_forzado_motivo text,
  add column if not exists estado_forzado_por uuid references public.profiles(id),
  add column if not exists estado_forzado_at timestamptz;

comment on column public.invoices.estado_forzado is
  'Estado puesto a mano que le gana al calculado. Null = el estado sale de las imputaciones.';

-- El recálculo respeta el estado forzado. Sin esto, cualquier cambio en las
-- imputaciones —incluida la sincronización con Bsale, que corre cada 30 min—
-- pisaba la corrección al instante y parecía que no se había guardado.
create or replace function public.recalc_receivable(_kind text, _id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_total numeric; v_paid numeric; v_due date; v_forzado public.payment_status;
begin
  if _id is null then return; end if;

  if _kind = 'factura' then
    select total, due_date, estado_forzado into v_total, v_due, v_forzado
      from public.invoices where id = _id;
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

-- ---------- QUÉ PAGOS TIENE ENCIMA UNA FACTURA ----------
-- Para poder corregir hay que ver primero: qué cobro entró, cuándo, por cuánto
-- y cuánto de ese cobro se le imputó a esta factura en particular.
create or replace view public.v_imputaciones_factura with (security_invoker = on) as
 select a.id            as allocation_id,
        a.invoice_id,
        a.amount        as monto_imputado,
        p.id            as payment_id,
        p.code          as pago_code,
        p.paid_at::date as fecha_pago,
        p.method::text  as metodo,
        p.amount        as monto_pago,
        p.reference,
        p.notes,
        p.method = 'nota_credito'::public.payment_method as es_nota_credito,
        -- Cuánto de ese cobro quedó sin repartir: si se libera monto de esta
        -- factura, va a parar acá y se puede imputar a la que corresponda.
        p.amount - (select coalesce(sum(x.amount), 0)
                      from public.payment_allocations x where x.payment_id = p.id) as sin_imputar
   from public.payment_allocations a
   join public.payments p on p.id = a.payment_id
  where a.invoice_id is not null;

-- ---------- 1. CORREGIR UNA IMPUTACIÓN ----------
-- El caso normal: el cobro existe y entró de verdad, pero se le asignó a la
-- factura equivocada o por un monto que no era. Se toca solo el vínculo; el
-- pago queda intacto y lo liberado vuelve a estar disponible para imputar.
create or replace function public.corregir_imputacion(
  _allocation_id uuid, _monto numeric, _motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_inv uuid; v_pago uuid; v_antes numeric; v_libre numeric;
begin
  if not (public.is_admin() or public.has_perm('payments','update')) then
    raise exception 'Sin permiso para corregir cobros';
  end if;
  if _motivo is null or length(trim(_motivo)) < 3 then
    raise exception 'Hay que decir por que se corrige';
  end if;

  select invoice_id, payment_id, amount into v_inv, v_pago, v_antes
    from public.payment_allocations where id = _allocation_id;
  if v_inv is null then raise exception 'Esa imputacion no existe'; end if;

  if _monto is null or _monto <= 0 then
    delete from public.payment_allocations where id = _allocation_id;
  else
    -- No se puede imputar más de lo que el cobro trae.
    select p.amount - coalesce(sum(x.amount) filter (where x.id <> _allocation_id), 0)
      into v_libre
      from public.payments p
      left join public.payment_allocations x on x.payment_id = p.id
     where p.id = v_pago
     group by p.amount;
    if _monto > v_libre then
      raise exception 'El cobro solo tiene % disponible', round(v_libre);
    end if;
    update public.payment_allocations set amount = _monto where id = _allocation_id;
  end if;

  perform public.recalc_receivable('factura', v_inv);

  insert into public.audit_logs (user_id, action, table_name, record_id, before, after, reason)
  values (auth.uid(), 'CORREGIR_IMPUTACION', 'payment_allocations', _allocation_id::text,
          jsonb_build_object('monto', v_antes), jsonb_build_object('monto', coalesce(_monto, 0)), _motivo);

  return (select jsonb_build_object('ok', true, 'factura', i.doc_number,
                 'amount_paid', i.amount_paid, 'estado', i.payment_status)
            from public.invoices i where i.id = v_inv);
end $$;

-- ---------- 2. FORZAR EL ESTADO ----------
-- Lo excepcional: la factura se saldó por fuera del sistema, o quedó cerrada
-- por error y hay que reabrirla. Exige motivo y queda en la bitácora. Pasar
-- _estado en null devuelve la factura al cálculo automático.
create or replace function public.corregir_estado_factura(
  _invoice_id uuid, _estado text, _motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_antes public.payment_status; v_num text;
begin
  if not (public.is_admin() or public.has_perm('invoices','update')) then
    raise exception 'Sin permiso para corregir el estado de una factura';
  end if;
  if _motivo is null or length(trim(_motivo)) < 3 then
    raise exception 'Hay que decir por que se corrige el estado';
  end if;
  if _estado is not null and _estado not in ('pendiente','parcial','pagado','vencido') then
    raise exception 'Estado desconocido: %', _estado;
  end if;

  select payment_status, doc_number into v_antes, v_num
    from public.invoices where id = _invoice_id;
  if v_num is null then raise exception 'Esa factura no existe'; end if;

  update public.invoices
     set estado_forzado = _estado::public.payment_status,
         estado_forzado_motivo = case when _estado is null then null else _motivo end,
         estado_forzado_por    = case when _estado is null then null else auth.uid() end,
         estado_forzado_at     = case when _estado is null then null else now() end
   where id = _invoice_id;

  -- Recalcula: con estado forzado lo respeta, y sin él vuelve al automático.
  perform public.recalc_receivable('factura', _invoice_id);

  insert into public.audit_logs (user_id, action, table_name, record_id, before, after, reason)
  values (auth.uid(), 'CORREGIR_ESTADO_FACTURA', 'invoices', _invoice_id::text,
          jsonb_build_object('estado', v_antes),
          jsonb_build_object('estado', _estado, 'forzado', _estado is not null), _motivo);

  return (select jsonb_build_object('ok', true, 'factura', i.doc_number,
                 'estado', i.payment_status, 'forzado', i.estado_forzado is not null)
            from public.invoices i where i.id = _invoice_id);
end $$;

revoke all on function public.corregir_imputacion(uuid, numeric, text) from public, anon;
revoke all on function public.corregir_estado_factura(uuid, text, text) from public, anon;
grant execute on function public.corregir_imputacion(uuid, numeric, text) to authenticated;
grant execute on function public.corregir_estado_factura(uuid, text, text) to authenticated;

-- Un estado puesto a mano tiene que verse como tal, con su motivo: si no, en
-- tres meses nadie sabe por qué esta factura figura pagada sin pagos encima.
-- Se repite la vista completa porque `create or replace view` solo deja agregar
-- columnas al final, nunca reescribir la lista.
create or replace view public.v_facturas_con_pago with (security_invoker = on) as
 SELECT i.id AS invoice_id, i.code, i.doc_type::text AS doc_type, i.doc_number,
    i.customer_id, c.name AS cliente, c.rut, c.payment_terms_days,
    i.issued_at, i.due_date,
    to_char(i.issued_at::timestamp with time zone, 'YYYY-MM'::text) AS mes_emision,
    i.net_amount, i.tax_amount, i.total, i.amount_paid,
    i.total - i.amount_paid AS saldo, i.payment_status::text AS payment_status,
    p.primer_pago, p.ultimo_pago,
    to_char(p.ultimo_pago::timestamp with time zone, 'YYYY-MM'::text) AS mes_pago,
    COALESCE(p.n_pagos, 0::bigint) AS n_pagos, p.metodos, p.referencias,
        CASE WHEN i.payment_status = 'pagado'::payment_status AND p.ultimo_pago IS NOT NULL
             THEN p.ultimo_pago - i.issued_at ELSE NULL::integer END AS dias_en_pagar,
        CASE WHEN i.payment_status = 'pagado'::payment_status AND p.ultimo_pago IS NOT NULL
              AND i.due_date IS NOT NULL THEN p.ultimo_pago - i.due_date
             ELSE NULL::integer END AS dias_vs_plazo,
        CASE WHEN i.payment_status <> 'pagado'::payment_status
             THEN GREATEST(CURRENT_DATE - i.issued_at, 0) ELSE NULL::integer END AS dias_esperando,
        CASE WHEN i.payment_status <> 'pagado'::payment_status AND i.due_date IS NOT NULL
             THEN GREATEST(CURRENT_DATE - i.due_date, 0) ELSE NULL::integer END AS dias_atraso,
    COALESCE(nc.monto, 0::numeric) AS nota_credito_aplicada,
    (COALESCE(nc.monto, 0::numeric) > 0 AND p.ultimo_pago IS NULL) AS saldada_con_nota,
    nc.notas AS notas_credito,
    (i.estado_forzado IS NOT NULL) AS estado_corregido,
    i.estado_forzado_motivo, i.estado_forzado_at
   FROM invoices i
     JOIN customers c ON c.id = i.customer_id
     LEFT JOIN LATERAL ( SELECT min(pg.paid_at::date) AS primer_pago,
            max(pg.paid_at::date) AS ultimo_pago, count(*) AS n_pagos,
            string_agg(DISTINCT pg.method::text, ', '::text) AS metodos,
            string_agg(DISTINCT pg.reference, ', '::text) AS referencias
           FROM payment_allocations a JOIN payments pg ON pg.id = a.payment_id
          WHERE a.invoice_id = i.id
            AND pg.method <> 'nota_credito'::public.payment_method) p ON true
     LEFT JOIN LATERAL ( SELECT sum(a.amount) AS monto,
            string_agg(DISTINCT pg.reference, ', '::text) AS notas
           FROM payment_allocations a JOIN payments pg ON pg.id = a.payment_id
          WHERE a.invoice_id = i.id
            AND pg.method = 'nota_credito'::public.payment_method) nc ON true;
