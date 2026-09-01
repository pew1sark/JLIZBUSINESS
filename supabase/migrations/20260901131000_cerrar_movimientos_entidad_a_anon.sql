-- CERRAR movimientos_entidad A LOS ANÓNIMOS
--
-- La función quedó SECURITY DEFINER y sin chequeo de permiso adentro: con la
-- llave anónima —la que viaja en el bundle del navegador y cualquiera puede
-- leer— se podía sacar el nombre y el RUT de cualquier cliente o proveedor
-- sabiendo su uuid. Se probó y filtraba de verdad, no era teórico.
--
-- Se cierra por los dos lados, como el resto del sistema:
--   · el permiso se chequea dentro de la función, que es lo que realmente frena;
--   · y se quita el execute abierto. Ojo: revocárselo a `anon` no basta, porque
--     el grant vive en PUBLIC (`=X/postgres` en proacl); hay que revocar PUBLIC.
--     `authenticated` tiene su propio grant explícito y sigue funcionando.

create or replace function public.movimientos_entidad(_tipo text, _id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_nombre text; v_estado text; v_rut text;
  v_hist jsonb := '[]'::jsonb; v_acc jsonb := '[]'::jsonb; v_total int := 0;
begin
  if _tipo = 'proveedor' then
    if not (public.is_admin() or public.has_perm('suppliers','read')) then
      raise exception 'Sin permiso para ver proveedores';
    end if;
    select s.name, s.status::text, s.rut into v_nombre, v_estado, v_rut
      from public.suppliers s where s.id = _id;
    if v_nombre is null then raise exception 'El proveedor no existe'; end if;

    with c(que, n) as (values
      ('Compras',                (select count(*) from public.purchases        where supplier_id = _id)),
      ('Pagos registrados',      (select count(*) from public.payments         where supplier_id = _id and direction = 'pago')),
      ('Lotes de inventario',    (select count(*) from public.inventory_lots   where supplier_id = _id)),
      ('Saldos iniciales',       (select count(*) from public.opening_payables where supplier_id = _id)),
      ('Historial de precios',   (select count(*) from public.purchase_history where supplier_id = _id))
    )
    select coalesce(jsonb_agg(jsonb_build_object('que', que, 'n', n) order by n desc)
             filter (where n > 0), '[]'::jsonb),
           coalesce(sum(n), 0)
      into v_hist, v_total from c;

    with a(que, n) as (values
      ('Productos que le compramos', (select count(*) from public.supplier_products where supplier_id = _id)),
      ('Nombres alternativos',       (select count(*) from public.supplier_aliases  where supplier_id = _id))
    )
    select coalesce(jsonb_agg(jsonb_build_object('que', que, 'n', n) order by n desc)
             filter (where n > 0), '[]'::jsonb)
      into v_acc from a;

  elsif _tipo = 'cliente' then
    if not (public.is_admin() or public.has_perm('customers','read')) then
      raise exception 'Sin permiso para ver clientes';
    end if;
    select c.name, c.status::text, c.rut into v_nombre, v_estado, v_rut
      from public.customers c where c.id = _id;
    if v_nombre is null then raise exception 'El cliente no existe'; end if;

    with c(que, n) as (values
      ('Facturas',             (select count(*) from public.invoices             where customer_id = _id)),
      ('Pedidos',              (select count(*) from public.orders               where customer_id = _id)),
      ('Cobros registrados',   (select count(*) from public.payments             where customer_id = _id and direction = 'cobro')),
      ('Saldos iniciales',     (select count(*) from public.opening_receivables  where customer_id = _id)),
      ('Avisos de pago',       (select count(*) from public.payment_reports      where customer_id = _id)),
      ('Correos enviados',     (select count(*) from public.correos_enviados     where customer_id = _id))
    )
    select coalesce(jsonb_agg(jsonb_build_object('que', que, 'n', n) order by n desc)
             filter (where n > 0), '[]'::jsonb),
           coalesce(sum(n), 0)
      into v_hist, v_total from c;

    with a(que, n) as (values
      ('Direcciones de entrega', (select count(*) from public.customer_addresses      where customer_id = _id)),
      ('Contactos',              (select count(*) from public.customer_contacts       where customer_id = _id)),
      ('Precios especiales',     (select count(*) from public.customer_special_prices where customer_id = _id)),
      ('Enlaces del portal',     (select count(*) from public.customer_portal_tokens  where customer_id = _id))
    )
    select coalesce(jsonb_agg(jsonb_build_object('que', que, 'n', n) order by n desc)
             filter (where n > 0), '[]'::jsonb)
      into v_acc from a;
  else
    raise exception 'Tipo no válido: usa proveedor o cliente';
  end if;

  return jsonb_build_object(
    'tipo', _tipo, 'id', _id, 'nombre', v_nombre, 'rut', v_rut, 'estado', v_estado,
    'historial', v_hist, 'accesorios', v_acc, 'total_historial', v_total,
    'puede_eliminar', v_total = 0);
end $fn$;


revoke execute on function public.movimientos_entidad(text, uuid) from public;
revoke execute on function public.eliminar_entidad(text, uuid, text, boolean) from public;
revoke execute on function public.registrar_pagos_proveedor_historico(date, integer, date, boolean) from public;
revoke execute on function public.revertir_pagos_proveedor_historico(boolean) from public;
revoke execute on function public.plazo_proveedor(uuid, date, date) from anon;
revoke execute on function public.plazo_proveedor_default() from anon;
