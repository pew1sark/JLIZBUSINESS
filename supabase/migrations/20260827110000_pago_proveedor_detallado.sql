-- ---------- REGISTRAR UN PAGO A PROVEEDOR, CON DETALLE ----------
-- Antes solo aceptaba monto, método y referencia: la fecha quedaba en now(),
-- así que un pago hecho el viernes y cargado el lunes quedaba con la fecha
-- equivocada y descuadraba la cartola contra el banco.
--
-- Ojo: al agregar parámetros queda una sobrecarga y PostgREST responde
-- "Could not choose the best candidate function". Por eso se borra la versión
-- antigua de cinco argumentos.
drop function if exists public.register_payment_out(text, uuid, numeric, public.payment_method, text);

create or replace function public.register_payment_out(
  _origen    text,
  _ref_id    uuid,
  _amount    numeric,
  _method    public.payment_method default 'transferencia',
  _reference text default null,
  _paid_at   timestamptz default now(),
  _notes     text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_prov uuid; v_saldo numeric; v_id uuid;
begin
  if not (public.is_admin() or public.has_perm('payments','create')) then
    raise exception 'Sin permiso para registrar pagos';
  end if;
  if _amount <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;

  if _origen = 'compra' then
    select supplier_id, coalesce(gross_total, total) - amount_paid
      into v_prov, v_saldo
      from public.purchases where id = _ref_id;
    if v_prov is null then raise exception 'La compra no existe'; end if;
    if _amount > v_saldo + 0.5 then
      raise exception 'El pago (%) supera el saldo de la compra (%)', _amount, v_saldo;
    end if;
    insert into public.payments (direction, purchase_id, supplier_id, amount, method, paid_at, reference, notes, created_by)
    values ('pago', _ref_id, v_prov, _amount, _method, coalesce(_paid_at, now()), _reference, _notes, auth.uid())
    returning id into v_id;

  elsif _origen = 'saldo_inicial' then
    select supplier_id, amount - amount_paid into v_prov, v_saldo
      from public.opening_payables where id = _ref_id;
    if v_saldo is null then raise exception 'El saldo inicial no existe'; end if;
    if _amount > v_saldo + 0.5 then
      raise exception 'El pago (%) supera el saldo (%)', _amount, v_saldo;
    end if;
    insert into public.payments (direction, opening_payable_id, supplier_id, amount, method, paid_at, reference, notes, created_by)
    values ('pago', _ref_id, v_prov, _amount, _method, coalesce(_paid_at, now()), _reference, _notes, auth.uid())
    returning id into v_id;
  else
    raise exception 'Origen no válido';
  end if;

  return jsonb_build_object('ok', true, 'payment_id', v_id, 'saldo_restante', v_saldo - _amount);
end $$;

-- ---------- COMPRAS CON SU IVA Y SU DOCUMENTO ----------
-- Una fila por compra con el desglose tributario y el enlace al PDF y al XML
-- del documento en Bsale, para poder abrir la factura desde la pantalla.
drop view if exists public.v_compras_iva;
create view public.v_compras_iva as
  select
    p.id                    as purchase_id,
    p.code,
    p.purchase_date,
    to_char(p.purchase_date, 'YYYY-MM') as mes,
    p.supplier_id,
    coalesce(d.supplier_name, s.name)   as proveedor,
    s.rut                   as proveedor_rut,
    p.invoice_number,
    p.dte_type,
    case p.dte_type when 33 then 'Factura afecta'
                    when 34 then 'Factura exenta'
                    when 61 then 'Nota de crédito'
                    else 'Sin documento' end as dte_nombre,
    p.is_credit_note,
    p.total                 as neto_mercaderia,
    p.freight_cost, p.other_costs,
    p.net_amount            as neto_afecto,
    p.exempt_amount         as exento,
    p.tax_amount            as iva,
    coalesce(p.gross_total, p.total) as bruto,
    -- Lo que hay en la factura y NO es mercadería: peajes, combustible,
    -- servicios. Es costo del negocio, pero no costo del pescado.
    coalesce(p.net_amount, 0) + coalesce(p.exempt_amount, 0) - p.total as otros_conceptos,
    p.amount_paid,
    coalesce(p.gross_total, p.total) - p.amount_paid as saldo,
    p.payment_status::text  as payment_status,
    p.due_date,
    greatest(current_date - coalesce(p.due_date, p.purchase_date + coalesce(s.payment_terms_days, 0)), 0) as dias_atraso,
    p.document_url,
    d.url_pdf, d.url_xml,
    (p.net_amount is null)  as sin_desglose,
    (select max(pg.paid_at::date) from public.payments pg
      where pg.purchase_id = p.id and pg.direction = 'pago') as ultimo_pago
  from public.purchases p
  left join public.suppliers s on s.id = p.supplier_id
  left join public.bsale_third_party_documents d on d.bsale_id = p.bsale_document_id
  where p.status <> 'anulada';

alter view public.v_compras_iva set (security_invoker = on);
comment on view public.v_compras_iva is
  'Compras con el desglose tributario del SII (neto afecto, exento, IVA, bruto) y el enlace al PDF y XML del documento.';

-- ---------- LIBRO DE IVA DE COMPRAS, POR MES ----------
drop view if exists public.v_iva_compras_mes;
create view public.v_iva_compras_mes as
  select mes,
         count(*)                                        as documentos,
         count(*) filter (where dte_type = 33)           as afectas,
         count(*) filter (where dte_type = 34)           as exentas,
         count(*) filter (where dte_type = 61)           as notas_credito,
         count(*) filter (where sin_desglose)            as sin_desglose,
         sum(case when is_credit_note then -neto_afecto else neto_afecto end) as neto_afecto,
         sum(case when is_credit_note then -exento      else exento      end) as exento,
         sum(case when is_credit_note then -iva         else iva         end) as iva,
         sum(bruto)                                      as bruto,
         sum(case when is_credit_note then -neto_mercaderia else neto_mercaderia end) as mercaderia,
         sum(case when is_credit_note then -otros_conceptos else otros_conceptos end) as otros_conceptos,
         sum(saldo) filter (where not is_credit_note and saldo > 0) as por_pagar
    from public.v_compras_iva
   group by mes;

alter view public.v_iva_compras_mes set (security_invoker = on);
comment on view public.v_iva_compras_mes is
  'Libro de IVA de compras por mes: crédito fiscal, exentos y notas de crédito.';
