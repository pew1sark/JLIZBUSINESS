-- ============================================================
-- JLIZ BUSINESS · CERRAR LAS FUNCIONES A LOS VISITANTES SIN SESIÓN
--
-- La migración `05_harden_function_grants` ya había quitado `execute` a `anon`
-- en todas las funciones de entonces. El problema es que no dejó cerrada la
-- puerta: cada función nueva del esquema `public` nace con `execute` para
-- `anon` —Supabase instala un privilegio por defecto que lo concede— y además
-- con `execute` para PUBLIC, que es el default de Postgres y del que `anon`
-- también hereda. Así que todas las funciones creadas después de esa migración
-- —que son la mayoría del sistema— volvieron a quedar abiertas sin que nadie
-- lo escribiera ni lo notara.
--
-- Qué quedaba expuesto, con la clave publicable que viaja en el bundle del
-- navegador y por lo tanto es pública:
--
--   · `panel_series`     — la venta, la compra y el margen diario del negocio
--   · `panel_clientes`   — nombres de clientes, cuánto compró cada uno y su saldo
--   · `panel_productos`  — el ranking de productos con montos
--   · `recalc_receivable` y `auto_allocate_payment` — funciones que ESCRIBEN,
--     sin ninguna guarda interna (piden un uuid, que no se puede adivinar, pero
--     no tienen por qué estar al alcance de un visitante)
--
-- El resto de las funciones abiertas sí tenía guarda propia (`is_admin()`,
-- `has_perm()`, `puede_importar()`): un visitante sin sesión no pasa de la
-- primera línea. Igual se cierran, porque el permiso no debe depender de que
-- cada función se acuerde de revisarlo.
--
-- Se hace en bloque y sobre todas las funciones del esquema, no sobre una lista
-- escrita a mano: una lista se desactualiza en la siguiente migración.
-- ============================================================

do $$
declare
  f record;
  -- Las únicas que un visitante sin cuenta tiene que poder llamar: los tres
  -- formularios por token —el portal de pagos del cliente, el levantamiento y
  -- la carga del catálogo—. Todas validan el token adentro.
  publicas constant text[] := array[
    'portal_get', 'portal_report_payment',
    'survey_get', 'survey_save', 'survey_submit',
    'intake_get', 'intake_save_row', 'intake_delete_row'
  ];
  n_total int := 0;
  n_anon  int := 0;
begin
  for f in
    select p.oid::regprocedure as firma, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      -- Nada instalado por una extensión: revocarle permisos a eso rompe la
      -- extensión y no es nuestro. Hoy no hay ninguna en `public`, pero la
      -- migración tiene que seguir siendo segura si mañana la hay.
      left join pg_depend d on d.objid = p.oid and d.deptype = 'e'
     where n.nspname = 'public'
       and p.prokind = 'f'
       and d.objid is null
     order by p.proname
  loop
    execute format('revoke all on function %s from public, anon', f.firma);
    -- Se le devuelve a quien ya lo tenía de hecho: esto cierra a `anon`, no
    -- cambia nada para un usuario con sesión ni para el backend.
    execute format('grant execute on function %s to authenticated, service_role', f.firma);
    n_total := n_total + 1;

    if f.proname = any(publicas) then
      execute format('grant execute on function %s to anon', f.firma);
      n_anon := n_anon + 1;
    end if;
  end loop;

  raise notice 'Funciones cerradas: %. Abiertas a anon a propósito: %.', n_total, n_anon;
end $$;

-- ---------- QUE NO SE VUELVA A ABRIR SOLA ----------
--
-- `alter default privileges … revoke execute … from anon, public` deja bien la
-- fila de `pg_default_acl` (queda en postgres/authenticated/service_role), pero
-- NO alcanza: comprobado en este proyecto, una función creada después igual
-- nace con `=X` —el `execute` de PUBLIC del default de Postgres, que la fila
-- del esquema no logra sacar—, y de PUBLIC hereda `anon`. Así que se deja
-- igual, porque saca el `anon=X` explícito y no cuesta nada, pero la puerta la
-- cierra de verdad el disparador de abajo.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges in schema public revoke execute on functions from public;

-- El disparador es lo único que garantiza que una función nueva nazca cerrada
-- sin que nadie tenga que acordarse. Corre después de cada CREATE/ALTER
-- FUNCTION del esquema `public` y le deja los permisos que corresponden.
create or replace function public.trg_cerrar_funcion_nueva()
returns event_trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  cmd    record;
  nombre text;
  publicas constant text[] := array[
    'portal_get', 'portal_report_payment',
    'survey_get', 'survey_save', 'survey_submit',
    'intake_get', 'intake_save_row', 'intake_delete_row'
  ];
begin
  for cmd in select * from pg_event_trigger_ddl_commands() loop
    continue when cmd.object_type <> 'function'
              or cmd.schema_name is distinct from 'public';

    select p.proname into nombre from pg_proc p where p.oid = cmd.objid;
    continue when nombre is null or nombre = any(publicas);

    execute format('revoke all on function %s from public, anon', cmd.objid::regprocedure);
    execute format('grant execute on function %s to authenticated, service_role',
                   cmd.objid::regprocedure);
  end loop;
exception when others then
  -- Un problema acá no puede voltear una migración: se avisa y se sigue. El
  -- chequeo de integridad de /soporte es la red que atrapa lo que se escape.
  raise warning 'No se pudieron cerrar los permisos de la función nueva: %', sqlerrm;
end $fn$;

comment on function public.trg_cerrar_funcion_nueva is
  'Cierra a anon y a PUBLIC cada función nueva de public, salvo las ocho que atienden a visitantes por token. Existe porque el privilegio por defecto del proyecto las abre solas.';

drop event trigger if exists cerrar_funcion_nueva;
create event trigger cerrar_funcion_nueva
  on ddl_command_end
  when tag in ('CREATE FUNCTION', 'ALTER FUNCTION')
  execute function public.trg_cerrar_funcion_nueva();

-- La función del disparador se crea antes de que el disparador exista, así que
-- nadie la cierra. No es invocable desde la API —devuelve `event_trigger`—,
-- pero se cierra igual para que la auditoría no muestre una excepción que no lo es.
revoke all on function public.trg_cerrar_funcion_nueva() from public, anon;
grant execute on function public.trg_cerrar_funcion_nueva() to service_role;

-- Comprobación de lo que queda: 8 funciones abiertas a `anon` (las tres
-- pantallas por token), ninguna abierta a PUBLIC.
--
--   select count(*) filter (where has_function_privilege('anon', p.oid, 'execute')) as anon,
--          count(*) filter (where has_function_privilege('public', p.oid, 'execute')) as publico
--     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.prokind = 'f';
