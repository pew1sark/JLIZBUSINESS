-- ============================================================
-- JLIZ BUSINESS · NOTAS DE CRÉDITO QUE NO ESTORBAN
--
-- Consolida las migraciones aplicadas al proyecto entre
-- `notas_credito_referencia_y_aplicacion` y `cron_aplica_notas_credito`.
-- El historial exacto vive en `supabase_migrations.schema_migrations`.
--
-- Una nota de crédito anula o corrige una factura. Sin vincular y sin aplicar,
-- pasan dos cosas a la vez y las dos mienten: la factura anulada sigue
-- figurando como deuda, y la nota aparece como saldo a favor del cliente. La
-- misma plata contada dos veces, en direcciones opuestas.
--
-- Y hay una segunda forma de estorbar, más silenciosa: al saldar la factura, la
-- nota se registraba como si fuera un cobro. Eso inflaba lo recaudado del mes y,
-- como la nota se emite casi siempre el mismo día de la factura, hacía aparecer
-- a los clientes pagando en cero días. El informe de "cuánto se demora en pagar
-- cada cliente" salía optimista por documentos que nadie pagó.
-- ============================================================

-- ---------- 1. DE DÓNDE SALE EL VÍNCULO ----------
-- La API de Bsale devuelve `references: {count: 0}` en todas las notas de
-- crédito, así que el vínculo no viene por ahí. Sí viene en el XML del DTE, que
-- es el documento legal: el bloque <Referencia> trae <FolioRef> con la factura
-- y <CodRef> con qué le hace (1 anula, 2 corrige el texto, 3 corrige montos).
alter table public.bsale_sales_documents
  add column if not exists ref_tipo   int,     -- TpoDocRef: 33 factura, 34 exenta…
  add column if not exists ref_folio  text,    -- FolioRef: el número de la factura
  add column if not exists ref_codigo int,     -- CodRef: 1 anula, 2 texto, 3 montos
  add column if not exists ref_razon  text,    -- RazonRef: por qué se emitió
  add column if not exists xml_synced_at timestamptz,
  add column if not exists xml_error  text;

comment on column public.bsale_sales_documents.ref_folio is
  'Factura que referencia la nota de crédito, leída del XML del DTE. La API no lo entrega.';

create index if not exists bsale_sales_xml_pend_idx
  on public.bsale_sales_documents (xml_synced_at)
  where code_sii = 61 and xml_synced_at is null;

-- ---------- 2. UNA NOTA DE CRÉDITO NO ES PLATA ----------
alter type public.payment_method add value if not exists 'nota_credito';

-- ---------- 3. APLICAR LAS NOTAS ----------
-- La referencia se lee del staging, no de la columna ya escrita: así la
-- simulación muestra de verdad lo que va a pasar. En la primera versión el
-- vínculo se escribía solo al aplicar y el ensayo salía siempre en cero.
--
-- Se descuenta como máximo el saldo vivo de la factura: si ya estaba pagada, lo
-- que sobra queda como crédito a favor del cliente en vez de convertirse en un
-- pago de más. Ese tope es lo que hace que correrla dos veces sea inofensivo.
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
      -- Método propio: la nota salda la factura pero no es plata que entró, así
      -- que queda fuera de lo recaudado y de los promedios de días de pago.
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

comment on function public.aplicar_notas_credito is
  'Vincula cada nota de crédito con su factura (según el XML del DTE) y descuenta el monto, hasta el saldo vivo.';

-- pg_cron corre como dueño de la base: no hay JWT, así que no es ni admin ni
-- service_role y las importaciones automáticas se rechazaban.
create or replace function public.puede_importar()
returns boolean language sql stable set search_path to 'public' as $$
  select public.is_admin()
      or public.is_service_role()
      or current_user in ('postgres', 'supabase_admin');
$$;

-- ---------- 4. SEPARAR LA NOTA DEL COBRO EN TODAS LAS VISTAS ----------
-- La imputación por nota se sigue viendo en la cartola —hace falta para
-- explicar por qué una factura quedó saldada— pero marcada, para que los
-- promedios de días de pago y lo recaudado del mes puedan dejarla fuera.
create or replace view public.v_pagos_detalle with (security_invoker = on) as
 SELECT pg.id AS payment_id, pg.code AS pago_code, pg.paid_at::date AS fecha_pago,
    to_char(pg.paid_at::date::timestamp with time zone, 'YYYY-MM'::text) AS mes_pago,
    pg.method::text AS metodo, pg.reference, pg.notes, pg.amount AS monto_pago,
    pg.customer_id, c.name AS cliente, c.rut, a.amount AS monto_imputado,
        CASE WHEN a.invoice_id IS NOT NULL THEN 'factura'::text
             WHEN a.order_id IS NOT NULL THEN 'pedido'::text
             WHEN a.opening_receivable_id IS NOT NULL THEN 'saldo_inicial'::text
             ELSE 'sin_imputar'::text END AS destino,
    COALESCE(i.doc_number, o.invoice_number, r.document_number) AS documento,
    COALESCE(i.issued_at, o.order_date::date, r.issued_at) AS emitido,
    COALESCE(i.due_date, o.due_date, r.due_date) AS vence,
    COALESCE(i.total, o.total, r.amount) AS total_documento,
    pg.paid_at::date - COALESCE(i.issued_at, o.order_date::date, r.issued_at) AS dias_desde_emision,
    pg.paid_at::date - COALESCE(i.due_date, o.due_date, r.due_date) AS dias_vs_vencimiento,
    pg.method = 'nota_credito'::public.payment_method AS es_nota_credito
   FROM payments pg
     JOIN customers c ON c.id = pg.customer_id
     LEFT JOIN payment_allocations a ON a.payment_id = pg.id
     LEFT JOIN invoices i ON i.id = a.invoice_id
     LEFT JOIN orders o ON o.id = a.order_id
     LEFT JOIN opening_receivables r ON r.id = a.opening_receivable_id
  WHERE pg.direction = 'cobro'::text;

-- Una factura anulada con nota quedaba como "pagada" el mismo día de su
-- emisión, y el cliente aparecía pagando en cero días. Las fechas de pago se
-- calculan ahora solo con plata; la nota se informa aparte, con su número.
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
    nc.notas AS notas_credito
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

-- Cobros del mes: solo plata. Las notas bajan la venta (vienen con total
-- negativo entre las facturas), no suben lo cobrado.
create or replace view public.v_meses_actividad with (security_invoker = on) as
 SELECT mes, sum(facturas) AS facturas, sum(venta) AS venta, sum(compras) AS compras,
    sum(costo_compras) AS costo_compras, sum(cobros) AS cobros, sum(cobrado) AS cobrado
   FROM ( SELECT to_char(invoices.issued_at::timestamp with time zone, 'YYYY-MM'::text) AS mes,
            count(*) FILTER (WHERE invoices.doc_type <> 'nota_credito'::doc_type) AS facturas,
            sum(invoices.total) AS venta, 0::bigint AS compras, 0::numeric AS costo_compras,
            0::bigint AS cobros, 0::numeric AS cobrado
           FROM invoices
          GROUP BY (to_char(invoices.issued_at::timestamp with time zone, 'YYYY-MM'::text))
        UNION ALL
         SELECT to_char(purchases.purchase_date::timestamp with time zone, 'YYYY-MM'::text),
            0::bigint, 0::numeric, count(*), sum(purchases.total), 0::bigint, 0::numeric
           FROM purchases
          GROUP BY (to_char(purchases.purchase_date::timestamp with time zone, 'YYYY-MM'::text))
        UNION ALL
         SELECT to_char(payments.paid_at, 'YYYY-MM'::text),
            0::bigint, 0::numeric, 0::bigint, 0::numeric, count(*), sum(payments.amount)
           FROM payments
          WHERE payments.direction = 'cobro'::text
            AND payments.method <> 'nota_credito'::public.payment_method
          GROUP BY (to_char(payments.paid_at, 'YYYY-MM'::text))) t
  GROUP BY mes;

-- "Último pago" del cliente: una nota de crédito no cuenta como que pagó.
-- (Solo cambia el CTE `ultimo`; el resto de la vista queda igual que en
-- `ar_vistas`, por eso se repite completa.)
create or replace view public.v_estado_cuenta_cliente with (security_invoker = on) as
 WITH deuda AS (
         SELECT v.customer_id, count(*) AS documentos, sum(v.saldo) AS deuda_total,
            sum(v.saldo) FILTER (WHERE v.dias_atraso = 0) AS por_vencer,
            sum(v.saldo) FILTER (WHERE v.dias_atraso BETWEEN 1 AND 15) AS atraso_1_15,
            sum(v.saldo) FILTER (WHERE v.dias_atraso BETWEEN 16 AND 30) AS atraso_16_30,
            sum(v.saldo) FILTER (WHERE v.dias_atraso BETWEEN 31 AND 60) AS atraso_31_60,
            sum(v.saldo) FILTER (WHERE v.dias_atraso > 60) AS atraso_60_mas,
            sum(v.saldo) FILTER (WHERE v.dias_atraso > 0) AS vencido,
            max(v.dias_atraso) AS peor_atraso, min(v.due_date) AS vence_primero
           FROM v_cuentas_por_cobrar v GROUP BY v.customer_id
        ), credito AS (
         SELECT n.customer_id, sum(n.disponible) AS nota_credito
           FROM v_notas_credito_pendientes n GROUP BY n.customer_id
        ), acuenta AS (
         SELECT s.customer_id, sum(s.sin_imputar) AS pago_a_cuenta
           FROM v_pagos_sin_imputar s GROUP BY s.customer_id
        ), ultimo AS (
         SELECT p.customer_id, max(p.paid_at) AS ultimo_pago
           FROM payments p
          WHERE p.direction = 'cobro'::text
            AND p.method <> 'nota_credito'::public.payment_method
          GROUP BY p.customer_id
        )
 SELECT c.id AS customer_id, c.name AS cliente, c.rut, c.comuna, c.phone, c.whatsapp, c.email,
    c.credit_limit, c.payment_terms_days,
    COALESCE(d.documentos, 0::bigint) AS documentos,
    COALESCE(d.deuda_total, 0::numeric) AS deuda_total,
    COALESCE(d.por_vencer, 0::numeric) AS por_vencer,
    COALESCE(d.atraso_1_15, 0::numeric) AS atraso_1_15,
    COALESCE(d.atraso_16_30, 0::numeric) AS atraso_16_30,
    COALESCE(d.atraso_31_60, 0::numeric) AS atraso_31_60,
    COALESCE(d.atraso_60_mas, 0::numeric) AS atraso_60_mas,
    COALESCE(d.vencido, 0::numeric) AS vencido,
    COALESCE(d.peor_atraso, 0) AS peor_atraso, d.vence_primero,
    COALESCE(cr.nota_credito, 0::numeric) AS nota_credito,
    COALESCE(ac.pago_a_cuenta, 0::numeric) AS pago_a_cuenta,
    COALESCE(d.deuda_total, 0::numeric) - COALESCE(cr.nota_credito, 0::numeric)
      - COALESCE(ac.pago_a_cuenta, 0::numeric) AS saldo_neto,
    u.ultimo_pago,
    CASE WHEN c.credit_limit > 0::numeric AND COALESCE(d.deuda_total, 0::numeric) > c.credit_limit
         THEN true ELSE false END AS sobre_limite
   FROM customers c
     LEFT JOIN deuda d ON d.customer_id = c.id
     LEFT JOIN credito cr ON cr.customer_id = c.id
     LEFT JOIN acuenta ac ON ac.customer_id = c.id
     LEFT JOIN ultimo u ON u.customer_id = c.id
  WHERE c.status = 'activo'::entity_status;

-- La nota rebaja la venta, pero no es plata pagada: se deja fuera de
-- `total_paid` para no mostrar clientes que "pagaron" más de lo facturado.
create or replace view public.v_customer_balance with (security_invoker = on) as
 WITH doc AS (
         SELECT o.customer_id, o.total, o.amount_paid, o.due_date, o.order_date AS fecha
           FROM orders o
          WHERE o.status <> 'cancelado'::order_status
            AND o.order_date::date >= analisis_desde()
            AND NOT (EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.id))
        UNION ALL
         SELECT i.customer_id, i.total,
            CASE WHEN i.doc_type = 'nota_credito'::doc_type THEN 0::numeric ELSE i.amount_paid END,
            i.due_date, i.issued_at::timestamp with time zone
           FROM invoices i WHERE i.issued_at >= analisis_desde()
        )
 SELECT c.id AS customer_id, c.name, c.customer_type, count(d.*) AS orders_count,
    COALESCE(sum(d.total), 0::numeric) AS total_invoiced,
    COALESCE(sum(d.amount_paid), 0::numeric) AS total_paid,
    COALESCE(sum(d.total - d.amount_paid) FILTER (WHERE (d.total - d.amount_paid) > 0::numeric), 0::numeric) AS balance_due,
    COALESCE(sum(d.total - d.amount_paid) FILTER (WHERE (d.total - d.amount_paid) > 0::numeric
             AND d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE), 0::numeric) AS overdue,
    max(d.fecha) AS last_order_at
   FROM customers c LEFT JOIN doc d ON d.customer_id = c.id
  GROUP BY c.id, c.name, c.customer_type;

-- ---------- 5. KPIs ----------
-- `cobrado_mes` contaba las notas como recaudación. Ahora es plata que entró, y
-- las notas van aparte para que se vea cuánto se anuló en el mes.
-- (Solo cambian esas dos claves respecto de `finance_kpis_margen_honesto`.)
create or replace function public.finance_kpis()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_venta numeric; v_venta_costeada numeric; v_costo numeric; v_corte date;
  v_fijos numeric; v_dias int; v_transcurridos int; v_cobertura numeric;
  v_margen numeric; v_margen_pct numeric; v_desde date;
begin
  if not (public.is_admin() or public.has_perm('payments','read')) then
    raise exception 'Sin permiso para ver informacion financiera';
  end if;
  v_corte := public.analisis_desde();
  v_desde := greatest(date_trunc('month', now())::date, v_corte);

  with venta as (
    select o.total as neto, o.cost_total from public.orders o
     where o.status <> 'cancelado' and o.order_date::date >= v_desde
       and not exists (select 1 from public.invoices i where i.order_id = o.id)
    union all
    select i.net_amount, i.cost_total from public.invoices i where i.issued_at >= v_desde
  )
  select coalesce(sum(neto), 0),
         coalesce(sum(neto) filter (where cost_total <> 0), 0),
         coalesce(sum(cost_total), 0)
    into v_venta, v_venta_costeada, v_costo from venta;

  v_margen     := v_venta_costeada - v_costo;
  v_margen_pct := case when v_venta_costeada > 0 then round((v_margen / v_venta_costeada) * 100, 1) else 0 end;
  v_cobertura  := case when v_venta > 0 then round((v_venta_costeada / v_venta) * 100, 1) else 0 end;

  select coalesce((value->>'costos_fijos_mensuales')::numeric, 0) into v_fijos
    from public.settings where key = 'operacion';
  v_fijos := coalesce(v_fijos, 0);
  v_dias := extract(day from (date_trunc('month', now()) + interval '1 month - 1 day'));
  v_transcurridos := extract(day from now());

  return jsonb_build_object(
    'analisis_desde', v_corte,
    'venta_mes', v_venta, 'venta_costeada', v_venta_costeada, 'cobertura_costo_pct', v_cobertura,
    'costo_mes', v_costo, 'margen_bruto', v_margen, 'margen_bruto_pct', v_margen_pct,
    'costos_fijos_mes', v_fijos,
    'costos_fijos_proporcional', round(v_fijos * (v_transcurridos::numeric / v_dias)),
    'resultado_estimado', v_margen - round(v_fijos * (v_transcurridos::numeric / v_dias)),
    'punto_equilibrio_venta', case when v_margen_pct > 0 then round(v_fijos / (v_margen_pct / 100)) else 0 end,
    'por_cobrar', (select coalesce(sum(saldo), 0) from public.v_cuentas_por_cobrar),
    'vencido', (select coalesce(sum(saldo), 0) from public.v_cuentas_por_cobrar where dias_atraso > 0),
    'por_pagar', (select coalesce(sum(saldo), 0) from public.v_cuentas_por_pagar),
    'cobrado_mes', (select coalesce(sum(amount), 0) from public.payments
                     where direction = 'cobro' and paid_at >= v_desde
                       and method <> 'nota_credito'),
    'notas_credito_mes', (select coalesce(sum(amount), 0) from public.payments
                           where direction = 'cobro' and paid_at >= v_desde
                             and method = 'nota_credito'),
    'pagado_mes', (select coalesce(sum(amount), 0) from public.payments
                    where direction = 'pago' and paid_at >= v_desde),
    'sin_imputar', (select coalesce(sum(sin_imputar), 0) from public.v_pagos_sin_imputar),
    'avisos_pendientes', (select count(*) from public.payment_reports where status = 'pendiente')
  );
end $function$;

-- ---------- 6. QUE SE RESUELVAN SOLAS ----------
-- El turno hace dos cosas distintas: aplicar lo que ya se puede (barato, sin
-- salir a internet) y solo entonces, si queda alguna nota sin su factura de
-- referencia, ir a buscar el XML. Mirando solo lo segundo, una nota cuya
-- factura llegaba después se quedaba sin aplicar para siempre.
create or replace function public.notas_credito_cron_tick()
returns bigint language plpgsql security definer
set search_path to 'public, extensions' as $$
declare v_secret text; v_req bigint;
begin
  if not exists (select 1 from public.bsale_connections where status = 'activa') then
    return null;
  end if;

  perform public.aplicar_notas_credito(false);

  if not exists (
    select 1 from public.bsale_sales_documents
     where code_sii = 61 and ref_folio is null
  ) then
    return null;
  end if;

  select public.automation_secret_get() into v_secret;
  if v_secret is null or v_secret = '' then
    return null;
  end if;

  select net.http_post(
    url     := 'https://owfvuusxfvzjgxfmllpt.supabase.co/functions/v1/bsale-notas-credito',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 180000
  ) into v_req;
  return v_req;
end $$;

revoke all on function public.notas_credito_cron_tick() from public, anon, authenticated;

-- A los 15 y 45, desfasado de la sincronización de los :00 y :30, para que la
-- nota ya esté en el staging cuando se le busque el XML.
select cron.schedule('notas-credito-15-45', '15,45 * * * *',
                     'select public.notas_credito_cron_tick();');
