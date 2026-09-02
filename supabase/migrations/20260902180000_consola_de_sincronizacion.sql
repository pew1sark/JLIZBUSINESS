-- ============================================================
-- JLIZ BUSINESS · CONSOLA DE SINCRONIZACIÓN
--
-- Hasta ahora, que el cron de Bsale se cayera no se notaba: el panel de
-- Soporte mostraba "Conectada" y la última fecha de sincronización, pero nada
-- decía que las últimas once corridas habían terminado en error. Había que
-- entrar a la base a mirar `bsale_sync_runs` para enterarse.
--
-- `bsale_monitor()` responde de una sola vez las preguntas de esa consola:
-- cómo está ahora, hace cuánto que no entra nada, cuántas corridas seguidas
-- fallaron, qué quedó sin volcar y el registro de las últimas corridas.
--
-- El estado se juzga SOLO con las corridas automáticas: una sincronización
-- manual desde la aplicación no prueba que el trabajo programado siga vivo.
-- El registro, en cambio, muestra todo, con su origen a la vista.
-- ============================================================

create or replace function public.bsale_monitor(_limite int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public, extensions'
as $function$
declare
  v_ultima public.bsale_sync_runs%rowtype;
  v_ok     timestamptz;
  v_fallas int;
  v_estado text;
  v_job    record;
begin
  if not public.is_soporte() then
    raise exception 'Esta consola es del soporte tecnico';
  end if;

  select * into v_ultima
    from public.bsale_sync_runs
   where trigger = 'cron'
   order by started_at desc
   limit 1;

  select max(coalesce(finished_at, started_at)) into v_ok
    from public.bsale_sync_runs
   where trigger = 'cron' and status = 'ok';

  -- Cuántas van seguidas: los errores posteriores a la última corrida buena.
  select count(*) into v_fallas
    from public.bsale_sync_runs
   where trigger = 'cron' and status = 'error'
     and started_at > coalesce(v_ok, '-infinity'::timestamptz);

  select j.active, j.schedule into v_job
    from cron.job j where j.jobname = 'bsale-sync-30min';

  v_estado := case
    -- 'trabada' es distinto de 'caida': la corrida arrancó y nunca cerró, que
    -- es lo que pasa cuando la funcion muere sin alcanzar a registrar el error.
    when v_ultima.id is null                                        then 'sin_datos'
    when v_ultima.status = 'corriendo'
     and v_ultima.started_at > now() - interval '5 minutes'         then 'corriendo'
    when v_ultima.status = 'corriendo'                              then 'trabada'
    when v_ultima.status = 'error'                                  then 'caida'
    when coalesce(v_job.active, false) = false                      then 'apagada'
    -- Dos ciclos de 30 minutos y un margen: si no entro nada en ese rato, el
    -- trabajo programado dejo de dispararse aunque la ultima haya salido bien.
    when v_ok is null or v_ok < now() - interval '70 minutes'       then 'atrasada'
    else 'ok'
  end;

  return jsonb_build_object(
    'ahora',   now(),
    'estado',  v_estado,
    'fallas_seguidas', v_fallas,
    'ultima_ok', v_ok,
    'proxima', date_trunc('hour', now())
               + interval '30 minutes' * (floor(extract(minute from now()) / 30) + 1),

    'job', jsonb_build_object(
      'activo',   coalesce(v_job.active, false),
      'schedule', v_job.schedule,
      'ultimo_disparo', (select max(d.start_time) from cron.job_run_details d
                          join cron.job j on j.jobid = d.jobid
                         where j.jobname = 'bsale-sync-30min'),
      'fallos_disparo_24h', (select count(*) from cron.job_run_details d
                              join cron.job j on j.jobid = d.jobid
                             where j.jobname = 'bsale-sync-30min'
                               and d.status <> 'succeeded'
                               and d.start_time > now() - interval '24 hours')),

    'ultima', case when v_ultima.id is null then null else jsonb_build_object(
      'id', v_ultima.id, 'resource', v_ultima.resource, 'status', v_ultima.status,
      'started_at', v_ultima.started_at, 'finished_at', v_ultima.finished_at,
      'records_saved', v_ultima.records_saved, 'records_read', v_ultima.records_read,
      'error', v_ultima.error) end,

    'resumen_24h', (select jsonb_build_object(
        'corridas',  count(*),
        'ok',        count(*) filter (where status = 'ok'),
        'error',     count(*) filter (where status = 'error'),
        'guardados', coalesce(sum(records_saved), 0))
      from public.bsale_sync_runs where started_at > now() - interval '24 hours'),

    'pendientes', jsonb_build_object(
      'compras_sin_volcar', (select count(*) from public.bsale_third_party_documents d
         where coalesce(d.book_type, 'compra') = 'compra'
           and coalesce(d.canceled, false) = false
           and coalesce(d.client_code, '') <> ''
           and not exists (select 1 from public.purchases p
                            where p.bsale_document_id = d.bsale_id)),
      'xml_sin_leer', (select count(*) from public.bsale_third_party_documents
         where xml_synced_at is null and url_xml is not null),
      'xml_con_error', (select count(*) from public.bsale_third_party_documents
         where xml_error is not null)),

    'corridas', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.started_at desc), '[]'::jsonb)
        from (
          select r.id, r.resource, r.trigger, r.status, r.started_at, r.finished_at,
                 round(extract(epoch from (r.finished_at - r.started_at))::numeric, 1) as segundos,
                 r.records_saved, r.records_read, r.error
            from public.bsale_sync_runs r
           order by r.started_at desc
           limit greatest(1, least(coalesce(_limite, 20), 100))
        ) c)
  );
end $function$;

comment on function public.bsale_monitor is
  'Estado en vivo de la sincronizacion con Bsale para la consola de Soporte: como esta, hace cuanto, que quedo pendiente y el registro de las ultimas corridas.';

-- ---------- TIEMPO REAL ----------
-- La publicación de Realtime estaba vacía: la campana de notificaciones ya se
-- suscribía a `notifications` desde el primer día, pero como la tabla nunca se
-- publicó, ese canal no recibía nada y todo llegaba por el refresco de cada
-- minuto. Se publican las dos tablas: la consola necesita ver la corrida en el
-- momento en que ocurre, y la campana empieza a funcionar como estaba escrita.
-- Ambas siguen filtradas por RLS: Realtime no entrega filas que el usuario no
-- podría leer con un select.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'bsale_sync_runs') then
    alter publication supabase_realtime add table public.bsale_sync_runs;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime'
                    and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
