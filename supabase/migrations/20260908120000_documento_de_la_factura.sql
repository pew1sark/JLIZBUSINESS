-- LA FACTURA SE ABRE DESDE LA TABLA DE VENTAS
--
-- En Ventas se ve el folio, el cliente y los montos, pero para mirar el
-- documento —el timbre, el detalle tal como lo recibió el cliente, la
-- dirección de despacho— había que salir a Bsale, buscarlo por número y
-- volver. El dato ya estaba en la casa: la sincronización guarda `url_pdf`
-- en el staging y hasta ahora lo dejaba escrito dentro de `invoices.notes`
-- como el texto «PDF: https://…», donde ninguna pantalla lo lee y las notas
-- que sí dicen algo («Aplicada a la factura 35087») quedaban mezcladas con
-- una URL.
--
-- Del lado de compras esto ya está resuelto y desde hace tiempo: la compra
-- guarda `purchases.document_url` y Finanzas y Gastos muestran el ícono que
-- lo abre. Esta migración le da a la venta la misma columna, con el mismo
-- nombre, para que el ícono de la factura signifique lo mismo en las dos
-- puntas del negocio.
--
-- Cobertura: de los 1.957 documentos cargados, los 844 que vinieron de Bsale
-- (junio en adelante) quedan con enlace. Los de enero a mayo se cargaron
-- desde la planilla de ventas, que trae montos y no documentos: para esos no
-- hay PDF en ninguna parte y la tabla simplemente no muestra el ícono.

alter table public.invoices add column if not exists document_url text;
comment on column public.invoices.document_url is
  'Enlace al documento tributario emitido (el PDF de Bsale). Equivale a purchases.document_url del lado de compras. Nulo en lo cargado desde la planilla de ventas, que no trae documento.';

-- ---------- LO YA CARGADO ----------
-- El staging calza por tipo + número, que es la misma llave con la que
-- `bsale_apply_sales` decide si un documento ya está en el ERP. El `distinct
-- on` es por prudencia: hoy hay un solo documento por llave, pero una
-- reconexión de Bsale dejaría dos filas de staging para el mismo folio y un
-- update con dos candidatos no es determinista.
with pdf as (
  select distinct on (doc_type, doc_number) doc_type, doc_number, url_pdf
    from (
      select case d.code_sii when 33 then 'factura'  when 34 then 'factura'
                             when 39 then 'boleta'   when 41 then 'boleta'
                             when 61 then 'nota_credito' when 56 then 'nota_debito' end as doc_type,
             d.number::text as doc_number, d.url_pdf, d.synced_at
        from public.bsale_sales_documents d
       where d.url_pdf is not null
         and d.code_sii in (33, 34, 39, 41, 56, 61)
    ) x
   where doc_type is not null
   order by doc_type, doc_number, synced_at desc
)
update public.invoices i
   set document_url = pdf.url_pdf
  from pdf
 where i.document_url is null
   and i.doc_number = pdf.doc_number
   and i.doc_type::text = pdf.doc_type;

-- Los 98 documentos que traen la URL en la nota y ya no están en el staging
-- (o que quedaron de una sincronización anterior): se lee de ahí.
update public.invoices
   set document_url = trim(substring(notes from 6))
 where document_url is null
   and notes like 'PDF: http%';

-- Y la nota que era solo la URL deja de serlo: el dato vive en su columna y
-- repetirlo en un campo de texto libre es una copia que se desactualiza.
update public.invoices
   set notes = null
 where document_url is not null
   and notes = 'PDF: ' || document_url;

-- ---------- LO QUE ENTRE DE AQUÍ EN ADELANTE ----------
-- Dos cambios sobre la función que vuelca las ventas de Bsale: la factura
-- nueva guarda el enlace en su columna en vez de en la nota, y las que ya
-- estaban cargadas sin enlace lo reciben. Lo segundo importa porque un
-- documento puede haber entrado antes por la planilla y aparecer después en
-- el staging: sin ese repaso se quedaría sin PDF para siempre.
--
-- Sigue sin tocar `amount_paid` ni `payment_status` de nada ya cargado, que
-- es el contrato de esta función: esos los mantiene `recalc_receivable`
-- desde las imputaciones.
create or replace function public.bsale_apply_sales(
  _connection_id uuid default null,
  _dry_run       boolean default true
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_conn uuid; v_cli_nuevos int := 0; v_fact_nuevas int := 0;
  v_lineas int := 0; v_pend int := 0; v_omitidos int := 0; v_monto numeric := 0;
  v_enlaces int := 0;
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

  -- Un solo cliente por documento: el local que le corresponde. Antes el join
  -- por RUT devolvía una fila por local y la factura caía en cualquiera.
  with ins as (
    insert into public.invoices (
      doc_type, doc_number, customer_id, issued_at, due_date,
      net_amount, tax_amount, total, source, related_doc_number, external_ref, document_url)
    select v.doc_type::public.doc_type, v.number::text, c.id, v.emission_date,
           coalesce(v.expiration_date, v.emission_date + coalesce(c.payment_terms_days, 30)),
           case when v.code_sii = 61 then -coalesce(v.net_amount, 0) else coalesce(v.net_amount, 0) end
             + case when v.code_sii = 61 then -coalesce(v.exempt_amount, 0) else coalesce(v.exempt_amount, 0) end,
           case when v.code_sii = 61 then -coalesce(v.tax_amount, 0) else coalesce(v.tax_amount, 0) end,
           case when v.code_sii = 61 then -coalesce(v.total_amount, 0) else coalesce(v.total_amount, 0) end,
           'importado', v.reference_number, v.bsale_id::text, v.url_pdf
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

  -- El enlace de las que ya estaban cargadas sin él. Recorre el staging
  -- completo de la conexión, no solo lo pendiente de volcar: lo que entró por
  -- la planilla nunca pasa por `_v`.
  with pdf as (
    select distinct on (doc_type, doc_number) doc_type, doc_number, url_pdf
      from (
        select case d.code_sii when 33 then 'factura'  when 34 then 'factura'
                               when 39 then 'boleta'   when 41 then 'boleta'
                               when 61 then 'nota_credito' when 56 then 'nota_debito' end as doc_type,
               d.number::text as doc_number, d.url_pdf, d.synced_at
          from public.bsale_sales_documents d
         where d.connection_id = v_conn and d.url_pdf is not null
           and d.code_sii in (33, 34, 39, 41, 56, 61)
      ) x
     where doc_type is not null
     order by doc_type, doc_number, synced_at desc
  ), upd as (
    update public.invoices i set document_url = pdf.url_pdf
      from pdf
     where i.document_url is null
       and i.doc_number = pdf.doc_number
       and i.doc_type::text = pdf.doc_type
    returning 1
  ) select count(*) into v_enlaces from upd;

  update public.bsale_sales_documents d set applied_at = now()
    from _v v where v.connection_id = d.connection_id and v.bsale_id = d.bsale_id;

  return jsonb_build_object('ok', true, 'clientes_creados', v_cli_nuevos,
    'facturas_creadas', v_fact_nuevas, 'lineas_creadas', v_lineas,
    'enlaces_repuestos', v_enlaces,
    'monto', v_monto, 'omitidos_no_tributarios_o_anulados', v_omitidos);
end $$;

comment on function public.bsale_apply_sales is
  'Vuelca los documentos de venta de Bsale al ERP. Idempotente por tipo + numero; guarda el enlace al PDF en invoices.document_url y no toca el estado de pago de lo ya cargado.';

-- ---------- LA VISTA ----------
-- `v_facturas_con_pago` alimenta el detalle que se abre desde Ventas y desde
-- Cobranza, así que el enlace tiene que llegar por ahí. La columna va al
-- final, que es lo único que permite `create or replace view`; por eso la
-- vista se repite entera aunque el cambio sea una columna.
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
    (COALESCE(nc.monto, 0::numeric) > 0::numeric AND p.ultimo_pago IS NULL) AS saldada_con_nota,
    nc.notas AS notas_credito,
    (i.estado_forzado IS NOT NULL) AS estado_corregido,
    i.estado_forzado_motivo, i.estado_forzado_at,
    c.company AS razon_social, i.etiqueta, i.etiqueta_nota,
    i.document_url
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
