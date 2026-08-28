-- ============================================================
-- JLIZ BUSINESS · UN MISMO RUT CON DOS LOCALES
--
-- Comercial y Gastronómica Internacional factura sus dos restoranes —La Mar, en
-- Nueva Costanera 4076, y Panchita, en el 3979— con un solo RUT (77.391.310-2).
-- En Bsale son un único cliente, así que en el ERP quedaban mezclados: una sola
-- deuda, un solo comportamiento de pago, imposible saber cuál de los dos debe.
--
-- Lo que sí los distingue es la dirección que Bsale escribe en CADA DOCUMENTO
-- (`raw->>'address'`), que no es la de la ficha del cliente (esa es siempre la
-- de La Mar, y por eso la columna `client_address` del staging no sirve para
-- esto: la llena `coalesce(cliente.address, documento.address)`).
-- ============================================================

alter table public.customers
  add column if not exists bsale_direccion text;

comment on column public.customers.bsale_direccion is
  'Dirección con la que Bsale emite a este local. Solo hace falta cuando varios locales comparten RUT: es lo que decide a cuál va cada documento.';

create index if not exists customers_rut_norm_idx
  on public.customers ((regexp_replace(upper(rut), '[^0-9K]', '', 'g')));

-- ---------- A QUÉ LOCAL VA CADA DOCUMENTO ----------
-- El criterio, en orden:
--   1. la dirección que trae el documento (lo que de verdad separa los locales)
--   2. la dirección de la ficha del cliente en Bsale, para el documento que
--      llegue con una dirección que no reconocemos
--   3. la ficha más antigua, que es como se comportaba antes de todo esto
-- Sin el punto 2, un documento con dirección rara caía en la ficha más vieja,
-- que acá es el local chico: quedaría en Panchita una venta de La Mar.
create or replace function public.bsale_local_del_documento(
  _rut_norm text, _dir_documento text, _dir_ficha text)
returns uuid language sql stable set search_path to 'public' as $$
  select c.id
    from public.customers c
   where regexp_replace(upper(c.rut), '[^0-9K]', '', 'g') = _rut_norm
   order by (c.bsale_direccion is not null
             and lower(trim(c.bsale_direccion)) = lower(trim(coalesce(_dir_documento, '')))) desc,
            (c.bsale_direccion is not null
             and lower(trim(c.bsale_direccion)) = lower(trim(coalesce(_dir_ficha, '')))) desc,
            c.created_at
   limit 1;
$$;

comment on function public.bsale_local_del_documento is
  'A que ficha de cliente va un documento cuando varios locales comparten RUT. Decide la direccion que Bsale escribe en el documento.';

-- `bsale_apply_sales` cruzaba clientes solo por RUT. Con dos fichas bajo el
-- mismo RUT ese join devolvía DOS filas por documento y el `on conflict do
-- nothing` se quedaba con una cualquiera: la factura caía en un local o en el
-- otro según el orden que tocara, y la separación se deshacía sola cada 30
-- minutos. Ahora se resuelve a un solo cliente por documento.
-- (La definición completa y vigente vive acá; sustituye a la de
--  20260827161145_bsale_apply_sales.)
create or replace function public.bsale_apply_sales(
  _connection_id uuid default null::uuid, _dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_conn uuid; v_cli_nuevos int := 0; v_fact_nuevas int := 0;
  v_lineas int := 0; v_pend int := 0; v_omitidos int := 0; v_monto numeric := 0;
begin
  if not (public.puede_importar() or public.has_perm('invoices','create')) then
    raise exception 'Sin permiso para importar ventas';
  end if;

  select coalesce(_connection_id,
                  (select id from public.bsale_connections where status='activa' order by created_at limit 1))
    into v_conn;
  if v_conn is null then raise exception 'No hay conexion de Bsale activa'; end if;

  create temp table _v on commit drop as
  select d.*,
         case d.code_sii when 33 then 'factura'  when 34 then 'factura'
                         when 39 then 'boleta'   when 41 then 'boleta'
                         when 61 then 'nota_credito' when 56 then 'nota_debito' end as doc_type,
         regexp_replace(upper(d.client_code), '[^0-9K]', '', 'g') as rut_norm,
         -- La dirección del documento, no la de la ficha: es lo único que
         -- separa dos locales que comparten RUT.
         nullif(trim(d.raw->>'address'), '') as doc_direccion
    from public.bsale_sales_documents d
   where d.connection_id = v_conn
     and not d.canceled
     and d.code_sii in (33, 34, 39, 41, 56, 61)
     and coalesce(d.client_code, '') <> ''
     and not exists (
       select 1 from public.invoices i
        where i.doc_number = d.number::text
          and i.doc_type = (case d.code_sii when 33 then 'factura' when 34 then 'factura'
                                            when 39 then 'boleta'  when 41 then 'boleta'
                                            when 61 then 'nota_credito'
                                            when 56 then 'nota_debito' end)::public.doc_type);

  select count(*), coalesce(sum(total_amount), 0) into v_pend, v_monto from _v;

  select count(*) into v_omitidos
    from public.bsale_sales_documents d
   where d.connection_id = v_conn
     and (d.canceled or d.code_sii not in (33,34,39,41,56,61) or coalesce(d.client_code,'') = '');

  if _dry_run then
    return jsonb_build_object('dry_run', true, 'facturas_a_crear', v_pend, 'monto', v_monto,
      'clientes_a_crear', (select count(distinct v.rut_norm) from _v v
        where not exists (select 1 from public.customers c
          where regexp_replace(upper(c.rut), '[^0-9K]', '', 'g') = v.rut_norm)),
      'omitidos_no_tributarios_o_anulados', v_omitidos);
  end if;

  -- Clientes que todavía no existen. El nombre viene de Bsale; si más adelante
  -- alguien lo edita en el ERP, esto no lo vuelve a pisar. Un RUT nuevo entra
  -- como un solo cliente: separarlo en locales es una decisión de negocio que
  -- se toma después, a mano.
  with nuevos as (
    select distinct on (v.rut_norm) v.rut_norm, v.client_code, v.client_name,
           v.client_email, v.client_phone, v.client_address, v.client_comuna
      from _v v
     where not exists (select 1 from public.customers c
                        where regexp_replace(upper(c.rut), '[^0-9K]', '', 'g') = v.rut_norm)
     order by v.rut_norm, v.client_name
  ), ins as (
    insert into public.customers (name, rut, customer_type, payment_terms_days, status,
                                  email, phone, address, comuna, notes)
    select coalesce(nullif(trim(n.client_name), ''), n.client_code), n.client_code,
           'restaurante', 30, 'activo',
           nullif(trim(n.client_email), ''), nullif(trim(n.client_phone), ''),
           nullif(trim(n.client_address), ''), nullif(trim(n.client_comuna), ''),
           'Creado desde la sincronizacion de ventas de Bsale'
      from nuevos n
    returning 1
  ) select count(*) into v_cli_nuevos from ins;

  -- Un solo cliente por documento: el local que le corresponde.
  with ins as (
    insert into public.invoices (
      doc_type, doc_number, customer_id, issued_at, due_date,
      net_amount, tax_amount, total, source, related_doc_number, external_ref, notes)
    select v.doc_type::public.doc_type, v.number::text, c.id, v.emission_date,
           coalesce(v.expiration_date, v.emission_date + coalesce(c.payment_terms_days, 30)),
           case when v.code_sii = 61 then -coalesce(v.net_amount, 0) else coalesce(v.net_amount, 0) end
             + case when v.code_sii = 61 then -coalesce(v.exempt_amount, 0) else coalesce(v.exempt_amount, 0) end,
           case when v.code_sii = 61 then -coalesce(v.tax_amount, 0) else coalesce(v.tax_amount, 0) end,
           case when v.code_sii = 61 then -coalesce(v.total_amount, 0) else coalesce(v.total_amount, 0) end,
           'importado', v.reference_number, v.bsale_id::text,
           case when v.url_pdf is not null then 'PDF: ' || v.url_pdf end
      from _v v
      join public.customers c
        on c.id = public.bsale_local_del_documento(v.rut_norm, v.doc_direccion, v.client_address)
    on conflict (doc_type, doc_number) do nothing
    returning 1
  ) select count(*) into v_fact_nuevas from ins;

  with lin as (
    insert into public.invoice_items (
      invoice_id, line_no, product_id, sku, description, variant,
      quantity, unit_price_net, net_total, tax_total, gross_total)
    select i.id, it.line_no + 1, p.id, it.variant_code,
           coalesce(p.name, nullif(trim(it.variant_desc), ''), 'Sin detalle'),
           nullif(trim(it.variant_desc), ''),
           it.quantity, it.net_unit_value,
           case when v.code_sii = 61 then -it.net_amount   else it.net_amount   end,
           case when v.code_sii = 61 then -it.tax_amount   else it.tax_amount   end,
           case when v.code_sii = 61 then -it.total_amount else it.total_amount end
      from _v v
      join public.bsale_sales_items it
        on it.connection_id = v.connection_id and it.bsale_document_id = v.bsale_id
      join public.invoices i
        on i.doc_number = v.number::text and i.doc_type = v.doc_type::public.doc_type
      left join public.products p on p.sku = it.variant_code
     where not exists (select 1 from public.invoice_items x where x.invoice_id = i.id)
    returning 1
  ) select count(*) into v_lineas from lin;

  update public.bsale_sales_documents d set applied_at = now()
    from _v v where v.connection_id = d.connection_id and v.bsale_id = d.bsale_id;

  return jsonb_build_object('ok', true, 'clientes_creados', v_cli_nuevos,
    'facturas_creadas', v_fact_nuevas, 'lineas_creadas', v_lineas,
    'monto', v_monto, 'omitidos_no_tributarios_o_anulados', v_omitidos);
end $function$;

-- ---------- LA SEPARACIÓN ----------
-- El reparto se hizo documento por documento leyendo la dirección de cada uno.
-- Enero a mayo no estaba en el staging (la ventana de sincronización son dos
-- meses), así que esos 66 documentos se leyeron directo de la API de Bsale con
-- pg_net, sin volcarlos: traerlos al staging habría hecho que el volcado creara
-- facturas que hoy no existen y eso sí habría movido los números.
--
-- Los folios quedan escritos acá para que esto sea reproducible sin depender de
-- volver a llamar a la API.
--
-- Comprobado después de correrlo: los dos locales suman exactamente lo que
-- tenía la ficha única —117 documentos, $38.113.895 facturados, $24.935.831
-- cobrados, $13.178.064 de saldo— y ningún pago quedó imputado a la factura de
-- otro cliente.

update public.customers set
  name = 'La Mar',
  address = 'Nueva Costanera 4076',
  comuna = 'Vitacura',
  bsale_direccion = 'Nueva Costanera 4076',
  notes = coalesce(nullif(trim(notes), '') || E'\n', '')
          || 'Local de Comercial y Gastronómica Internacional S.P.A (RUT 77.391.310-2). '
          || 'Comparte RUT con Panchita, en Nueva Costanera 3979.'
 where id = '5fac489f-bea1-4003-9a25-37938d07ee75';

update public.customers set
  name = 'Panchita',
  rut = '77391310-2',
  address = 'Nueva Costanera 3979',
  comuna = 'Vitacura',
  bsale_direccion = 'Nueva Costanera 3979',
  customer_type = 'restaurante',
  payment_terms_days = 30,
  notes = coalesce(nullif(trim(notes), '') || E'\n', '')
          || 'Local de Comercial y Gastronómica Internacional S.P.A (RUT 77.391.310-2). '
          || 'Comparte RUT con La Mar, en Nueva Costanera 4076. Abrió el 19 de mayo de 2026.'
 where id = 'c8a8ede4-7577-4133-bcc2-c9323b736c11';

-- Las 25 facturas emitidas a Nueva Costanera 3979.
update public.invoices set customer_id = 'c8a8ede4-7577-4133-bcc2-c9323b736c11'
 where customer_id = '5fac489f-bea1-4003-9a25-37938d07ee75'
   and doc_type = 'factura'
   and doc_number in (
     '34934','34963','34986','34994','35012','35013','35027','35036','35045',
     '35057','35067','35098','35117','35153','35171','35187','35211','35288',
     '35467','35637','35649','35663','35720','35743','35758');

-- Los cobros siguen a sus facturas: ninguno cruzaba los dos locales, así que
-- cada pago se mueve entero con sus imputaciones intactas. Si el pago quedara
-- en un cliente y la factura que salda en otro, la cartola no cuadraría.
update public.payments p
   set customer_id = 'c8a8ede4-7577-4133-bcc2-c9323b736c11'
 where p.customer_id = '5fac489f-bea1-4003-9a25-37938d07ee75'
   and exists (
     select 1 from public.payment_allocations a
       join public.invoices i on i.id = a.invoice_id
      where a.payment_id = p.id
        and i.customer_id = 'c8a8ede4-7577-4133-bcc2-c9323b736c11');

-- `v_estado_cuenta_cliente` suma `direccion` al final: cuando dos locales
-- comparten RUT es lo único que los distingue de un vistazo, y ver el mismo
-- RUT dos veces sin más explicación parece un duplicado.
-- (Definición completa y vigente en 20260827200000_notas_credito.sql, más
--  esta columna.)
