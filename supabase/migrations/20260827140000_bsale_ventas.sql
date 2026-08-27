-- ============================================================
-- JLIZ BUSINESS · VENTAS DESDE BSALE
--
-- Hasta ahora la sincronización solo traía compras: los documentos emitidos
-- entraban a mano, con el export "Mis ventas". Eso dejaba la cobranza mirando
-- datos de ayer.
--
-- El camino es el mismo que ya funciona para compras: una tabla de staging con
-- lo que devuelve la API tal cual, y una función que la vuelca al ERP. Así el
-- volcado se puede repetir sin volver a pedirle nada a Bsale, y si algo se
-- mapea mal se corrige y se re-vuelca.
--
-- Contrato de /documents.json (verificado contra la API, no supuesto):
--   number, emissionDate y expirationDate en unix; netAmount, exemptAmount,
--   taxAmount, totalAmount; client expandido trae `code` con el RUT;
--   document_type expandido trae `codeSii`; details trae las líneas con
--   variant.code, que calza con products.sku.
-- ============================================================

create table if not exists public.bsale_sales_documents (
  connection_id   uuid not null references public.bsale_connections(id) on delete cascade,
  bsale_id        bigint not null,
  number          bigint,
  code_sii        int,                    -- 33 factura, 34 exenta, 61 NC, 56 ND, 39/41 boleta
  type_name       text,
  is_credit_note  boolean not null default false,
  emission_date   date,
  expiration_date date,
  client_code     text,                   -- el RUT
  client_name     text,
  client_email    text,
  client_phone    text,
  client_address  text,
  client_comuna   text,
  net_amount      numeric(14,2),
  exempt_amount   numeric(14,2),
  tax_amount      numeric(14,2),
  total_amount    numeric(14,2),
  canceled        boolean not null default false,
  url_pdf         text,
  url_xml         text,
  reference_number text,                  -- para la NC: a qué documento apunta
  details_count   int,
  raw             jsonb not null,
  synced_at       timestamptz not null default now(),
  applied_at      timestamptz,
  primary key (connection_id, bsale_id)
);
comment on table public.bsale_sales_documents is
  'Documentos de venta emitidos, tal como los devuelve Bsale. Staging previo al volcado a invoices.';

create index if not exists bsale_sales_fecha_idx on public.bsale_sales_documents (emission_date desc);
create index if not exists bsale_sales_pend_idx  on public.bsale_sales_documents (applied_at) where applied_at is null;

create table if not exists public.bsale_sales_items (
  connection_id     uuid not null references public.bsale_connections(id) on delete cascade,
  bsale_document_id bigint not null,
  line_no           int not null,
  variant_code      text,                 -- calza con products.sku
  variant_desc      text,
  quantity          numeric(12,3),
  net_unit_value    numeric(14,4),
  net_amount        numeric(14,2),
  tax_amount        numeric(14,2),
  total_amount      numeric(14,2),
  note              text,
  synced_at         timestamptz not null default now(),
  primary key (connection_id, bsale_document_id, line_no)
);
comment on table public.bsale_sales_items is
  'Líneas de los documentos de venta de Bsale. El código de variante calza con products.sku.';

alter table public.bsale_sales_documents enable row level security;
alter table public.bsale_sales_items     enable row level security;

drop policy if exists bsale_sales_docs_read  on public.bsale_sales_documents;
drop policy if exists bsale_sales_items_read on public.bsale_sales_items;
create policy bsale_sales_docs_read on public.bsale_sales_documents for select
  using (public.has_perm('invoices','read') or public.is_admin());
create policy bsale_sales_items_read on public.bsale_sales_items for select
  using (public.has_perm('invoices','read') or public.is_admin());

-- ---------- VOLCADO AL ERP ----------
-- Crea clientes que falten, inserta las facturas nuevas con su detalle y deja
-- en paz las que ya existen.
--
-- NUNCA toca amount_paid ni payment_status de una factura ya cargada: esos
-- valores los mantiene recalc_receivable desde las imputaciones, y pisarlos
-- borraría la cobranza registrada a mano.
create or replace function public.bsale_apply_sales(
  _connection_id uuid default null,
  _dry_run       boolean default true
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
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

  -- Lo que se puede volcar: documento tributario, no anulado, con RUT y con
  -- un tipo que sepamos mapear. La nota de venta, la cotización y la guía de
  -- despacho no son ventas facturadas y quedan fuera a propósito.
  create temp table _v on commit drop as
  select d.*,
         case d.code_sii when 33 then 'factura'  when 34 then 'factura'
                         when 39 then 'boleta'   when 41 then 'boleta'
                         when 61 then 'nota_credito' when 56 then 'nota_debito' end as doc_type,
         regexp_replace(upper(d.client_code), '[^0-9K]', '', 'g') as rut_norm
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
  -- alguien lo edita en el ERP, esto no lo vuelve a pisar.
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

  -- Las facturas. La nota de crédito entra con total negativo, que es la
  -- convención del resto del sistema.
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
        on regexp_replace(upper(c.rut), '[^0-9K]', '', 'g') = v.rut_norm
    on conflict (doc_type, doc_number) do nothing
    returning 1
  ) select count(*) into v_fact_nuevas from ins;

  -- El detalle, solo para las facturas que acaban de entrar y que todavía no
  -- tienen líneas. El nombre del producto sale del SKU, porque la API entrega
  -- la variante con su código de barra pero sin el nombre.
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
end $$;

comment on function public.bsale_apply_sales is
  'Vuelca los documentos de venta de Bsale al ERP. Idempotente por tipo + número; no toca el estado de pago de lo ya cargado.';
