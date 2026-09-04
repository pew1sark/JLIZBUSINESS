-- ============================================================
-- JLIZ BUSINESS · TABLERO DE KILOS Y COMPORTAMIENTO DE PAGO
--
-- Dos preguntas que el panel no respondía y que se hacen todas las semanas:
--
-- 1 · ¿QUÉ SE VENDE MÁS, EN KILOS? El panel rankea por facturación, que es
--     otra cosa: un filete caro sube el ranking con la mitad de mercadería que
--     un pescado entero barato. Para comprar, para negociar con el proveedor y
--     para saber qué falta en cámara, la unidad es el kilo, no el peso.
--
-- 2 · ¿CÓMO SE PAGA Y CÓMO SE COBRA? Los dos lados existían por separado
--     —Cobranza mide a los clientes, Compras mide a los proveedores— pero
--     nunca en la misma pantalla, que es donde aparece el único número que
--     decide si la caja alcanza: la BRECHA entre los días que se tarda en
--     cobrar y los días que se tarda en pagar. Si se cobra a 38 y se paga a
--     32, el negocio le está prestando 6 días de plata a sus clientes.
--
-- Ambas funciones son solo de lectura y quedan cerradas al público: el panel
-- vive detrás de la sesión de administración.
-- ============================================================

-- ---------- 1 · KILOS VENDIDOS POR PRODUCTO ----------
create or replace function public.panel_kilos(
  _desde       date default null,
  _hasta       date default null,
  _customer_id uuid default null,
  _limite      int  default 8
) returns jsonb
language sql stable security definer set search_path to 'public' as $fn$
  with corte as (select public.analisis_desde() as d0),
  rango as (
    select greatest(coalesce(_desde, current_date - 29), (select d0 from corte)) as d1,
           coalesce(_hasta, current_date) as d2
  ),
  -- La ventana anterior de igual largo, pegada al inicio del período: es la
  -- única comparación que no engaña cuando el filtro es "últimos 30 días".
  prev as (
    select r.d1 - (r.d2 - r.d1 + 1) as p1, r.d1 - 1 as p2 from rango r
  ),
  lineas as (
    select coalesce(nullif(trim(it.description), ''), 'Sin producto') as producto,
           -- La nota de crédito devuelve mercadería: descuenta kilos y venta.
           -- El signo de la cantidad no es confiable (hay notas cargadas en
           -- positivo con el monto en negativo), así que lo decide el tipo de
           -- documento y no el dato de la línea.
           case when i.doc_type = 'nota_credito' then -abs(it.quantity)  else it.quantity  end as kilos,
           case when i.doc_type = 'nota_credito' then -abs(it.net_total) else it.net_total end as venta,
           it.invoice_id, i.customer_id, i.issued_at
      from public.invoice_items it
      join public.invoices i on i.id = it.invoice_id
     where i.issued_at >= (select p1 from prev)
       and i.issued_at <= (select d2 from rango)
       and (_customer_id is null or i.customer_id = _customer_id)
  ),
  actual as (select * from lineas where issued_at >= (select d1 from rango)),
  previo as (select * from lineas where issued_at <= (select p2 from prev)),
  producto as (
    select a.producto,
           sum(a.kilos)                       as kilos,
           sum(a.venta)                       as venta,
           count(distinct a.invoice_id)::int  as documentos,
           count(distinct a.customer_id)::int as clientes,
           (select sum(p.kilos) from previo p where p.producto = a.producto) as kilos_previos
      from actual a
     group by a.producto
  ),
  total as (
    select coalesce(sum(kilos), 0) as kilos, coalesce(sum(venta), 0) as venta,
           count(*)::int as productos
      from producto
  ),
  -- Cuánto de la venta del período tiene detalle de líneas. Sin esto, un
  -- ranking armado con la mitad de las facturas se lee como si fuera todo.
  docs as (
    select count(*)::int as emitidos,
           count(*) filter (
             where exists (select 1 from public.invoice_items it where it.invoice_id = i.id)
           )::int as con_detalle
      from public.invoices i
     where i.doc_type <> 'nota_credito'
       and i.issued_at between (select d1 from rango) and (select d2 from rango)
       and (_customer_id is null or i.customer_id = _customer_id)
  ),
  ranking as (
    select p.producto,
           round(p.kilos, 1)                                        as kilos,
           p.venta,
           case when p.kilos <> 0 then round(p.venta / p.kilos) end as precio_kilo,
           p.documentos, p.clientes,
           case when (select kilos from total) > 0
                then round(100 * p.kilos / (select kilos from total), 1) end as participacion,
           round(p.kilos_previos, 1)                                as kilos_previos,
           case when p.kilos_previos > 0
                then round(100 * (p.kilos - p.kilos_previos) / p.kilos_previos, 1) end as variacion
      from producto p
     order by p.kilos desc
     limit greatest(coalesce(_limite, 8), 1)
  )
  select jsonb_build_object(
    'desde',           (select d1 from rango),
    'hasta',           (select d2 from rango),
    'previo_desde',    (select p1 from prev),
    'previo_hasta',    (select p2 from prev),
    -- Antes del corte de análisis no hay nada cargado: comparar contra esa
    -- ventana inventaría un crecimiento que no ocurrió.
    'previo_completo', (select p1 from prev) >= (select d0 from corte),
    'kilos',           (select kilos from total),
    'venta',           (select venta from total),
    'productos',       (select productos from total),
    'kilos_previos',   (select coalesce(sum(kilos), 0) from previo),
    'documentos',      (select emitidos from docs),
    'con_detalle',     (select con_detalle from docs),
    'ranking',         coalesce((select jsonb_agg(to_jsonb(r) order by r.kilos desc) from ranking r),
                                '[]'::jsonb)
  );
$fn$;

comment on function public.panel_kilos is
  'Ranking de productos por KILOS vendidos en un rango, con precio por kilo, participación, comparación contra el período anterior de igual largo y cobertura del detalle de líneas. Las notas de crédito descuentan.';

revoke all on function public.panel_kilos(date, date, uuid, int) from public, anon;
grant execute on function public.panel_kilos(date, date, uuid, int) to authenticated;


-- ---------- 2 · CÓMO COBRA Y CÓMO PAGA EL NEGOCIO ----------
--
-- El período se mide por FECHA DE PAGO, no de emisión: la pregunta es "cómo
-- se pagó en agosto", y una factura de junio cobrada en agosto es plata que
-- entró en agosto. Todos los promedios de días van ponderados por monto,
-- porque una factura de $4.000.000 a 60 días amarra la caja mucho más que
-- tres de $100.000 al contado.
create or replace function public.panel_comportamiento_pago(
  _desde  date default null,
  _hasta  date default null,
  _grano  text default 'mes',
  _limite int  default 6
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  d0      date := public.analisis_desde();
  d1      date := greatest(coalesce(_desde, current_date - 179), d0);
  d2      date := coalesce(_hasta, current_date);
  unidad  text := case lower(coalesce(_grano, 'mes'))
                    when 'dia' then 'day' when 'semana' then 'week' else 'month' end;
  n       int  := greatest(coalesce(_limite, 6), 1);
  cobro   jsonb; pago jsonb; cartera jsonb; serie jsonb; morosos jsonb; acreedores jsonb;
begin
  -- Días de crédito, montos cobrados y montos pagados a proveedores son
  -- información financiera: no la ve quien solo opera en bodega o reparto.
  if not public.has_perm('reports', 'read') then
    raise exception 'Sin permiso para ver el comportamiento de pago';
  end if;

  -- ----- lado cliente: lo que se COBRÓ en el período -----
  select jsonb_build_object(
    'docs',        count(*),
    'monto',       coalesce(sum(f.total), 0),
    'entidades',   count(distinct f.customer_id),
    'dias',        round(sum(f.dias_en_pagar * abs(f.total)) / nullif(sum(abs(f.total)), 0), 1),
    'dias_simple', round(avg(f.dias_en_pagar), 1),
    'mediana',     percentile_cont(0.5) within group (order by f.dias_en_pagar),
    'plazo',       round(sum(coalesce(f.payment_terms_days, 0) * abs(f.total))
                         / nullif(sum(abs(f.total)), 0), 1),
    'exceso',      round(sum(f.dias_vs_plazo * abs(f.total)) filter (where f.dias_vs_plazo is not null)
                         / nullif(sum(abs(f.total)) filter (where f.dias_vs_plazo is not null), 0), 1),
    'a_tiempo',    count(*) filter (where f.dias_vs_plazo <= 0),
    'medibles',    count(*) filter (where f.dias_vs_plazo is not null),
    'peor',        max(f.dias_en_pagar),
    -- Peso-días: Σ(monto × días de espera). Dividido por los días del período
    -- da el capital que en promedio estuvo inmovilizado en la calle, que es lo
    -- que de verdad cuesta que paguen tarde.
    'peso_dias',   coalesce(sum(f.dias_en_pagar * f.total), 0)
  ) into cobro
  from public.v_facturas_con_pago f
  where f.payment_status = 'pagado'
    and f.doc_type in ('factura', 'boleta', 'nota_debito')
    and f.dias_en_pagar is not null
    and f.ultimo_pago between d1 and d2;

  -- ----- lado proveedor: lo que se PAGÓ en el período -----
  --
  -- `dias_medido` deja fuera los pagos reconstruidos a plazo fijo en la carga
  -- histórica: incluirlos hace que el promedio devuelva el supuesto (32 días)
  -- en vez de lo que se pagó de verdad.
  select jsonb_build_object(
    'docs',          count(*),
    'monto',         coalesce(sum(p.bruto), 0),
    'entidades',     count(distinct p.supplier_id),
    'dias',          round(sum(p.dias_en_pagar * abs(p.bruto)) / nullif(sum(abs(p.bruto)), 0), 1),
    'dias_medido',   round(sum(p.dias_en_pagar * abs(p.bruto)) filter (where not p.pago_estimado)
                           / nullif(sum(abs(p.bruto)) filter (where not p.pago_estimado), 0), 1),
    'dias_simple',   round(avg(p.dias_en_pagar), 1),
    'mediana',       percentile_cont(0.5) within group (order by p.dias_en_pagar),
    'plazo',         round(sum(coalesce(p.plazo_pactado, 0) * abs(p.bruto))
                           / nullif(sum(abs(p.bruto)), 0), 1),
    'exceso',        round(sum(p.dias_atraso * abs(p.bruto)) filter (where p.dias_atraso is not null)
                           / nullif(sum(abs(p.bruto)) filter (where p.dias_atraso is not null), 0), 1),
    'a_tiempo',      count(*) filter (where p.dias_atraso <= 0),
    'medibles',      count(*) filter (where p.dias_atraso is not null),
    'peor',          max(p.dias_en_pagar),
    'estimados',     count(*) filter (where p.pago_estimado),
    'medidos',       count(*) filter (where not p.pago_estimado),
    'monto_estimado', coalesce(sum(p.bruto) filter (where p.pago_estimado), 0),
    -- El mismo peso-días del otro lado: capital que el proveedor financia.
    'peso_dias',     coalesce(sum(p.dias_en_pagar * p.bruto), 0)
  ) into pago
  from public.v_pago_proveedores p
  where p.estado_pago = 'pagado'
    and not p.is_credit_note
    and p.dias_en_pagar is not null
    and p.fecha_pago between d1 and d2;

  -- ----- la cartera de HOY, que no depende del período elegido -----
  select jsonb_build_object(
    'cobrar', (
      select jsonb_build_object(
        'total',      coalesce(sum(saldo), 0),
        'docs',       count(*),
        'por_vencer', coalesce(sum(saldo) filter (where coalesce(dias_atraso, 0) <= 0), 0),
        't1_15',      coalesce(sum(saldo) filter (where dias_atraso between 1 and 15), 0),
        't16_30',     coalesce(sum(saldo) filter (where dias_atraso between 16 and 30), 0),
        't31_60',     coalesce(sum(saldo) filter (where dias_atraso between 31 and 60), 0),
        't60_mas',    coalesce(sum(saldo) filter (where dias_atraso > 60), 0)
      ) from public.v_cuentas_por_cobrar),
    'pagar', (
      select jsonb_build_object(
        'total',      coalesce(sum(saldo), 0),
        'docs',       count(*),
        'por_vencer', coalesce(sum(saldo) filter (where coalesce(dias_atraso, 0) <= 0), 0),
        't1_15',      coalesce(sum(saldo) filter (where dias_atraso between 1 and 15), 0),
        't16_30',     coalesce(sum(saldo) filter (where dias_atraso between 16 and 30), 0),
        't31_60',     coalesce(sum(saldo) filter (where dias_atraso between 31 and 60), 0),
        't60_mas',    coalesce(sum(saldo) filter (where dias_atraso > 60), 0)
      ) from public.v_cuentas_por_pagar)
  ) into cartera;

  -- ----- evolución: los dos lados sobre el mismo eje de tiempo -----
  with c as (
    select date_trunc(unidad, f.ultimo_pago)::date as periodo,
           sum(f.dias_en_pagar * abs(f.total)) / nullif(sum(abs(f.total)), 0) as dias,
           sum(f.total)                                        as monto,
           count(*)::int                                       as docs,
           count(*) filter (where f.dias_vs_plazo <= 0)::int    as a_tiempo,
           count(*) filter (where f.dias_vs_plazo is not null)::int as medibles
      from public.v_facturas_con_pago f
     where f.payment_status = 'pagado'
       and f.doc_type in ('factura', 'boleta', 'nota_debito')
       and f.dias_en_pagar is not null
       and f.ultimo_pago between d1 and d2
     group by 1
  ),
  p as (
    select date_trunc(unidad, v.fecha_pago)::date as periodo,
           sum(v.dias_en_pagar * abs(v.bruto)) / nullif(sum(abs(v.bruto)), 0) as dias,
           sum(v.dias_en_pagar * abs(v.bruto)) filter (where not v.pago_estimado)
             / nullif(sum(abs(v.bruto)) filter (where not v.pago_estimado), 0) as dias_medido,
           sum(v.bruto)                                        as monto,
           count(*)::int                                       as docs,
           count(*) filter (where v.dias_atraso <= 0)::int      as a_tiempo,
           count(*) filter (where v.dias_atraso is not null)::int as medibles,
           count(*) filter (where v.pago_estimado)::int         as estimados
      from public.v_pago_proveedores v
     where v.estado_pago = 'pagado'
       and not v.is_credit_note
       and v.dias_en_pagar is not null
       and v.fecha_pago between d1 and d2
     group by 1
  ),
  ejes as (select periodo from c union select periodo from p)
  select jsonb_agg(jsonb_build_object(
           'periodo',        e.periodo,
           'cobro_dias',     round(c.dias, 1),
           'cobro_monto',    c.monto,
           'cobro_docs',     c.docs,
           'cobro_a_tiempo', c.a_tiempo,
           'cobro_medibles', c.medibles,
           'pago_dias',      round(p.dias, 1),
           'pago_dias_medido', round(p.dias_medido, 1),
           'pago_monto',     p.monto,
           'pago_docs',      p.docs,
           'pago_a_tiempo',  p.a_tiempo,
           'pago_medibles',  p.medibles,
           'pago_estimados', p.estimados
         ) order by e.periodo)
    into serie
    from ejes e
    left join c on c.periodo = e.periodo
    left join p on p.periodo = e.periodo;

  -- ----- quiénes se demoran más en pagar (y cuánto deben hoy) -----
  select jsonb_agg(to_jsonb(t) order by t.peso_dias desc) into morosos from (
    select f.customer_id                                       as id,
           max(f.cliente)                                      as nombre,
           count(*)::int                                       as docs,
           sum(f.total)                                        as monto,
           round(sum(f.dias_en_pagar * abs(f.total)) / nullif(sum(abs(f.total)), 0), 1) as dias,
           round(sum(f.dias_vs_plazo * abs(f.total)) filter (where f.dias_vs_plazo is not null)
                 / nullif(sum(abs(f.total)) filter (where f.dias_vs_plazo is not null), 0), 1) as exceso,
           count(*) filter (where f.dias_vs_plazo <= 0)::int    as a_tiempo,
           count(*) filter (where f.dias_vs_plazo is not null)::int as medibles,
           (select coalesce(sum(cc.saldo), 0) from public.v_cuentas_por_cobrar cc
             where cc.customer_id = f.customer_id)              as saldo_abierto,
           (select coalesce(sum(cc.saldo), 0) from public.v_cuentas_por_cobrar cc
             where cc.customer_id = f.customer_id and cc.dias_atraso > 0) as vencido,
           sum(f.dias_en_pagar * f.total)                      as peso_dias
      from public.v_facturas_con_pago f
     where f.payment_status = 'pagado'
       and f.doc_type in ('factura', 'boleta', 'nota_debito')
       and f.dias_en_pagar is not null
       and f.ultimo_pago between d1 and d2
     group by f.customer_id
     -- Ordenar por días sueltos deja arriba a quien tiene una sola factura
     -- chica atrasada. Los peso-días ponen primero al que retiene más plata
     -- por más tiempo, que es a quien hay que llamar.
     order by peso_dias desc
     limit n
  ) t;

  -- ----- a quién se le paga más lento (mismo criterio, otro lado) -----
  select jsonb_agg(to_jsonb(t) order by t.peso_dias desc) into acreedores from (
    select v.supplier_id                                       as id,
           max(v.proveedor)                                    as nombre,
           count(*)::int                                       as docs,
           sum(v.bruto)                                        as monto,
           round(sum(v.dias_en_pagar * abs(v.bruto)) / nullif(sum(abs(v.bruto)), 0), 1) as dias,
           round(sum(v.dias_atraso * abs(v.bruto)) filter (where v.dias_atraso is not null)
                 / nullif(sum(abs(v.bruto)) filter (where v.dias_atraso is not null), 0), 1) as exceso,
           count(*) filter (where v.dias_atraso <= 0)::int      as a_tiempo,
           count(*) filter (where v.dias_atraso is not null)::int as medibles,
           count(*) filter (where v.pago_estimado)::int         as estimados,
           (select coalesce(sum(cp.saldo), 0) from public.v_cuentas_por_pagar cp
             where cp.supplier_id = v.supplier_id)              as saldo_abierto,
           (select coalesce(sum(cp.saldo), 0) from public.v_cuentas_por_pagar cp
             where cp.supplier_id = v.supplier_id and cp.dias_atraso > 0) as vencido,
           sum(v.dias_en_pagar * v.bruto)                      as peso_dias
      from public.v_pago_proveedores v
     where v.estado_pago = 'pagado'
       and not v.is_credit_note
       and v.dias_en_pagar is not null
       and v.fecha_pago between d1 and d2
     group by v.supplier_id
     order by peso_dias desc
     limit n
  ) t;

  return jsonb_build_object(
    'desde',       d1,
    'hasta',       d2,
    'dias_periodo', (d2 - d1 + 1),
    'grano',       unidad,
    'clientes',    coalesce(cobro, '{}'::jsonb),
    'proveedores', coalesce(pago, '{}'::jsonb),
    'cartera',     coalesce(cartera, '{}'::jsonb),
    'serie',       coalesce(serie, '[]'::jsonb),
    'morosos',     coalesce(morosos, '[]'::jsonb),
    'acreedores',  coalesce(acreedores, '[]'::jsonb)
  );
end $fn$;

comment on function public.panel_comportamiento_pago is
  'Comportamiento de pago de clientes y proveedores en un rango, por fecha de pago: días promedio ponderados por monto, cumplimiento del plazo, antigüedad de la cartera de hoy, evolución por día/semana/mes y los peores de cada lado. Base del tablero financiero del panel.';

revoke all on function public.panel_comportamiento_pago(date, date, text, int) from public, anon;
grant execute on function public.panel_comportamiento_pago(date, date, text, int) to authenticated;
