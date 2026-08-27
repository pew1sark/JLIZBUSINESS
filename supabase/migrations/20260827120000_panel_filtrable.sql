-- ============================================================
-- JLIZ BUSINESS · PANEL FILTRABLE
--
-- sales_series solo aceptaba "los últimos N días" y no se podía acotar a un
-- cliente. Esto permite elegir el rango exacto y mirar un solo restaurante,
-- que es la pregunta que aparece apenas se ve una caída en el gráfico:
-- "¿fue el negocio o fue este cliente?".
--
-- Las compras no se filtran por cliente (no tienen uno): cuando se está
-- mirando un cliente, la serie de compras viene en cero a propósito.
-- ============================================================
create or replace function public.panel_series(
  _desde       date default null,
  _hasta       date default null,
  _customer_id uuid default null
) returns table (
  dia date, ventas numeric, compras numeric, margen numeric,
  documentos int, venta_costeada numeric
)
language sql stable security definer set search_path to 'public' as $$
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
       and o.order_date::date >= (select d1 from rango)
       and not exists (select 1 from public.invoices i where i.order_id = o.id)
    union all
    select i.issued_at, i.net_amount, i.cost_total, (i.cost_total <> 0), i.customer_id
      from public.invoices i
     where i.issued_at >= (select d1 from rango)
       and i.doc_type <> 'nota_credito'
  ),
  venta_f as (
    select * from venta where _customer_id is null or customer_id = _customer_id
  )
  select d.dia,
    coalesce((select sum(v.neto) from venta_f v where v.fecha = d.dia), 0),
    -- Con un cliente elegido, la compra no aplica: es del negocio, no del cliente.
    case when _customer_id is not null then 0 else
      coalesce((select sum(p.total) from public.purchases p
                 where p.purchase_date = d.dia and p.status = 'recibida'), 0) end,
    coalesce((select sum(v.neto - v.cost_total) from venta_f v where v.fecha = d.dia and v.costeada), 0),
    coalesce((select count(*) from venta_f v where v.fecha = d.dia), 0)::int,
    coalesce((select sum(v.neto) from venta_f v where v.fecha = d.dia and v.costeada), 0)
  from dias d
  where d.dia <= (select d2 from rango)
  order by d.dia;
$$;

comment on function public.panel_series is
  'Serie diaria de ventas, compras y margen del panel, acotable por rango de fechas y por cliente.';

-- ---------- QUÉ SE VENDIÓ, POR PRODUCTO ----------
create or replace function public.panel_productos(
  _desde       date default null,
  _hasta       date default null,
  _customer_id uuid default null,
  _limite      int  default 10
) returns table (
  producto text, kilos numeric, venta numeric, documentos int, clientes int
)
language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(trim(it.description), ''), 'Sin producto') as producto,
         sum(it.quantity)                as kilos,
         sum(it.net_total)               as venta,
         count(distinct i.id)::int       as documentos,
         count(distinct i.customer_id)::int as clientes
    from public.invoice_items it
    join public.invoices i on i.id = it.invoice_id
   where i.doc_type <> 'nota_credito'
     and i.issued_at >= greatest(coalesce(_desde, current_date - 59), public.analisis_desde())
     and i.issued_at <= coalesce(_hasta, current_date)
     and (_customer_id is null or i.customer_id = _customer_id)
   group by 1
   order by sum(it.net_total) desc
   limit greatest(_limite, 1);
$$;

comment on function public.panel_productos is
  'Ranking de productos vendidos en un rango, acotable a un cliente.';

-- ---------- QUÉ CLIENTE COMPRÓ CUÁNTO ----------
create or replace function public.panel_clientes(
  _desde  date default null,
  _hasta  date default null,
  _limite int  default 10
) returns table (
  customer_id uuid, cliente text, venta numeric, documentos int,
  saldo numeric, ultima_compra date
)
language sql stable security definer set search_path to 'public' as $$
  select i.customer_id, c.name,
         sum(case when i.doc_type = 'nota_credito' then -i.net_amount else i.net_amount end) as venta,
         count(*) filter (where i.doc_type <> 'nota_credito')::int as documentos,
         sum(i.total - i.amount_paid) filter (where i.doc_type <> 'nota_credito') as saldo,
         max(i.issued_at) as ultima_compra
    from public.invoices i
    join public.customers c on c.id = i.customer_id
   where i.issued_at >= greatest(coalesce(_desde, current_date - 29), public.analisis_desde())
     and i.issued_at <= coalesce(_hasta, current_date)
   group by i.customer_id, c.name
   order by 3 desc
   limit greatest(_limite, 1);
$$;

comment on function public.panel_clientes is
  'Ranking de clientes por venta neta en un rango, con su saldo pendiente.';
