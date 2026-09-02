-- ============================================================
-- JLIZ BUSINESS · UN RUT, UNA FICHA DE PROVEEDOR
--
-- Cuatro proveedores estaban cargados dos veces: la ficha original con su
-- razón social ("Delgado Mar Spa") y una segunda, creada a mano, con el nombre
-- de pila con que se los llama en el día a día ("cañoto"). Mismo RUT, dos
-- fichas. Eso partía al proveedor en dos —deuda, comportamiento de pago,
-- historial— y era lo que hacía caer al cron (ver la migración anterior).
--
-- Acá se fusionan y se cierra la puerta:
--   1. el nombre de pila queda guardado como alias de la ficha buena, que es
--      para lo que existe `supplier_aliases`, y la ficha repetida se borra;
--   2. sólo se borra la que no tiene NADA detrás: si tuviera compras, pagos o
--      precios, la migración avisa y la deja para revisarla a mano;
--   3. un índice único impide que el mismo RUT vuelva a tener dos fichas, sin
--      importar cómo se escriba (con puntos, sin guión, en minúscula).
-- ============================================================

do $$
declare
  r record;
  v_refs int;
begin
  for r in
    with g as (
      select s.id, s.name, s.created_at,
             regexp_replace(upper(s.rut), '[^0-9K]', '', 'g') as rut_norm
        from public.suppliers s
       where regexp_replace(upper(coalesce(s.rut,'')), '[^0-9K]', '', 'g') <> ''
    )
    , m as (
      select g.*,
             first_value(g.id) over (partition by g.rut_norm order by g.created_at, g.id) as canonico,
             count(*)          over (partition by g.rut_norm) as fichas
        from g
    )
    select m.id, m.name, m.rut_norm, m.canonico
      from m
     where m.fichas > 1 and m.id <> m.canonico
  loop

    select (select count(*) from public.purchases        where supplier_id = r.id)
         + (select count(*) from public.payments         where supplier_id = r.id)
         + (select count(*) from public.purchase_history where supplier_id = r.id)
         + (select count(*) from public.opening_payables where supplier_id = r.id)
         + (select count(*) from public.inventory_lots   where supplier_id = r.id)
         + (select count(*) from public.supplier_products where supplier_id = r.id)
      into v_refs;

    if v_refs > 0 then
      raise notice 'Proveedor repetido % (%) tiene % movimientos: se deja para revision manual',
        r.name, r.id, v_refs;
      continue;
    end if;

    -- El nombre con que lo cargaron no se pierde: queda como alias del bueno.
    insert into public.supplier_aliases (alias, supplier_id)
    values (r.name, r.canonico)
    on conflict (alias) do nothing;

    delete from public.suppliers where id = r.id;
    raise notice 'Proveedor % fusionado en % (RUT %)', r.name, r.canonico, r.rut_norm;
  end loop;
end $$;

-- Un RUT, una ficha. El índice normaliza igual que la integración con Bsale,
-- así que "78.090.115-2" y "78090115-2" son el mismo proveedor.
create unique index if not exists suppliers_rut_norm_uidx
  on public.suppliers ((regexp_replace(upper(rut), '[^0-9K]', '', 'g')))
  where regexp_replace(upper(coalesce(rut,'')), '[^0-9K]', '', 'g') <> '';

comment on index public.suppliers_rut_norm_uidx is
  'Un RUT no puede tener dos fichas de proveedor, se escriba como se escriba.';

-- El indice no unico de la migracion anterior queda de sobra: este lo cubre.
drop index if exists public.suppliers_rut_norm_idx;
