-- Histórico al día.
--
-- v_historico_mensual y v_historico_proveedores leían de purchase_history, el
-- registro de compras del SII que se cargó una sola vez y termina el 31-07-2026.
-- Desde ahí la pantalla quedó congelada aunque las compras siguieran entrando
-- por Bsale cada 30 minutos a purchases.
--
-- purchases ya contiene los 607 documentos de purchase_history (cruzados por RUT
-- y folio: ninguno falta, mismos montos y fechas) más los de 2025 traídos con
-- «Traer histórico» y todo lo de agosto en adelante. Las vistas pasan a leer de
-- ahí y se mantienen solas. purchase_history no se toca: queda como respaldo.
--
-- Monto: gross_total (total del documento con IVA, igual que monto_total del
-- SII). En 2025 `total` no es el monto del documento, así que no sirve. Las
-- notas de crédito restan siempre, venga como venga el signo. Las compras
-- manuales sin desglose (p. ej. Terminal Pesquero) caen en `total`.
--
-- Una diferencia con el SII: el folio 1231120 de INDRA figuraba como factura y
-- Bsale lo trae como DTE 61. Manda Bsale, que lee el tipo del documento.
--
-- Permisos: purchase_history dejaba leer a quien tuviera purchases.read O
-- reports.read; purchases solo a purchases.read. Con security_invoker el rol
-- `ventas` (solo reportes) se quedaba sin histórico, así que las vistas corren
-- como dueño y repiten la regla de historico_read en el WHERE.

create or replace view public.v_historico_compras as
select
  p.purchase_date as fecha,
  p.supplier_id,
  s.rut,
  coalesce(nullif(s.company, ''), s.name) as razon_social,
  p.is_credit_note as es_nota_credito,
  case when p.is_credit_note
    then -abs(coalesce(p.gross_total, p.total))
    else coalesce(p.gross_total, p.total)
  end as monto_total
from public.purchases p
join public.suppliers s on s.id = p.supplier_id
where p.status = 'recibida'
  and (public.is_admin() or public.has_perm('purchases', 'read') or public.has_perm('reports', 'read'));

alter view public.v_historico_compras reset (security_invoker);
revoke all on public.v_historico_compras from anon, public;
grant select on public.v_historico_compras to authenticated, service_role;

create or replace view public.v_historico_mensual as
select
  date_trunc('month', fecha)::date as mes,
  count(*) filter (where not es_nota_credito) as documentos,
  count(distinct rut) as proveedores,
  coalesce(sum(monto_total) filter (where not es_nota_credito), 0) as compras,
  coalesce(sum(monto_total) filter (where es_nota_credito), 0) as notas_credito,
  coalesce(sum(monto_total), 0) as compra_neta,
  coalesce(avg(monto_total) filter (where not es_nota_credito), 0) as promedio_documento
from public.v_historico_compras
group by 1;

create or replace view public.v_historico_proveedores as
with total as (
  select nullif(sum(monto_total), 0) as t
  from public.v_historico_compras
  where not es_nota_credito
)
select
  rut,
  max(razon_social) as razon_social,
  max(supplier_id::text)::uuid as supplier_id,
  count(*) filter (where not es_nota_credito) as documentos,
  coalesce(sum(monto_total) filter (where not es_nota_credito), 0) as compras,
  coalesce(sum(monto_total) filter (where es_nota_credito), 0) as notas_credito,
  round(coalesce(sum(monto_total) filter (where not es_nota_credito), 0) / (select t from total) * 100, 2) as participacion_pct,
  min(fecha) as primera_compra,
  max(fecha) as ultima_compra,
  round(coalesce(avg(monto_total) filter (where not es_nota_credito), 0)) as promedio_documento
from public.v_historico_compras
group by rut;

-- Las dos de arriba leen de v_historico_compras, que ya filtra por permiso;
-- pueden seguir como security_invoker.
revoke all on public.v_historico_mensual, public.v_historico_proveedores from anon, public;
grant select on public.v_historico_mensual, public.v_historico_proveedores to authenticated, service_role;
