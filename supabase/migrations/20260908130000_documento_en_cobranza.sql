-- EL MISMO ÍCONO EN COBRANZA
--
-- `20260908120000_documento_de_la_factura` dejó el enlace al documento emitido
-- en `invoices.document_url` y lo expuso en `v_facturas_con_pago`, que es de
-- donde lee la pestaña de facturas. La pestaña de documentos por cobrar —y la
-- cartola del cliente, que sale de la misma vista— seguía sin él, y es donde
-- más falta hace: al discutir una deuda lo primero que se pide es el documento.
--
-- `v_cuentas_por_cobrar` suma `document_url` al final de sus tres ramas. Solo
-- la factura tiene documento: el pedido interno todavía no se facturó y el
-- saldo inicial es una deuda arrastrada sin documento en el sistema, así que
-- esas dos ramas van en nulo y la fila simplemente no muestra el ícono.
--
-- `customer_statement` no se toca: arma la cartola con `to_jsonb(d)` sobre esta
-- misma vista, así que hereda la columna sola. `portal_get` tampoco: lista los
-- campos uno por uno, de modo que el enlace NO viaja al portal del cliente.
-- Que el cliente pueda descargar su propia factura desde el portal es una
-- decisión aparte, y esta migración no la toma.
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
    c.rut, c.company AS razon_social,
    i.document_url
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
    NULL::text, NULL::text, c.rut, c.company,
    -- El pedido interno todavía no tiene documento tributario emitido.
    NULL::text
   FROM orders o
     JOIN customers c ON c.id = o.customer_id
  WHERE o.status <> 'cancelado'::order_status
    AND (o.total - o.amount_paid) > 0::numeric
    AND o.order_date::date >= analisis_desde()
    AND NOT (EXISTS ( SELECT 1 FROM invoices i2 WHERE i2.order_id = o.id))
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
    NULL::text, NULL::text, c.rut, c.company,
    -- La deuda arrastrada de antes del sistema: su documento, si existe, está
    -- en papel o en el sistema anterior.
    NULL::text
   FROM opening_receivables r
     LEFT JOIN customers c ON c.id = r.customer_id
  WHERE (r.amount - r.amount_paid) > 0::numeric
    AND COALESCE(r.issued_at, analisis_desde()) >= analisis_desde();
