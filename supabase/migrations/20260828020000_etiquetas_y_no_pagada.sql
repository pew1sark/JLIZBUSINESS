-- ============================================================
-- JLIZ BUSINESS · ETIQUETAS DE COLOR, Y "NO PAGADA" QUE DEJA LIMPIO
--
-- Dos cosas que salieron de usar la corrección de facturas de verdad.
--
-- 1. Marcar una factura como no pagada soltaba el cobro y lo dejaba «sin
--    imputar». Sonaba prudente y resultó peor: el cobro quedaba flotando en la
--    lista de pagos por asignar, alguien lo veía ahí y lo volvía a imputar a la
--    misma factura, que regresaba al estado incoherente del que se la había
--    sacado. Pasó con la 34859: se corrigió a las 00:52 y a las 03:12 estaba de
--    vuelta. Cuando alguien dice «esta factura no está pagada», el cobro que la
--    cubría no existe: ahora se borra y se informa cuál era.
--
-- 2. Revisar la cartera es un trabajo por tandas: uno encuentra cinco facturas
--    que no cuadran, no puede resolverlas en el momento —hay que llamar al
--    cliente, pedir el comprobante, esperar respuesta— y al día siguiente no se
--    acuerda de cuáles eran. La etiqueta es una marca de color con una nota
--    corta para volver a ellas. No es un estado contable: no toca la deuda, ni
--    el pago, ni ningún número.
-- ============================================================

-- ---------- 1. NO PAGADA ----------
create or replace function public.corregir_estado_factura(
  _invoice_id uuid, _estado text, _motivo text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_antes public.payment_status; v_num text;
  v_soltado numeric := 0; v_nc numeric := 0;
  v_borrados jsonb := '[]'::jsonb;
begin
  if not (public.is_admin() or public.has_perm('invoices','update')) then
    raise exception 'Sin permiso para corregir el estado de una factura';
  end if;
  if _motivo is null or length(trim(_motivo)) < 3 then
    raise exception 'Hay que decir por que se corrige el estado';
  end if;
  if _estado is not null and _estado not in ('pendiente','parcial','pagado','vencido') then
    raise exception 'Estado desconocido: %', _estado;
  end if;

  select payment_status, doc_number into v_antes, v_num
    from public.invoices where id = _invoice_id;
  if v_num is null then raise exception 'Esa factura no existe'; end if;

  update public.invoices
     set estado_forzado = _estado::public.payment_status,
         estado_forzado_motivo = case when _estado is null then null else _motivo end,
         estado_forzado_por    = case when _estado is null then null else auth.uid() end,
         estado_forzado_at     = case when _estado is null then null else now() end
   where id = _invoice_id;

  if _estado in ('pendiente', 'vencido') then
    select coalesce(sum(a.amount), 0) into v_soltado
      from public.payment_allocations a join public.payments p on p.id = a.payment_id
     where a.invoice_id = _invoice_id and p.method <> 'nota_credito';

    select coalesce(sum(a.amount), 0) into v_nc
      from public.payment_allocations a join public.payments p on p.id = a.payment_id
     where a.invoice_id = _invoice_id and p.method = 'nota_credito';

    create temp table _tocados on commit drop as
      select distinct a.payment_id
        from public.payment_allocations a join public.payments p on p.id = a.payment_id
       where a.invoice_id = _invoice_id and p.method <> 'nota_credito';

    delete from public.payment_allocations a
     using public.payments p
     where p.id = a.payment_id
       and a.invoice_id = _invoice_id
       and p.method <> 'nota_credito';

    -- Solo el cobro que se quedó sin nada imputado: si cubría además otras
    -- facturas, se le quita esta y el cobro sigue vivo con el resto.
    with vacios as (
      select p.id, p.code, p.amount, p.paid_at::date as fecha, p.notes
        from public.payments p join _tocados t on t.payment_id = p.id
       where not exists (select 1 from public.payment_allocations a where a.payment_id = p.id)
    ), reg as (
      select jsonb_agg(jsonb_build_object('cobro', code, 'monto', amount,
                                          'fecha', fecha, 'origen', notes)) as j from vacios
    ), del as (
      delete from public.payments p using vacios v where p.id = v.id returning 1
    )
    select coalesce((select j from reg), '[]'::jsonb) into v_borrados
      from (select count(*) from del) _;
  end if;

  perform public.recalc_receivable('factura', _invoice_id);

  insert into public.audit_logs (user_id, action, table_name, record_id, before, after, reason)
  values (auth.uid(), 'CORREGIR_ESTADO_FACTURA', 'invoices', _invoice_id::text,
          jsonb_build_object('estado', v_antes, 'cobros_borrados', v_borrados),
          jsonb_build_object('estado', _estado, 'forzado', _estado is not null,
                             'cobros_soltados', v_soltado), _motivo);

  return (select jsonb_build_object('ok', true, 'factura', i.doc_number,
                 'estado', i.payment_status, 'forzado', i.estado_forzado is not null,
                 'saldo', i.total - i.amount_paid,
                 'cobros_soltados', v_soltado, 'cobros_borrados', v_borrados,
                 'nota_credito_intacta', v_nc)
            from public.invoices i where i.id = _invoice_id);
end $$;

-- ---------- 2. ETIQUETAS ----------
alter table public.invoices
  add column if not exists etiqueta text,
  add column if not exists etiqueta_nota text,
  add column if not exists etiqueta_at timestamptz,
  add column if not exists etiqueta_por uuid references public.profiles(id);

do $$ begin
  alter table public.invoices add constraint invoices_etiqueta_valida
    check (etiqueta is null or etiqueta in ('revisar','problema','esperando','lista'));
exception when duplicate_object then null; end $$;

comment on column public.invoices.etiqueta is
  'Marca de color para revision manual: revisar, problema, esperando, lista. No afecta ningun calculo.';

-- Solo las etiquetadas, que son pocas: el resto de la tabla no se toca.
create index if not exists invoices_etiqueta_idx
  on public.invoices (etiqueta) where etiqueta is not null;

create or replace function public.etiquetar_factura(
  _invoice_id uuid, _etiqueta text, _nota text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_num text;
begin
  if not (public.is_admin() or public.has_perm('invoices','update')) then
    raise exception 'Sin permiso para etiquetar facturas';
  end if;
  if _etiqueta is not null and _etiqueta not in ('revisar','problema','esperando','lista') then
    raise exception 'Etiqueta desconocida: %', _etiqueta;
  end if;

  update public.invoices
     set etiqueta = _etiqueta,
         etiqueta_nota = case when _etiqueta is null then null else nullif(trim(_nota), '') end,
         etiqueta_at   = case when _etiqueta is null then null else now() end,
         etiqueta_por  = case when _etiqueta is null then null else auth.uid() end
   where id = _invoice_id
  returning doc_number into v_num;

  if v_num is null then raise exception 'Esa factura no existe'; end if;
  return jsonb_build_object('ok', true, 'factura', v_num, 'etiqueta', _etiqueta);
end $$;

revoke all on function public.etiquetar_factura(uuid, text, text) from public, anon;
grant execute on function public.etiquetar_factura(uuid, text, text) to authenticated;

-- `v_facturas_con_pago` y `v_cuentas_por_cobrar` suman `etiqueta` y
-- `etiqueta_nota` al final: la marca tiene que verse en las listas donde se
-- revisan las facturas, no solo al abrir cada una.
