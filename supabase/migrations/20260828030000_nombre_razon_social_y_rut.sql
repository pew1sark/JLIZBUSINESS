-- ============================================================
-- JLIZ BUSINESS · LOS TRES DATOS DE UN CLIENTE, EN TODAS PARTES
--
-- Nombre de fantasía, razón social y RUT sirven para cosas distintas: por el
-- primero se reconoce el local («Panchita», «DO SUSHI»), por el segundo se
-- cuadra con la factura, y por el tercero con el SII y con la cartola del
-- banco. Estaban repartidos de forma arbitraria: unas vistas traían solo el
-- nombre, otras el nombre y el RUT, y una sola las tres. Faltaban justamente
-- en las pantallas donde se concilia contra un documento tributario.
--
-- Todas las columnas se agregan AL FINAL, que es lo único que permite
-- `create or replace view`; por eso cada vista se repite entera aunque el
-- cambio sean dos columnas.
--
-- Cambian: v_cuentas_por_cobrar, v_cuentas_por_pagar, v_estado_cuenta_cliente,
-- v_pagos_detalle y v_comportamiento_pago_cliente. `v_facturas_con_pago` ya las
-- tenía desde 20260828020000.
-- ============================================================

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
        END AS tramo,
    i.etiqueta, i.etiqueta_nota,
    c.rut, c.company AS razon_social
   FROM invoices i
     JOIN customers c ON c.id = i.customer_id
  WHERE (i.doc_type = ANY (ARRAY['factura'::doc_type, 'boleta'::doc_type, 'nota_debito'::doc_type]))
    AND (i.total - i.amount_paid) > 0::numeric
    AND i.estado_forzado IS DISTINCT FROM 'pagado'::payment_status
    AND i.issued_at >= analisis_desde()
UNION ALL
 SELECT 'pedido'::text, o.id, o.id, NULL::uuid, NULL::uuid, o.code,
    'pedido'::text, o.invoice_number, o.customer_id,
    c.name, c.phone, c.whatsapp, c.email,
    o.order_date::date, o.due_date, o.total, o.amount_paid,
    o.total - o.amount_paid, o.invoice_number,
    GREATEST(CURRENT_DATE - o.due_date, 0),
        CASE
            WHEN o.due_date IS NULL THEN 'sin_plazo'::text
            WHEN CURRENT_DATE <= o.due_date THEN 'al_dia'::text
            WHEN (CURRENT_DATE - o.due_date) <= 15 THEN 'atraso_leve'::text
            WHEN (CURRENT_DATE - o.due_date) <= 30 THEN 'atraso_medio'::text
            ELSE 'atraso_grave'::text
        END,
    NULL::text, NULL::text, c.rut, c.company
   FROM orders o
     JOIN customers c ON c.id = o.customer_id
  WHERE o.status <> 'cancelado'::order_status AND (o.total - o.amount_paid) > 0::numeric
    AND o.order_date::date >= analisis_desde()
    AND NOT (EXISTS (SELECT 1 FROM invoices i2 WHERE i2.order_id = o.id))
UNION ALL
 SELECT 'saldo_inicial'::text, r.id, NULL::uuid, r.id, NULL::uuid, r.code,
    'saldo_inicial'::text, r.document_number, r.customer_id,
    COALESCE(c.name, r.customer_name), c.phone, c.whatsapp, c.email,
    r.issued_at, r.due_date, r.amount, r.amount_paid,
    r.amount - r.amount_paid, r.document_number,
    GREATEST(CURRENT_DATE - r.due_date, 0),
        CASE
            WHEN r.due_date IS NULL THEN 'sin_plazo'::text
            WHEN CURRENT_DATE <= r.due_date THEN 'al_dia'::text
            WHEN (CURRENT_DATE - r.due_date) <= 15 THEN 'atraso_leve'::text
            WHEN (CURRENT_DATE - r.due_date) <= 30 THEN 'atraso_medio'::text
            ELSE 'atraso_grave'::text
        END,
    NULL::text, NULL::text, c.rut, c.company
   FROM opening_receivables r
     LEFT JOIN customers c ON c.id = r.customer_id
  WHERE (r.amount - r.amount_paid) > 0::numeric
    AND COALESCE(r.issued_at, analisis_desde()) >= analisis_desde();

create or replace view public.v_cuentas_por_pagar with (security_invoker = on) as
 SELECT 'compra'::text AS origen, p.id AS ref_id, p.id AS purchase_id,
    NULL::uuid AS payable_id, p.code, p.supplier_id, s.name AS proveedor, s.phone,
    p.purchase_date AS issued_at, p.due_date,
    COALESCE(p.gross_total, p.total) AS total, p.total AS neto_mercaderia,
    p.net_amount, p.exempt_amount, p.tax_amount, p.invoice_number,
    p.document_url, p.dte_type, p.amount_paid,
    COALESCE(p.gross_total, p.total) - p.amount_paid AS saldo,
    GREATEST(CURRENT_DATE - COALESCE(p.due_date, p.purchase_date + s.payment_terms_days), 0) AS dias_atraso,
    s.rut, s.company AS razon_social
   FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.status = 'recibida'::purchase_status AND NOT p.is_credit_note
    AND (COALESCE(p.gross_total, p.total) - p.amount_paid) > 0::numeric
    AND p.purchase_date >= analisis_desde()
UNION ALL
 SELECT 'nota_credito'::text, p.id, p.id, NULL::uuid, p.code, p.supplier_id,
    s.name, s.phone, p.purchase_date, p.due_date,
    COALESCE(p.gross_total, - p.total), - p.total,
    - p.net_amount, - p.exempt_amount, - p.tax_amount, p.invoice_number,
    p.document_url, p.dte_type, 0::numeric,
    COALESCE(p.gross_total, - p.total), 0, s.rut, s.company
   FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
  WHERE p.is_credit_note AND p.purchase_date >= analisis_desde()
UNION ALL
 SELECT 'saldo_inicial'::text, a.id, NULL::uuid, a.id, a.code, a.supplier_id,
    COALESCE(s.name, a.supplier_name), s.phone, a.issued_at, a.due_date,
    a.amount, a.amount, NULL::numeric, 0::numeric, 0::numeric,
    a.document_number, NULL::text, NULL::integer, a.amount_paid,
    a.amount - a.amount_paid,
    GREATEST(CURRENT_DATE - a.due_date, 0), s.rut, s.company
   FROM opening_payables a LEFT JOIN suppliers s ON s.id = a.supplier_id
  WHERE (a.amount - a.amount_paid) > 0::numeric
    AND COALESCE(a.issued_at, analisis_desde()) >= analisis_desde();

-- Las tres que solo suman `razon_social` al final. El resto de cada definición
-- es idéntico al que traían.
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
         THEN true ELSE false END AS sobre_limite,
    c.address AS direccion,
    c.company AS razon_social
   FROM customers c
     LEFT JOIN deuda d ON d.customer_id = c.id
     LEFT JOIN credito cr ON cr.customer_id = c.id
     LEFT JOIN acuenta ac ON ac.customer_id = c.id
     LEFT JOIN ultimo u ON u.customer_id = c.id
  WHERE c.status = 'activo'::entity_status;

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
    pg.method = 'nota_credito'::public.payment_method AS es_nota_credito,
    c.company AS razon_social
   FROM payments pg
     JOIN customers c ON c.id = pg.customer_id
     LEFT JOIN payment_allocations a ON a.payment_id = pg.id
     LEFT JOIN invoices i ON i.id = a.invoice_id
     LEFT JOIN orders o ON o.id = a.order_id
     LEFT JOIN opening_receivables r ON r.id = a.opening_receivable_id
  WHERE pg.direction = 'cobro'::text;

-- `v_comportamiento_pago_cliente` solo agrega `c.company AS razon_social` al
-- final del SELECT exterior; su definición vive en `23_finanzas_cobranza_y_
-- rentabilidad` y no cambia en nada más.
