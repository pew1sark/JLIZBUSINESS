-- ============================================================
-- JLIZ BUSINESS · UN SOLO PROVEEDOR POR RUT AL VOLCAR LAS COMPRAS
--
-- El cron caía cada media hora con:
--   duplicate key value violates unique constraint "purchases_bsale_doc_idx"
--
-- Causa: `bsale_apply_purchases` cruzaba cada documento del libro de compras
-- con `suppliers` por RUT normalizado. Cuando un mismo RUT tiene DOS fichas
-- —pasa apenas alguien crea el proveedor a mano con el nombre de pila
-- ("candia") sobre uno que ya existía con su razón social ("CANDIA")— ese join
-- devolvía dos filas por documento, y el insert chocaba contra el índice único
-- de `bsale_document_id`. La excepción abortaba la función entera y con ella
-- toda la cadena del cron: no entraban compras, ni costos, ni ventas.
--
-- Se cierra por las dos puntas:
--   1. el cruce resuelve a UNA ficha por documento: la más antigua del RUT,
--      que es donde está el historial de compras de ese proveedor;
--   2. `on conflict ... do nothing` sobre el índice, para que ninguna
--      condición de datos vuelva a botar la sincronización completa.
--
-- Es el mismo problema que 20260827230000_dos_locales_un_rut resolvió para las
-- ventas; ahí quedó pendiente la mitad de las compras.
-- ============================================================

-- El cruce por RUT normalizado ahora corre en cada documento del libro.
create index if not exists suppliers_rut_norm_idx
  on public.suppliers ((regexp_replace(upper(rut), '[^0-9K]', '', 'g')));

create or replace function public.bsale_apply_purchases(
  _connection_id uuid default null::uuid, _dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_conn uuid; v_prov_nuevos int := 0; v_compras_nuevas int := 0;
  v_ya int := 0; v_omitidos int := 0; v_total numeric := 0;
begin
  if not (public.puede_importar() or public.has_perm('purchases','create')) then
    raise exception 'Sin permiso para importar compras';
  end if;

  select coalesce(_connection_id,
                  (select id from public.bsale_connections where status='activa' order by created_at limit 1))
    into v_conn;
  if v_conn is null then raise exception 'No hay conexion de Bsale activa'; end if;

  create temp table _pend on commit drop as
  select d.bsale_id, d.number, d.emission_date, d.client_code,
         regexp_replace(upper(d.client_code),'[^0-9K]','','g') as rut_norm,
         coalesce(nullif(trim(d.supplier_name),''),
                  public.fix_mojibake(d.raw->>'clientActivity')) as prov_nombre,
         d.net_amount, d.iva_amount, d.total_amount, d.url_pdf
    from public.bsale_third_party_documents d
   where d.connection_id = v_conn
     and coalesce(d.book_type,'compra') = 'compra'
     and coalesce(d.canceled,false) = false
     and coalesce(d.client_code,'') <> ''
     and not exists (select 1 from public.purchases p where p.bsale_document_id = d.bsale_id);

  select count(*), coalesce(sum(total_amount),0) into v_ya, v_total from _pend;

  select count(*) into v_omitidos from public.bsale_third_party_documents d
   where d.connection_id = v_conn
     and (coalesce(d.book_type,'compra') <> 'compra' or coalesce(d.canceled,false));

  if _dry_run then
    return jsonb_build_object('dry_run', true, 'compras_a_crear', v_ya, 'monto', v_total,
      'proveedores_a_crear', (select count(distinct p.rut_norm) from _pend p
        where not exists (select 1 from public.suppliers s
          where regexp_replace(upper(s.rut),'[^0-9K]','','g') = p.rut_norm)),
      'omitidos_anulados_o_no_compra', v_omitidos);
  end if;

  with nuevos as (
    select distinct on (p.rut_norm) p.rut_norm, p.client_code, p.prov_nombre
      from _pend p
     where not exists (select 1 from public.suppliers s
                        where regexp_replace(upper(s.rut),'[^0-9K]','','g') = p.rut_norm)
     order by p.rut_norm, p.prov_nombre
  ), ins as (
    insert into public.suppliers (name, rut, payment_terms_days, status, notes)
    select coalesce(nullif(trim(n.prov_nombre),''), n.client_code), n.client_code, 30, 'activo',
           'Creado desde la integracion con Bsale'
      from nuevos n
    returning 1
  ) select count(*) into v_prov_nuevos from ins;

  with ins as (
    insert into public.purchases (
      supplier_id, purchase_date, status, subtotal, freight_cost, other_costs, total,
      payment_method, payment_status, amount_paid, due_date, invoice_number,
      document_url, origin, notes, bsale_document_id)
    select s.id, p.emission_date, 'recibida', p.net_amount, 0, 0, p.total_amount,
           'transferencia', 'pendiente', 0,
           p.emission_date + coalesce(s.payment_terms_days, 30),
           p.number::text, p.url_pdf, 'bsale',
           'Importada desde Bsale. Sin detalle de productos: el libro de compras no lo entrega.',
           p.bsale_id
      from _pend p
      -- UNA ficha por documento. Si el RUT tiene varias (razon social + nombre
      -- de pila cargado a mano), manda la mas antigua: es la que ya carga el
      -- historial de compras, y asi el proveedor no se parte en dos.
      join lateral (
        select s2.id, s2.payment_terms_days
          from public.suppliers s2
         where regexp_replace(upper(s2.rut),'[^0-9K]','','g') = p.rut_norm
         order by s2.created_at, s2.id
         limit 1
      ) s on true
    -- Red de seguridad: que un documento repetido no bote la cadena completa.
    on conflict (bsale_document_id) where bsale_document_id is not null do nothing
    returning 1
  ) select count(*) into v_compras_nuevas from ins;

  return jsonb_build_object('ok', true, 'proveedores_creados', v_prov_nuevos,
    'compras_creadas', v_compras_nuevas, 'monto', v_total,
    'omitidos_anulados_o_no_compra', v_omitidos, 'sin_detalle_de_productos', true);
end $function$;

comment on function public.bsale_apply_purchases is
  'Vuelca el libro de compras de Bsale al ERP. Resuelve un solo proveedor por documento aunque el RUT tenga fichas repetidas.';
