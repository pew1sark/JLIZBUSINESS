-- ============================================================
-- JLIZ BUSINESS · QUE EL PANEL RESPONDA AL CAMBIAR EL FILTRO
--
-- Dos cosas del lado de la base. La tercera —que la pantalla no se vacíe
-- mientras llega el dato nuevo— es del cliente y va en `Dashboard.tsx`.
--
-- 1 · `panel_series` resolvía cada día con CINCO subconsultas correlacionadas
--     sobre el mismo conjunto. Con "últimos 30 días" son 150 recorridos; con
--     "este año", más de 1.200, y el filtro se sentía pesado justo en el rango
--     que más se mira. Se agrupa una vez y se pega el resultado a la lista de
--     días. Devuelve exactamente lo mismo: 123 ms → 8 ms para un año.
--
-- 2 · `invoices` no tenía índice por `issued_at`, que es por donde filtran
--     todas las funciones del panel. Con 1.930 documentos el recorrido completo
--     todavía es barato, pero crece con cada mes que se factura.
--
-- 3 · `panel_comportamiento_pago` recorría TRES veces cada una de las dos
--     vistas base —una para el resumen, otra para la serie, otra para el
--     ranking—, y esas vistas no son baratas: arman el historial de pago de
--     cada documento. Más una subconsulta por cada fila del ranking para su
--     saldo de hoy. Se calculan una sola vez con `as materialized` y los tres
--     usos leen de ahí: 175 ms → 77 ms, con la misma respuesta al byte.
-- ============================================================

create or replace function public.panel_series(
  _desde       date default null,
  _hasta       date default null,
  _customer_id uuid default null
) returns table (
  dia date, ventas numeric, compras numeric, margen numeric,
  documentos int, venta_costeada numeric
)
language sql stable security definer set search_path to 'public' as $fn$
  with corte as (select public.analisis_desde() as d0),
  rango as (
    select greatest(coalesce(_desde, current_date - 29), (select d0 from corte)) as d1,
           coalesce(_hasta, current_date) as d2
  ),
  dias as (
    select generate_series((select d1 from rango), (select d2 from rango), interval '1 day')::date as dia
  ),
  venta as (
    select o.order_date::date as fecha, o.total as neto, o.cost_total,
           (o.cost_total <> 0) as costeada, o.customer_id
      from public.orders o
     where o.status <> 'cancelado'
       and o.order_date::date between (select d1 from rango) and (select d2 from rango)
       and not exists (select 1 from public.invoices i where i.order_id = o.id)
    union all
    select i.issued_at, i.net_amount, i.cost_total, (i.cost_total <> 0), i.customer_id
      from public.invoices i
     where i.issued_at between (select d1 from rango) and (select d2 from rango)
       and i.doc_type <> 'nota_credito'
  ),
  venta_f as (
    select * from venta where _customer_id is null or customer_id = _customer_id
  ),
  -- Una pasada por día en vez de una por día y por columna.
  ventas_dia as (
    select fecha,
           sum(neto)                                      as ventas,
           sum(neto - cost_total) filter (where costeada)  as margen,
           count(*)                                        as documentos,
           sum(neto) filter (where costeada)               as venta_costeada
      from venta_f
     group by fecha
  ),
  compras_dia as (
    select p.purchase_date as fecha, sum(p.total) as compras
      from public.purchases p
     where p.status = 'recibida'
       and p.purchase_date between (select d1 from rango) and (select d2 from rango)
     group by p.purchase_date
  )
  select d.dia,
         coalesce(v.ventas, 0),
         -- Con un cliente elegido, la compra no aplica: es del negocio, no del cliente.
         case when _customer_id is not null then 0 else coalesce(c.compras, 0) end,
         coalesce(v.margen, 0),
         coalesce(v.documentos, 0)::int,
         coalesce(v.venta_costeada, 0)
    from dias d
    left join ventas_dia  v on v.fecha = d.dia
    left join compras_dia c on c.fecha = d.dia
   order by d.dia;
$fn$;

comment on function public.panel_series is
  'Serie diaria de ventas, compras y margen del panel, acotable por rango de fechas y por cliente.';

-- Por acá filtran panel_series, panel_kilos, panel_productos, panel_clientes y
-- dashboard_kpis: es la columna más consultada de la tabla más grande.
create index if not exists invoices_issued_idx on public.invoices (issued_at);


-- ---------- 3 · COMPORTAMIENTO DE PAGO EN UNA SOLA PASADA ----------
create or replace function public.panel_comportamiento_pago(
  _desde  date default null,
  _hasta  date default null,
  _grano  text default 'mes',
  _limite int  default 6
) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  d0        date := public.analisis_desde();
  d1        date := greatest(coalesce(_desde, current_date - 179), d0);
  d2        date := coalesce(_hasta, current_date);
  unidad    text := case lower(coalesce(_grano, 'mes'))
                      when 'dia' then 'day' when 'semana' then 'week' else 'month' end;
  n         int  := greatest(coalesce(_limite, 6), 1);
  resultado jsonb;
begin
  -- Dias de credito, montos cobrados y montos pagados a proveedores son
  -- informacion financiera: no la ve quien solo opera en bodega o reparto.
  if not public.has_perm('reports', 'read') then
    raise exception 'Sin permiso para ver el comportamiento de pago';
  end if;

  -- Las dos vistas base son caras (arman el historial de pago de cada
  -- documento) y antes se recorrian tres veces cada una: para el resumen, para
  -- la serie y para el ranking. `as materialized` las calcula una sola vez y
  -- las tres las leen de ahi.
  with cli as materialized (
    select f.customer_id, f.cliente, f.total, f.dias_en_pagar, f.dias_vs_plazo,
           f.payment_terms_days, f.ultimo_pago
      from public.v_facturas_con_pago f
     where f.payment_status = 'pagado'
       and f.doc_type in ('factura', 'boleta', 'nota_debito')
       and f.dias_en_pagar is not null
       and f.ultimo_pago between d1 and d2
  ),
  prov as materialized (
    select p.supplier_id, p.proveedor, p.bruto, p.dias_en_pagar, p.dias_atraso,
           p.plazo_pactado, p.pago_estimado, p.fecha_pago
      from public.v_pago_proveedores p
     where p.estado_pago = 'pagado'
       and not p.is_credit_note
       and p.dias_en_pagar is not null
       and p.fecha_pago between d1 and d2
  ),
  -- La cartera de HOY, que no depende del periodo elegido. Se lee una vez y
  -- sirve para dos cosas: la antiguedad por tramos y el saldo de cada entidad
  -- del ranking, que antes eran una subconsulta por fila.
  cxc as materialized (select customer_id, saldo, dias_atraso from public.v_cuentas_por_cobrar),
  cxp as materialized (select supplier_id, saldo, dias_atraso from public.v_cuentas_por_pagar),
  saldo_cli as (
    select customer_id,
           coalesce(sum(saldo), 0)                                    as saldo_abierto,
           coalesce(sum(saldo) filter (where dias_atraso > 0), 0)     as vencido
      from cxc group by customer_id
  ),
  saldo_prov as (
    select supplier_id,
           coalesce(sum(saldo), 0)                                    as saldo_abierto,
           coalesce(sum(saldo) filter (where dias_atraso > 0), 0)     as vencido
      from cxp group by supplier_id
  ),

  -- ----- lado cliente: lo que se COBRO en el periodo -----
  resumen_cli as (
    select jsonb_build_object(
      'docs',        count(*),
      'monto',       coalesce(sum(c.total), 0),
      'entidades',   count(distinct c.customer_id),
      'dias',        round(sum(c.dias_en_pagar * abs(c.total)) / nullif(sum(abs(c.total)), 0), 1),
      'dias_simple', round(avg(c.dias_en_pagar), 1),
      'mediana',     percentile_cont(0.5) within group (order by c.dias_en_pagar),
      'plazo',       round(sum(coalesce(c.payment_terms_days, 0) * abs(c.total))
                           / nullif(sum(abs(c.total)), 0), 1),
      'exceso',      round(sum(c.dias_vs_plazo * abs(c.total)) filter (where c.dias_vs_plazo is not null)
                           / nullif(sum(abs(c.total)) filter (where c.dias_vs_plazo is not null), 0), 1),
      'a_tiempo',    count(*) filter (where c.dias_vs_plazo <= 0),
      'medibles',    count(*) filter (where c.dias_vs_plazo is not null),
      'peor',        max(c.dias_en_pagar),
      -- Peso-dias: Σ(monto × dias de espera). Dividido por los dias del periodo
      -- da el capital que en promedio estuvo inmovilizado en la calle.
      'peso_dias',   coalesce(sum(c.dias_en_pagar * c.total), 0)
    ) as j from cli c
  ),

  -- ----- lado proveedor: lo que se PAGO en el periodo -----
  -- `dias_medido` deja fuera los pagos reconstruidos a plazo fijo en la carga
  -- historica: incluirlos hace que el promedio devuelva el supuesto (32 dias).
  resumen_prov as (
    select jsonb_build_object(
      'docs',           count(*),
      'monto',          coalesce(sum(p.bruto), 0),
      'entidades',      count(distinct p.supplier_id),
      'dias',           round(sum(p.dias_en_pagar * abs(p.bruto)) / nullif(sum(abs(p.bruto)), 0), 1),
      'dias_medido',    round(sum(p.dias_en_pagar * abs(p.bruto)) filter (where not p.pago_estimado)
                              / nullif(sum(abs(p.bruto)) filter (where not p.pago_estimado), 0), 1),
      'dias_simple',    round(avg(p.dias_en_pagar), 1),
      'mediana',        percentile_cont(0.5) within group (order by p.dias_en_pagar),
      'plazo',          round(sum(coalesce(p.plazo_pactado, 0) * abs(p.bruto))
                              / nullif(sum(abs(p.bruto)), 0), 1),
      'exceso',         round(sum(p.dias_atraso * abs(p.bruto)) filter (where p.dias_atraso is not null)
                              / nullif(sum(abs(p.bruto)) filter (where p.dias_atraso is not null), 0), 1),
      'a_tiempo',       count(*) filter (where p.dias_atraso <= 0),
      'medibles',       count(*) filter (where p.dias_atraso is not null),
      'peor',           max(p.dias_en_pagar),
      'estimados',      count(*) filter (where p.pago_estimado),
      'medidos',        count(*) filter (where not p.pago_estimado),
      'monto_estimado', coalesce(sum(p.bruto) filter (where p.pago_estimado), 0),
      'peso_dias',      coalesce(sum(p.dias_en_pagar * p.bruto), 0)
    ) as j from prov p
  ),

  cartera as (
    select jsonb_build_object(
      'cobrar', (select jsonb_build_object(
          'total',      coalesce(sum(saldo), 0),
          'docs',       count(*),
          'por_vencer', coalesce(sum(saldo) filter (where coalesce(dias_atraso, 0) <= 0), 0),
          't1_15',      coalesce(sum(saldo) filter (where dias_atraso between 1 and 15), 0),
          't16_30',     coalesce(sum(saldo) filter (where dias_atraso between 16 and 30), 0),
          't31_60',     coalesce(sum(saldo) filter (where dias_atraso between 31 and 60), 0),
          't60_mas',    coalesce(sum(saldo) filter (where dias_atraso > 60), 0)) from cxc),
      'pagar',  (select jsonb_build_object(
          'total',      coalesce(sum(saldo), 0),
          'docs',       count(*),
          'por_vencer', coalesce(sum(saldo) filter (where coalesce(dias_atraso, 0) <= 0), 0),
          't1_15',      coalesce(sum(saldo) filter (where dias_atraso between 1 and 15), 0),
          't16_30',     coalesce(sum(saldo) filter (where dias_atraso between 16 and 30), 0),
          't31_60',     coalesce(sum(saldo) filter (where dias_atraso between 31 and 60), 0),
          't60_mas',    coalesce(sum(saldo) filter (where dias_atraso > 60), 0)) from cxp)
    ) as j
  ),

  -- ----- evolucion: los dos lados sobre el mismo eje de tiempo -----
  serie_cli as (
    select date_trunc(unidad, c.ultimo_pago)::date as periodo,
           sum(c.dias_en_pagar * abs(c.total)) / nullif(sum(abs(c.total)), 0) as dias,
           sum(c.total)                                            as monto,
           count(*)::int                                           as docs,
           count(*) filter (where c.dias_vs_plazo <= 0)::int        as a_tiempo,
           count(*) filter (where c.dias_vs_plazo is not null)::int as medibles
      from cli c group by 1
  ),
  serie_prov as (
    select date_trunc(unidad, p.fecha_pago)::date as periodo,
           sum(p.dias_en_pagar * abs(p.bruto)) / nullif(sum(abs(p.bruto)), 0) as dias,
           sum(p.dias_en_pagar * abs(p.bruto)) filter (where not p.pago_estimado)
             / nullif(sum(abs(p.bruto)) filter (where not p.pago_estimado), 0) as dias_medido,
           sum(p.bruto)                                            as monto,
           count(*)::int                                           as docs,
           count(*) filter (where p.dias_atraso <= 0)::int          as a_tiempo,
           count(*) filter (where p.dias_atraso is not null)::int   as medibles,
           count(*) filter (where p.pago_estimado)::int             as estimados
      from prov p group by 1
  ),
  ejes as (select periodo from serie_cli union select periodo from serie_prov),
  serie as (
    select jsonb_agg(jsonb_build_object(
             'periodo',          e.periodo,
             'cobro_dias',       round(c.dias, 1),
             'cobro_monto',      c.monto,
             'cobro_docs',       c.docs,
             'cobro_a_tiempo',   c.a_tiempo,
             'cobro_medibles',   c.medibles,
             'pago_dias',        round(p.dias, 1),
             'pago_dias_medido', round(p.dias_medido, 1),
             'pago_monto',       p.monto,
             'pago_docs',        p.docs,
             'pago_a_tiempo',    p.a_tiempo,
             'pago_medibles',    p.medibles,
             'pago_estimados',   p.estimados
           ) order by e.periodo) as j
      from ejes e
      left join serie_cli  c on c.periodo = e.periodo
      left join serie_prov p on p.periodo = e.periodo
  ),

  -- ----- quienes se demoran mas en pagar (y cuanto deben hoy) -----
  -- Ordenar por dias sueltos deja arriba a quien tiene una sola factura chica
  -- atrasada. Los peso-dias ponen primero al que retiene mas plata por mas
  -- tiempo, que es a quien hay que llamar.
  morosos as (
    select jsonb_agg(to_jsonb(t) order by t.peso_dias desc) as j from (
      select c.customer_id                                      as id,
             max(c.cliente)                                     as nombre,
             count(*)::int                                      as docs,
             sum(c.total)                                       as monto,
             round(sum(c.dias_en_pagar * abs(c.total)) / nullif(sum(abs(c.total)), 0), 1) as dias,
             round(sum(c.dias_vs_plazo * abs(c.total)) filter (where c.dias_vs_plazo is not null)
                   / nullif(sum(abs(c.total)) filter (where c.dias_vs_plazo is not null), 0), 1) as exceso,
             count(*) filter (where c.dias_vs_plazo <= 0)::int   as a_tiempo,
             count(*) filter (where c.dias_vs_plazo is not null)::int as medibles,
             coalesce(max(s.saldo_abierto), 0)                   as saldo_abierto,
             coalesce(max(s.vencido), 0)                         as vencido,
             sum(c.dias_en_pagar * c.total)                      as peso_dias
        from cli c
        left join saldo_cli s on s.customer_id = c.customer_id
       group by c.customer_id
       order by peso_dias desc
       limit n
    ) t
  ),
  acreedores as (
    select jsonb_agg(to_jsonb(t) order by t.peso_dias desc) as j from (
      select p.supplier_id                                     as id,
             max(p.proveedor)                                  as nombre,
             count(*)::int                                     as docs,
             sum(p.bruto)                                      as monto,
             round(sum(p.dias_en_pagar * abs(p.bruto)) / nullif(sum(abs(p.bruto)), 0), 1) as dias,
             round(sum(p.dias_atraso * abs(p.bruto)) filter (where p.dias_atraso is not null)
                   / nullif(sum(abs(p.bruto)) filter (where p.dias_atraso is not null), 0), 1) as exceso,
             count(*) filter (where p.dias_atraso <= 0)::int     as a_tiempo,
             count(*) filter (where p.dias_atraso is not null)::int as medibles,
             count(*) filter (where p.pago_estimado)::int        as estimados,
             coalesce(max(s.saldo_abierto), 0)                   as saldo_abierto,
             coalesce(max(s.vencido), 0)                         as vencido,
             sum(p.dias_en_pagar * p.bruto)                      as peso_dias
        from prov p
        left join saldo_prov s on s.supplier_id = p.supplier_id
       group by p.supplier_id
       order by peso_dias desc
       limit n
    ) t
  )
  select jsonb_build_object(
    'desde',        d1,
    'hasta',        d2,
    'dias_periodo', (d2 - d1 + 1),
    'grano',        unidad,
    'clientes',     coalesce((select j from resumen_cli),  '{}'::jsonb),
    'proveedores',  coalesce((select j from resumen_prov), '{}'::jsonb),
    'cartera',      coalesce((select j from cartera),      '{}'::jsonb),
    'serie',        coalesce((select j from serie),        '[]'::jsonb),
    'morosos',      coalesce((select j from morosos),      '[]'::jsonb),
    'acreedores',   coalesce((select j from acreedores),   '[]'::jsonb)
  ) into resultado;

  return resultado;
end $fn$;
