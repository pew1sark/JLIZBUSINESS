-- QUITAR UN CLIENTE O UN PROVEEDOR
--
-- Son dos cosas distintas y la pantalla tiene que dejarlas claras:
--
--   · DESACTIVAR es lo normal y es reversible. El cliente o el proveedor deja de
--     ofrecerse al crear pedidos y compras, pero su historia queda intacta. Sirve
--     para el proveedor con el que se dejó de trabajar y el cliente que no compra
--     hace un año: sus facturas siguen contando en los informes.
--
--   · ELIMINAR es definitivo y solo se permite cuando NO hay nada detrás. Sirve
--     para lo que en realidad es basura: el duplicado que quedó de una carga (hoy
--     hay tres proveedores repetidos sin ninguna compra) o la ficha creada por
--     error.
--
-- Por qué el borrado tiene que pasar sí o sí por una función: las llaves foráneas
-- protegen la historia a medias. `purchases` e `invoices` son RESTRICT y frenan el
-- borrado, pero `payments`, `inventory_lots`, `opening_payables` y
-- `purchase_history` son SET NULL: borrar un proveedor con pagos registrados no
-- fallaría, dejaría los pagos huérfanos y sin dueño, en silencio. Por eso se
-- revoca el DELETE directo y queda un solo camino, que cuenta antes de borrar.

-- ---------- 1 · UN PROVEEDOR TAMBIÉN SE AUDITA ----------
-- customers ya tenía su trigger; suppliers no. Ahora el plazo de pago del
-- proveedor mueve todo el análisis de pagos, así que cambiarlo debe quedar escrito.
drop trigger if exists suppliers_audit on public.suppliers;
create trigger suppliers_audit
  after insert or update or delete on public.suppliers
  for each row execute function public.audit_row();

-- ---------- 2 · QUÉ HAY DETRÁS DE LA FICHA ----------
create or replace function public.movimientos_entidad(_tipo text, _id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  v_nombre text; v_estado text; v_rut text;
  v_hist jsonb := '[]'::jsonb; v_acc jsonb := '[]'::jsonb; v_total int := 0;
begin
  if _tipo = 'proveedor' then
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

comment on function public.movimientos_entidad(text, uuid) is
  'Qué hay registrado a nombre de un cliente o proveedor. `puede_eliminar` es true solo cuando no queda ninguna historia detrás.';

-- ---------- 3 · ELIMINAR, CUANDO NO HAY NADA DETRÁS ----------
create or replace function public.eliminar_entidad(
  _tipo    text,
  _id      uuid,
  _confirm text default null,
  _dry_run boolean default true
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_info jsonb; v_nombre text; v_fila jsonb;
begin
  if not public.is_admin() then
    raise exception 'Solo un administrador puede eliminar una ficha';
  end if;

  v_info := public.movimientos_entidad(_tipo, _id);
  v_nombre := v_info->>'nombre';

  if not (v_info->>'puede_eliminar')::boolean then
    raise exception 'No se puede eliminar a %: tiene % movimiento(s) registrados. Desactívalo para sacarlo de las listas sin perder su historia.',
      v_nombre, v_info->>'total_historial';
  end if;

  if _dry_run then
    return v_info || jsonb_build_object('dry_run', true);
  end if;

  -- Escribir el nombre es el freno: un clic de más no borra una ficha.
  if _confirm is null or lower(trim(_confirm)) is distinct from lower(trim(v_nombre)) then
    raise exception 'Para eliminar hay que escribir el nombre exacto: %', v_nombre;
  end if;

  if _tipo = 'proveedor' then
    select to_jsonb(s) into v_fila from public.suppliers s where s.id = _id;
    delete from public.suppliers where id = _id;
  else
    select to_jsonb(c) into v_fila from public.customers c where c.id = _id;
    delete from public.customers where id = _id;
  end if;

  insert into public.audit_logs (user_id, action, table_name, record_id, before, reason, changes)
  values (auth.uid(), 'ELIMINAR_FICHA',
          case when _tipo = 'proveedor' then 'suppliers' else 'customers' end,
          _id::text, v_fila,
          'Ficha eliminada por no tener movimientos', v_info);

  return jsonb_build_object('ok', true, 'tipo', _tipo, 'nombre', v_nombre,
                            'accesorios_borrados', v_info->'accesorios');
end $fn$;

comment on function public.eliminar_entidad(text, uuid, text, boolean) is
  'Borra definitivamente un cliente o proveedor sin movimientos. Simula por defecto; para borrar de verdad hay que repetir el nombre exacto. Guarda la ficha completa en audit_logs.';

-- ---------- 4 · EL BORRADO DIRECTO DEJA DE SER UN CAMINO ----------
-- La política anterior dejaba a cualquier administrador borrar la fila desde la
-- API, y con ella los pagos y lotes quedaban apuntando a nadie. Ahora el único
-- camino es eliminar_entidad(), que cuenta antes de borrar.
drop policy if exists suppliers_delete on public.suppliers;
drop policy if exists customers_delete on public.customers;
