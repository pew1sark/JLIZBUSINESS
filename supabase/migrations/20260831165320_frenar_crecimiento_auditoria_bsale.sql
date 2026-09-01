-- Frena el crecimiento desbocado de audit_logs (543 MB de los 579 de la base).
--
-- Causa: bsale_aplicar_costos borraba y reinsertaba TODAS las lineas de compra de
-- origen Bsale en cada corrida del cron (cada 30 min). Eso disparaba
-- trg_purchase_items_totals -> recalc_purchase_totals, que reescribia purchases dos
-- veces por compra (subtotal 87.500 -> 0 -> 87.500), y audit_row guardaba el
-- before/after completo de cada paso: ~44.000 filas y ~86 MB por dia, con el valor
-- final identico al inicial.
--
-- Ningun cambio altera el estado final de los datos. Solo se deja de escribir lo
-- que ya estaba escrito igual.

-- 1 · No reescribir una compra cuyos totales no cambian.
create or replace function public.recalc_purchase_totals(_purchase_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare v_sub numeric(14,2);
begin
  select coalesce(sum(line_total),0) into v_sub from public.purchase_items where purchase_id = _purchase_id;
  update public.purchases
     set subtotal = v_sub,
         total    = v_sub + freight_cost + other_costs
   where id = _purchase_id
     and (subtotal is distinct from v_sub
       or total    is distinct from v_sub + freight_cost + other_costs);
end $fn$;

-- 2 · Sincronizacion diferencial: solo se tocan las compras cuyo detalle cambio.
create or replace function public.bsale_aplicar_costos(_dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_items int := 0; v_prod int := 0; v_ventas int := 0; v_docs int := 0; v_corte date;
        v_cambiadas int := 0;
begin
  if not (public.puede_importar() or public.has_perm('purchases','update')) then
    raise exception 'Sin permiso';
  end if;
  v_corte := public.analisis_desde();

  create temp table _lin on commit drop as
  select i.bsale_document_id, i.line_no, i.product_id, i.description,
         i.quantity, i.unit, i.unit_price, i.line_total,
         p.id as purchase_id, p.purchase_date,
         (lower(coalesce(i.unit,'')) not in ('caja','cu')) as sirve_para_costo
    from public.bsale_document_items i
    join public.purchases p on p.bsale_document_id = i.bsale_document_id
   where i.es_mercaderia and i.product_id is not null
     and i.quantity is not null and i.quantity > 0
     and i.unit_price is not null and i.unit_price > 0
     and p.purchase_date >= v_corte;

  select count(*), count(distinct purchase_id) into v_items, v_docs from _lin;

  if _dry_run then
    return jsonb_build_object('dry_run', true, 'desde', v_corte, 'lineas_de_compra', v_items,
      'compras_con_detalle', v_docs,
      'productos_con_costo', (select count(distinct product_id) from _lin where sirve_para_costo));
  end if;

  -- Lo que deberia quedar en purchase_items, normalizado igual que el insert original.
  create temp table _des on commit drop as
  select l.purchase_id, l.product_id, l.quantity,
         (case when lower(coalesce(l.unit,'')) = 'caja' then 'caja'
               when lower(coalesce(l.unit,'')) in ('un','unid','c/u','cu','unidad') then 'unidad'
               else 'kg' end)::public.unit_measure as unit,
         l.unit_price, 'Desde Bsale · ' || l.description as notes
    from _lin l;

  -- Compras cuyo detalle difiere de lo ya guardado. Los castes al tipo destino son
  -- necesarios: bsale_document_items usa numeric(14,4) y purchase_items (12,3)/(12,2),
  -- que es la coercion que hace el propio insert.
  -- Si una huella no calza por cualquier motivo, la compra entra y se reconstruye
  -- igual que antes: ante la duda, el camino conservador es rehacerla.
  create temp table _cambia on commit drop as
  with d as (
    select purchase_id, md5(string_agg(f, E'\n' order by f)) as huella
      from (select purchase_id,
                   product_id::text||'|'||quantity::numeric(12,3)::text||'|'||unit::text||'|'||
                   unit_price::numeric(12,2)::text||'|'||coalesce(notes,'') as f
              from _des) x
     group by purchase_id
  ), a as (
    select purchase_id, md5(string_agg(f, E'\n' order by f)) as huella
      from (select pi.purchase_id,
                   pi.product_id::text||'|'||pi.quantity::numeric(12,3)::text||'|'||pi.unit::text||'|'||
                   pi.unit_price::numeric(12,2)::text||'|'||coalesce(pi.notes,'') as f
              from public.purchase_items pi
              join public.purchases p on p.id = pi.purchase_id and p.origin = 'bsale') x
     group by purchase_id
  )
  select coalesce(d.purchase_id, a.purchase_id) as purchase_id
    from d full outer join a on a.purchase_id = d.purchase_id
   where d.huella is distinct from a.huella;

  select count(*) into v_cambiadas from _cambia;

  delete from public.purchase_items pi
   using public.purchases p
   where pi.purchase_id = p.id and p.origin = 'bsale'
     and pi.purchase_id in (select purchase_id from _cambia);

  insert into public.purchase_items (purchase_id, product_id, quantity, unit, unit_price, notes)
  select d.purchase_id, d.product_id, d.quantity, d.unit, d.unit_price, d.notes
    from _des d
   where d.purchase_id in (select purchase_id from _cambia);
  get diagnostics v_items = row_count;

  with costo as (
    select product_id, sum(quantity * unit_price) / nullif(sum(quantity), 0) as promedio,
           (array_agg(unit_price order by purchase_date desc, line_no desc))[1] as ultimo
      from _lin where sirve_para_costo group by product_id
  ), upd as (
    update public.products p set avg_cost = round(c.promedio), last_cost = round(c.ultimo)
      from costo c
     where c.product_id = p.id
       and (p.avg_cost  is distinct from round(c.promedio)
         or p.last_cost is distinct from round(c.ultimo))
    returning 1
  ) select count(*) into v_prod from upd;

  with upd as (
    update public.invoice_items ii
       set unit_cost_net = p.avg_cost, cost_total = round(ii.quantity * p.avg_cost)
      from public.products p
     where p.id = ii.product_id and p.avg_cost > 0
       and (ii.unit_cost_net is distinct from p.avg_cost
         or ii.cost_total    is distinct from round(ii.quantity * p.avg_cost))
    returning 1
  ) select count(*) into v_ventas from upd;

  update public.invoices i set cost_total = t.suma
    from (select invoice_id, sum(cost_total) as suma from public.invoice_items group by invoice_id) t
   where t.invoice_id = i.id and i.cost_total is distinct from t.suma;

  return jsonb_build_object('ok', true, 'desde', v_corte, 'lineas_de_compra_creadas', v_items,
    'compras_con_detalle', v_docs, 'productos_con_costo', v_prod,
    'lineas_de_venta_costeadas', v_ventas,
    'compras_actualizadas', v_cambiadas);
end $fn$;

-- 3 · Los totales de una compra son campos derivados: auditarlos no aporta
-- trazabilidad (la aporta el movimiento que los causo) y es lo que llenaba la tabla.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  v_before jsonb; v_after jsonb; v_fila jsonb; v_id text; v_email text; v_changes jsonb;
begin
  if (tg_op = 'DELETE') then
    v_before := to_jsonb(old); v_after := null; v_fila := v_before;
  elsif (tg_op = 'UPDATE') then
    v_before := to_jsonb(old); v_after := to_jsonb(new); v_fila := v_after;
    if v_before = v_after then return new; end if;

    select jsonb_object_agg(k, jsonb_build_object('antes', v_before->k, 'despues', v_after->k))
      into v_changes
      from jsonb_object_keys(v_after) k
     where v_before->k is distinct from v_after->k
       and k not in ('updated_at');

    -- Si lo unico que cambio son totales recalculados, no hay nada que registrar.
    if tg_table_name = 'purchases' and v_changes is not null
       and not exists (select 1 from jsonb_object_keys(v_changes) k
                        where k not in ('subtotal','total','amount_paid','payment_status'))
    then
      return new;
    end if;
  else
    v_before := null; v_after := to_jsonb(new); v_fila := v_after;
  end if;

  v_id := coalesce(v_fila->>'id', v_fila->>'key', v_fila->>'code', v_fila->>'token');

  select email into v_email from public.profiles where id = auth.uid();

  insert into public.audit_logs (user_id, user_email, action, table_name, record_id, before, after, changes)
  values (auth.uid(), v_email, tg_op, tg_table_name, v_id, v_before, v_after, v_changes);
  return coalesce(new, old);
end $fn$;
