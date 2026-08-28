-- ============================================================
-- JLIZ BUSINESS · EL ROL DE SOPORTE
--
-- Hasta ahora «administrador» significaba dos cosas a la vez: quien manda en el
-- negocio —precios, plazos, cuentas, cobranza— y quien mantiene el sistema
-- —integraciones, tokens, fecha de corte del análisis—. Los cuatro
-- administradores de la empresa veían y podían tocar lo segundo, que no es su
-- trabajo y donde un cambio distraído rompe la sincronización o saca datos de
-- los informes sin que nadie entienda por qué.
--
-- `soporte` es un superconjunto de `admin`: puede todo lo de un administrador y
-- además lo técnico. Así nadie de la empresa pierde nada de lo suyo, y lo de
-- desarrollo queda en un solo par de manos.
-- ============================================================

alter type public.app_role add value if not exists 'soporte';

-- (en una migración aparte, porque un valor de enum no se puede usar en la
--  misma transacción en que se agrega)

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.auth_role() in ('admin', 'soporte'), false);
$$;

create or replace function public.is_soporte()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(public.auth_role() = 'soporte', false);
$$;

comment on function public.is_soporte is
  'Quien mantiene el sistema. Puede todo lo de un administrador y ademas lo tecnico.';

revoke all on function public.is_soporte() from public, anon;
grant execute on function public.is_soporte() to authenticated;

-- `role_permissions` no tiene filas para admin: `has_perm()` corta antes con
-- `is_admin()`. Soporte pasa por la misma puerta, así que tampoco necesita.

update public.profiles set role = 'soporte'
 where lower(email) = 'sarkgraff@gmail.com';

-- ---------- EL PULSO DEL SISTEMA ----------
-- Una sola llamada con lo que hay que mirar: qué módulo corrió, cuándo, si
-- falló, y cuatro chequeos de integridad. Se calcula en vivo porque son
-- consultas baratas y un panel que muestra datos viejos es peor que no tenerlo.
create or replace function public.soporte_estado()
returns jsonb language plpgsql stable security definer set search_path to 'public, extensions' as $$
declare v jsonb;
begin
  if not public.is_soporte() then
    raise exception 'Este panel es del soporte tecnico';
  end if;

  select jsonb_build_object(
    'bsale', jsonb_build_object(
      'conexion_activa', exists (select 1 from public.bsale_connections where status = 'activa'),
      'ultima_sync', (select max(last_sync_at) from public.bsale_connections),
      'ultimo_error', (select last_error from public.bsale_connections
                        where status = 'activa' order by created_at limit 1)),

    'cron', jsonb_build_object(
      'total',   (select count(*) from cron.job),
      'activos', (select count(*) from cron.job where active),
      'fallos_24h', (select count(*) from cron.job_run_details
                      where status <> 'succeeded' and start_time > now() - interval '24 hours')),

    'notas_credito', jsonb_build_object(
      'total', (select count(*) from public.invoices where doc_type = 'nota_credito'),
      'sin_resolver', (select count(*) from public.bsale_sales_documents
                        where code_sii = 61 and ref_folio is null),
      'a_favor_clientes', (select count(*) from public.v_notas_credito_pendientes)),

    'datos', jsonb_build_object(
      'facturas', (select count(*) from public.invoices),
      'clientes', (select count(*) from public.customers where status = 'activo'),
      'cobros',   (select count(*) from public.payments where direction = 'cobro'),
      'pagos_descuadrados', (select count(*) from public.payments p
                              join public.payment_allocations a on a.payment_id = p.id
                              join public.invoices i on i.id = a.invoice_id
                             where i.customer_id <> p.customer_id)),

    'integridad', jsonb_build_object(
      -- Los dos primeros deberían dar siempre cero: son datos rotos, no estados.
      'facturas_sobrepagadas', (select count(*) from public.invoices
                                 where doc_type = 'factura' and amount_paid > total + 1),
      'pagos_de_otro_cliente', (select count(*) from public.payments p
                                 join public.payment_allocations a on a.payment_id = p.id
                                 join public.invoices i on i.id = a.invoice_id
                                where i.customer_id <> p.customer_id),
      -- Estos dos son informativos: pueden ser legítimos.
      'cobros_sin_imputar', (select count(*) from public.v_pagos_sin_imputar),
      'monto_sin_imputar', (select coalesce(sum(sin_imputar), 0) from public.v_pagos_sin_imputar),
      'estados_forzados', (select count(*) from public.invoices where estado_forzado is not null))
  ) into v;

  return v;
end $$;

revoke all on function public.soporte_estado() from public, anon;
grant execute on function public.soporte_estado() to authenticated;
