-- ============================================================
-- JLIZ BUSINESS · FORZAR EL ESTADO TIENE QUE MOVER LA PLATA
--
-- Defecto de 20260827220000_corregir_factura.sql: `corregir_estado_factura`
-- cambiaba `payment_status` y nada más. Pero la deuda no se calcula del estado
-- sino del saldo —`v_cuentas_por_cobrar` filtra por `total - amount_paid > 0`—,
-- así que marcar una factura como "pendiente" mientras seguía teniendo su cobro
-- imputado la dejaba con saldo cero y no aparecía en cuentas por cobrar. La
-- etiqueta decía una cosa y la plata otra, y el botón parecía no funcionar.
--
-- Se arregla por los dos lados:
--   · forzar 'pendiente' o 'vencido' suelta las imputaciones, para que el saldo
--     diga lo mismo que la etiqueta
--   · forzar 'pagado' saca la factura de cuentas por cobrar aunque le quede
--     saldo, que es lo que quiso decir quien la marcó
--
-- El cobro soltado NO se borra: queda sin imputar. Es la verdad cuando alguien
-- dice "esto figura pagado pero no lo está" —el pago puede existir y estar mal
-- aplicado, o no existir— y aparece en la lista de pagos sin imputar para que
-- se resuelva con el dato a la vista.
--
-- Las notas de crédito no se sueltan: una factura anulada con nota lo está de
-- verdad, y desarmar eso rompería la contabilidad de la nota.
-- ============================================================

create or replace function public.corregir_estado_factura(
  _invoice_id uuid, _estado text, _motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_antes public.payment_status; v_num text;
  v_soltado numeric := 0; v_nc numeric := 0;
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

  -- "Pendiente" y "vencido" quieren decir que no entró plata por esta factura.
  if _estado in ('pendiente', 'vencido') then
    select coalesce(sum(a.amount), 0) into v_soltado
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id
     where a.invoice_id = _invoice_id and p.method <> 'nota_credito';

    select coalesce(sum(a.amount), 0) into v_nc
      from public.payment_allocations a
      join public.payments p on p.id = a.payment_id
     where a.invoice_id = _invoice_id and p.method = 'nota_credito';

    delete from public.payment_allocations a
     using public.payments p
     where p.id = a.payment_id
       and a.invoice_id = _invoice_id
       and p.method <> 'nota_credito';
  end if;

  perform public.recalc_receivable('factura', _invoice_id);

  insert into public.audit_logs (user_id, action, table_name, record_id, before, after, reason)
  values (auth.uid(), 'CORREGIR_ESTADO_FACTURA', 'invoices', _invoice_id::text,
          jsonb_build_object('estado', v_antes),
          jsonb_build_object('estado', _estado, 'forzado', _estado is not null,
                             'cobros_soltados', v_soltado), _motivo);

  return (select jsonb_build_object('ok', true, 'factura', i.doc_number,
                 'estado', i.payment_status, 'forzado', i.estado_forzado is not null,
                 'saldo', i.total - i.amount_paid,
                 'cobros_soltados', v_soltado,
                 'nota_credito_intacta', v_nc)
            from public.invoices i where i.id = _invoice_id);
end $$;

-- `v_cuentas_por_cobrar`: la rama de facturas suma
--   and i.estado_forzado is distinct from 'pagado'
-- El resto de la vista (pedidos y saldos iniciales) queda igual que en
-- `ar_vistas`; se repite entera porque `create or replace view` no deja
-- reescribir una sola rama de un UNION.
create or replace view public.v_cuentas_por_cobrar with (security_invoker = on) as
 SELECT 'factura'::text AS origen, i.id AS ref_id, NULL::uuid AS order_id,
    NULL::uuid AS receivable_id, i.id AS invoice_id, i.code,
    i.doc_type::text AS doc_type, i.doc_number, i.customer_id,
    c.name AS cliente, c.phone, c.whatsapp, c.email,
    i.issued_at, i.due_date, i.total, i.amount_paid,
    i.total - i.amount_paid AS saldo, i.doc_number AS invoice_number,
    GREATEST(CURRENT_DATE - i.due_date, 0) AS dias_atraso,
        CASE
            WHEN i.due_date IS NULL THEN 'sin_plazo'::text
            WHEN CURRENT_DATE <= i.due_date THEN 'al_dia'::text
            WHEN (CURRENT_DATE - i.due_date) <= 15 THEN 'atraso_leve'::text
            WHEN (CURRENT_DATE - i.due_date) <= 30 THEN 'atraso_medio'::text
            ELSE 'atraso_grave'::text
        END AS tramo
   FROM invoices i
     JOIN customers c ON c.id = i.customer_id
  WHERE (i.doc_type = ANY (ARRAY['factura'::doc_type, 'boleta'::doc_type, 'nota_debito'::doc_type]))
    AND (i.total - i.amount_paid) > 0::numeric
    AND i.estado_forzado IS DISTINCT FROM 'pagado'::payment_status
    AND i.issued_at >= analisis_desde()
UNION ALL
 SELECT 'pedido'::text AS origen, o.id AS ref_id, o.id AS order_id,
    NULL::uuid AS receivable_id, NULL::uuid AS invoice_id, o.code,
    'pedido'::text AS doc_type, o.invoice_number AS doc_number, o.customer_id,
    c.name AS cliente, c.phone, c.whatsapp, c.email,
    o.order_date::date AS issued_at, o.due_date, o.total, o.amount_paid,
    o.total - o.amount_paid AS saldo, o.invoice_number,
    GREATEST(CURRENT_DATE - o.due_date, 0) AS dias_atraso,
        CASE
            WHEN o.due_date IS NULL THEN 'sin_plazo'::text
            WHEN CURRENT_DATE <= o.due_date THEN 'al_dia'::text
            WHEN (CURRENT_DATE - o.due_date) <= 15 THEN 'atraso_leve'::text
            WHEN (CURRENT_DATE - o.due_date) <= 30 THEN 'atraso_medio'::text
            ELSE 'atraso_grave'::text
        END AS tramo
   FROM orders o
     JOIN customers c ON c.id = o.customer_id
  WHERE o.status <> 'cancelado'::order_status AND (o.total - o.amount_paid) > 0::numeric
    AND o.order_date::date >= analisis_desde()
    AND NOT (EXISTS (SELECT 1 FROM invoices i2 WHERE i2.order_id = o.id))
UNION ALL
 SELECT 'saldo_inicial'::text AS origen, r.id AS ref_id, NULL::uuid AS order_id,
    r.id AS receivable_id, NULL::uuid AS invoice_id, r.code,
    'saldo_inicial'::text AS doc_type, r.document_number AS doc_number, r.customer_id,
    COALESCE(c.name, r.customer_name) AS cliente, c.phone, c.whatsapp, c.email,
    r.issued_at, r.due_date, r.amount AS total, r.amount_paid,
    r.amount - r.amount_paid AS saldo, r.document_number AS invoice_number,
    GREATEST(CURRENT_DATE - r.due_date, 0) AS dias_atraso,
        CASE
            WHEN r.due_date IS NULL THEN 'sin_plazo'::text
            WHEN CURRENT_DATE <= r.due_date THEN 'al_dia'::text
            WHEN (CURRENT_DATE - r.due_date) <= 15 THEN 'atraso_leve'::text
            WHEN (CURRENT_DATE - r.due_date) <= 30 THEN 'atraso_medio'::text
            ELSE 'atraso_grave'::text
        END AS tramo
   FROM opening_receivables r
     LEFT JOIN customers c ON c.id = r.customer_id
  WHERE (r.amount - r.amount_paid) > 0::numeric
    AND COALESCE(r.issued_at, analisis_desde()) >= analisis_desde();

-- Caso que lo destapó: la factura 34859 de DO SUSHI ($287.671, emitida el 9 de
-- mayo) figuraba pagada con un cobro de la planilla vieja. Se marcó "pendiente"
-- y no aparecía por ningún lado. Con esto vuelve a cuentas por cobrar con 81
-- días de atraso, y su cobro queda sin imputar para revisarlo.
