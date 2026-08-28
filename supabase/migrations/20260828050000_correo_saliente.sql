-- ============================================================
-- JLIZ BUSINESS · CORREO SALIENTE DE LA EMPRESA
--
-- El reporte de cobro solo se podía mandar por WhatsApp, abriendo la aplicación
-- con el mensaje escrito. Para el contacto de finanzas de un restaurante el
-- canal natural suele ser el correo, y el reporte tiene que salir SIEMPRE desde
-- la casilla de la empresa —no desde la cuenta personal de quien lo envía— para
-- que el cliente reconozca el remitente y las respuestas lleguen a un solo
-- lugar.
--
-- Eso obliga a que el envío pase por el servidor: el navegador no puede
-- autenticarse como la casilla de la empresa sin tener su clave, y esa clave no
-- puede bajar al navegador. Vive en Vault, como el token de Bsale: la escribe
-- soporte una vez y desde ahí cualquier administrador manda correos sin
-- conocerla.
--
-- Es una contraseña de aplicación de Gmail —16 letras que genera Google en una
-- cuenta con verificación en dos pasos—, no la contraseña de la casilla. Sirve
-- solo para enviar correo y se puede revocar sin tocar la contraseña real.
-- ============================================================

create or replace function public.correo_clave_set(_valor text)
returns uuid language plpgsql security definer set search_path to 'public, vault' as $$
declare v_id uuid;
begin
  if not public.is_soporte() then
    raise exception 'Solo el soporte tecnico configura el correo saliente';
  end if;
  delete from vault.secrets where name = 'correo_app_password';
  select vault.create_secret(_valor, 'correo_app_password',
                             'Contrasena de aplicacion de Gmail para enviar como la empresa')
    into v_id;
  return v_id;
end $$;

-- Sin grant a `authenticated`: solo la Edge Function, con la llave de servicio.
create or replace function public.correo_clave_get()
returns text language sql stable security definer set search_path to 'public, vault' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'correo_app_password' limit 1;
$$;

revoke all on function public.correo_clave_set(text) from public, anon;
revoke all on function public.correo_clave_get() from public, anon, authenticated;
grant execute on function public.correo_clave_set(text) to authenticated;

create or replace function public.correo_estado()
returns jsonb language sql stable security definer set search_path to 'public, vault' as $$
  select jsonb_build_object(
    'configurado', exists (select 1 from vault.secrets where name = 'correo_app_password'),
    'remitente', (select value->>'correo_saliente' from public.settings where key = 'empresa'));
$$;
revoke all on function public.correo_estado() from public, anon;
grant execute on function public.correo_estado() to authenticated;

-- ---------- REGISTRO DE LO ENVIADO ----------
-- Un cobro enviado es un hecho comercial: hay que poder responder «¿cuándo se
-- le avisó a este cliente y a quién?» sin depender de la memoria de nadie. Los
-- envíos fallidos también se guardan, con su error.
create table if not exists public.correos_enviados (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  asunto text not null,
  destinatarios text[] not null,
  cuerpo text,
  tipo text not null default 'reporte_cobro',
  enviado_por uuid references public.profiles(id),
  enviado_at timestamptz not null default now(),
  error text
);

create index if not exists correos_enviados_cliente_idx
  on public.correos_enviados (customer_id, enviado_at desc);

alter table public.correos_enviados enable row level security;

drop policy if exists correos_enviados_lectura on public.correos_enviados;
create policy correos_enviados_lectura on public.correos_enviados
  for select to authenticated using (public.is_admin() or public.has_perm('payments','read'));

drop policy if exists correos_enviados_escritura on public.correos_enviados;
create policy correos_enviados_escritura on public.correos_enviados
  for insert to authenticated with check (public.is_admin());

comment on table public.correos_enviados is
  'Bitacora de los correos que salen del sistema: a quien, cuando y quien lo mando.';

update public.settings
   set value = value || jsonb_build_object('correo_saliente', 'pescaderiabilagay@gmail.com')
 where key = 'empresa'
   and coalesce(value->>'correo_saliente', '') = '';
