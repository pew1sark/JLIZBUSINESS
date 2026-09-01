-- CARGA HISTÓRICA DE PAGOS A PROVEEDORES
--
-- El negocio le paga a sus proveedores a ~32 días, pero nunca registró esos pagos
-- en el sistema: las 1.400 compras traídas desde Bsale entraron con amount_paid = 0
-- y la pantalla mostraba $230 millones de deuda que en realidad ya está pagada.
--
-- Esta función reconstruye lo histórico a plazo fijo. No es un dato comprobado
-- contra la cartola del banco, así que cada pago queda marcado con `is_estimated`
-- y el módulo de análisis lo informa aparte del pago real.
--
-- Tres candados, porque escribe sobre datos reales del cliente:
--   · simula por defecto (`_dry_run = true`);
--   · nunca toca una compra que ya tenga aunque sea un pago registrado a mano;
--   · nunca inventa un pago con fecha futura.
-- Y se puede deshacer entero con revertir_pagos_proveedor_historico().

create or replace function public.registrar_pagos_proveedor_historico(
  _hasta   date    default date '2026-07-31',
  _dias    integer default 32,
  _desde   date    default null,
  _dry_run boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_desde date := coalesce(_desde, public.analisis_desde());
  v_n int := 0; v_monto numeric := 0; v_meses jsonb; v_saltadas int; v_futuras int;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede cargar pagos históricos';
  end if;
  if _dias < 0 or _dias > 365 then raise exception 'Plazo fuera de rango'; end if;

  create temp table _obj on commit drop as
  select p.id,
         p.supplier_id,
         p.purchase_date,
         coalesce(p.gross_total, p.total) - p.amount_paid as saldo,
         (p.purchase_date + _dias)                        as fecha_pago,
         to_char(p.purchase_date, 'YYYY-MM')              as mes
    from public.purchases p
   where p.status = 'recibida'
     and not p.is_credit_note
     and p.purchase_date between v_desde and _hasta
     and coalesce(p.gross_total, p.total) - p.amount_paid > 0
     -- Lo cargado a mano manda: si la compra ya tiene un pago, se deja como está.
     and not exists (select 1 from public.payments pg
                      where pg.purchase_id = p.id and pg.direction = 'pago')
     -- Un pago que todavía no ocurre no se inventa.
     and (p.purchase_date + _dias) <= current_date;

  select count(*), coalesce(sum(saldo), 0) into v_n, v_monto from _obj;

  select count(*) into v_saltadas
    from public.purchases p
   where p.status = 'recibida' and not p.is_credit_note
     and p.purchase_date between v_desde and _hasta
     and coalesce(p.gross_total, p.total) - p.amount_paid > 0
     and exists (select 1 from public.payments pg
                  where pg.purchase_id = p.id and pg.direction = 'pago');

  select count(*) into v_futuras
    from public.purchases p
   where p.status = 'recibida' and not p.is_credit_note
     and p.purchase_date between v_desde and _hasta
     and coalesce(p.gross_total, p.total) - p.amount_paid > 0
     and (p.purchase_date + _dias) > current_date;

  select jsonb_agg(jsonb_build_object('mes', mes, 'compras', n, 'monto', monto) order by mes)
    into v_meses
    from (select mes, count(*) as n, sum(saldo)::bigint as monto from _obj group by mes) t;

  if _dry_run then
    return jsonb_build_object(
      'dry_run', true, 'desde', v_desde, 'hasta', _hasta, 'dias', _dias,
      'compras', v_n, 'monto', v_monto::bigint,
      'ya_tenian_pago', v_saltadas, 'pago_aun_no_vence', v_futuras,
      'por_mes', coalesce(v_meses, '[]'::jsonb));
  end if;

  insert into public.payments
    (direction, purchase_id, supplier_id, amount, method, paid_at, reference, notes, is_estimated, created_by)
  select 'pago', o.id, o.supplier_id, o.saldo, 'transferencia',
         (o.fecha_pago::timestamp + time '12:00') at time zone 'America/Santiago',
         null,
         'Pago estimado a ' || _dias || ' días · carga histórica',
         true, auth.uid()
    from _obj o;

  insert into public.audit_logs (user_id, action, table_name, record_id, reason, changes)
  values (auth.uid(), 'CARGA_PAGOS_PROVEEDOR', 'payments', null,
          'Carga histórica de pagos a proveedores a ' || _dias || ' días',
          jsonb_build_object('desde', v_desde, 'hasta', _hasta, 'dias', _dias,
                             'compras', v_n, 'monto', v_monto::bigint));

  return jsonb_build_object(
    'ok', true, 'desde', v_desde, 'hasta', _hasta, 'dias', _dias,
    'compras', v_n, 'monto', v_monto::bigint,
    'ya_tenian_pago', v_saltadas, 'pago_aun_no_vence', v_futuras,
    'por_mes', coalesce(v_meses, '[]'::jsonb));
end $fn$;

comment on function public.registrar_pagos_proveedor_historico(date, integer, date, boolean) is
  'Reconstruye los pagos a proveedores anteriores a una fecha, a plazo fijo. Simula por defecto. No toca compras con pagos cargados a mano.';

-- ---------- DESHACER ----------
-- payments_apply es AFTER INSERT, así que al borrar hay que recalcular a mano
-- lo que ese trigger mantiene: cuánto lleva pagado la compra y su estado.
create or replace function public.revertir_pagos_proveedor_historico(
  _dry_run boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_n int := 0; v_monto numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede revertir la carga histórica';
  end if;

  select count(*), coalesce(sum(amount), 0) into v_n, v_monto
    from public.payments where direction = 'pago' and is_estimated;

  if _dry_run then
    return jsonb_build_object('dry_run', true, 'pagos', v_n, 'monto', v_monto::bigint);
  end if;

  create temp table _afectadas on commit drop as
  select distinct purchase_id from public.payments
   where direction = 'pago' and is_estimated and purchase_id is not null;

  delete from public.payments where direction = 'pago' and is_estimated;

  update public.purchases p
     set amount_paid = t.pagado,
         payment_status = (case
           when coalesce(p.gross_total, p.total) > 0 and t.pagado >= coalesce(p.gross_total, p.total) then 'pagado'
           when t.pagado > 0 then 'parcial' else 'pendiente' end)::public.payment_status
    from (select a.purchase_id,
                 coalesce((select sum(amount) from public.payments pg
                            where pg.purchase_id = a.purchase_id and pg.direction = 'pago'), 0) as pagado
            from _afectadas a) t
   where p.id = t.purchase_id;

  insert into public.audit_logs (user_id, action, table_name, record_id, reason, changes)
  values (auth.uid(), 'REVERTIR_PAGOS_PROVEEDOR', 'payments', null,
          'Se deshizo la carga histórica de pagos a proveedores',
          jsonb_build_object('pagos', v_n, 'monto', v_monto::bigint));

  return jsonb_build_object('ok', true, 'pagos', v_n, 'monto', v_monto::bigint);
end $fn$;

comment on function public.revertir_pagos_proveedor_historico(boolean) is
  'Borra todos los pagos a proveedor marcados como estimados y devuelve las compras a su saldo anterior. Simula por defecto.';
