-- ============================================================
-- JLIZ BUSINESS · 01 CORE
-- Enums, perfiles, roles/permisos, auditoría, notificaciones,
-- configuración y funciones de seguridad (RLS helpers).
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- ENUMS ----------
create type public.app_role as enum ('admin','ventas','compras','inventario','empaque','reparto');
create type public.entity_status as enum ('activo','inactivo','archivado');
create type public.unit_measure as enum ('kg','g','unidad','caja','bandeja');
create type public.order_status as enum ('nuevo','confirmado','en_preparacion','preparado','en_reparto','entregado','cancelado');
create type public.payment_status as enum ('pendiente','parcial','pagado','vencido');
create type public.payment_method as enum ('efectivo','transferencia','tarjeta','cheque','credito','otro');
create type public.purchase_status as enum ('borrador','recibida','anulada');
create type public.lot_status as enum ('disponible','agotado','vencido','bloqueado');
create type public.movement_type as enum ('entrada_compra','ajuste_positivo','salida_venta','reserva','liberacion_reserva','merma','ajuste_negativo','devolucion','traslado');
create type public.customer_type as enum ('particular','restaurante','hotel','supermercado','mayorista','distribuidor','otro');
create type public.delivery_status as enum ('pendiente','asignada','en_camino','entregada','fallida');
create type public.loss_reason as enum ('merma_proceso','dano','vencimiento','diferencia_peso','robo','devolucion','otro');
create type public.task_status as enum ('pendiente','en_proceso','completada','cancelada');

-- ---------- PROFILES ----------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text not null default '',
  phone        text,
  avatar_url   text,
  role         public.app_role not null default 'ventas',
  is_active    boolean not null default true,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.profiles is 'Usuarios del sistema (trabajadores y administradores).';

-- ---------- ROLES / PERMISOS ----------
create table public.role_permissions (
  role     public.app_role not null,
  resource text not null,
  action   text not null check (action in ('read','create','update','delete','approve')),
  primary key (role, resource, action)
);
comment on table public.role_permissions is 'Matriz de permisos por rol. admin tiene acceso total implícito.';

-- ---------- CONFIGURACIÓN ----------
create table public.settings (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  description text,
  updated_at  timestamptz not null default now()
);

-- ---------- AUDITORÍA ----------
create table public.audit_logs (
  id          bigserial primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  user_email  text,
  action      text not null,           -- INSERT | UPDATE | DELETE | acción de negocio
  table_name  text not null,
  record_id   text,
  before      jsonb,
  after       jsonb,
  changes     jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);
create index audit_logs_table_idx  on public.audit_logs (table_name, created_at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);
create index audit_logs_user_idx   on public.audit_logs (user_id, created_at desc);

-- ---------- NOTIFICACIONES ----------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references public.profiles(id) on delete cascade,  -- null = dirigida a un rol
  target_role public.app_role,
  title       text not null,
  body        text,
  kind        text not null default 'info',   -- info | warning | danger | success
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_role_idx on public.notifications (target_role, created_at desc);

-- ============================================================
-- FUNCIONES DE SEGURIDAD
-- ============================================================
create or replace function public.auth_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.is_active;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.auth_role() = 'admin', false);
$$;

create or replace function public.has_perm(_resource text, _action text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.role_permissions rp
    where rp.role = public.auth_role()
      and rp.resource = _resource
      and rp.action  = _action
  );
$$;

create or replace function public.is_authenticated()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
$$;

-- ============================================================
-- TRIGGERS GENÉRICOS
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Auditoría genérica: se adjunta a las tablas críticas.
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_before jsonb;
  v_after  jsonb;
  v_id     text;
  v_email  text;
begin
  if (tg_op = 'DELETE') then
    v_before := to_jsonb(old); v_after := null; v_id := old.id::text;
  elsif (tg_op = 'UPDATE') then
    v_before := to_jsonb(old); v_after := to_jsonb(new); v_id := new.id::text;
    if v_before = v_after then return new; end if;
  else
    v_before := null; v_after := to_jsonb(new); v_id := new.id::text;
  end if;

  select email into v_email from public.profiles where id = auth.uid();

  insert into public.audit_logs (user_id, user_email, action, table_name, record_id, before, after, changes)
  values (
    auth.uid(), v_email, tg_op, tg_table_name, v_id, v_before, v_after,
    case when tg_op = 'UPDATE' then (
      select jsonb_object_agg(k, jsonb_build_object('antes', v_before->k, 'despues', v_after->k))
      from jsonb_object_keys(v_after) k
      where v_before->k is distinct from v_after->k and k not in ('updated_at')
    ) end
  );
  return coalesce(new, old);
end $$;

-- Alta automática de perfil al registrar un usuario en auth.users.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role public.app_role;
begin
  -- El primer usuario del sistema es administrador.
  if not exists (select 1 from public.profiles) then
    v_role := 'admin';
  else
    v_role := coalesce((new.raw_user_meta_data->>'role')::public.app_role, 'ventas');
  end if;

  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    new.raw_user_meta_data->>'phone',
    v_role
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();
create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function public.audit_row();

-- ============================================================
-- RLS
-- ============================================================
alter table public.profiles         enable row level security;
alter table public.role_permissions enable row level security;
alter table public.settings         enable row level security;
alter table public.audit_logs       enable row level security;
alter table public.notifications    enable row level security;

-- profiles: cada usuario ve su perfil; admin ve y administra todos.
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = auth.uid() or public.has_perm('workers','read'));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid() and role = (select role from public.profiles where id = auth.uid()));
create policy profiles_admin_all on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- role_permissions: lectura para autenticados, escritura solo admin.
create policy role_perms_read on public.role_permissions for select to authenticated
  using (public.is_authenticated());
create policy role_perms_admin on public.role_permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- settings: lectura autenticados, escritura admin.
create policy settings_read on public.settings for select to authenticated
  using (public.is_authenticated());
create policy settings_admin on public.settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- audit_logs: solo lectura y solo con permiso; nadie los modifica ni borra.
create policy audit_read on public.audit_logs for select to authenticated
  using (public.has_perm('audit','read'));

-- notifications: el destinatario o su rol.
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid() or target_role = public.auth_role() or public.is_admin());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid() or target_role = public.auth_role() or public.is_admin())
  with check (true);
create policy notifications_insert on public.notifications for insert to authenticated
  with check (public.is_authenticated());
create policy notifications_delete on public.notifications for delete to authenticated
  using (public.is_admin());

-- ============================================================
-- MATRIZ DE PERMISOS POR DEFECTO
-- ============================================================
insert into public.role_permissions (role, resource, action) values
  -- VENTAS
  ('ventas','customers','read'),('ventas','customers','create'),('ventas','customers','update'),
  ('ventas','orders','read'),('ventas','orders','create'),('ventas','orders','update'),
  ('ventas','products','read'),('ventas','inventory','read'),('ventas','payments','read'),
  ('ventas','payments','create'),('ventas','price_lists','read'),('ventas','deliveries','read'),
  ('ventas','reports','read'),
  -- COMPRAS
  ('compras','suppliers','read'),('compras','suppliers','create'),('compras','suppliers','update'),
  ('compras','purchases','read'),('compras','purchases','create'),('compras','purchases','update'),
  ('compras','products','read'),('compras','products','create'),
  ('compras','inventory','read'),('compras','lots','read'),('compras','lots','create'),
  -- INVENTARIO / BODEGA
  ('inventario','inventory','read'),('inventario','inventory','update'),
  ('inventario','lots','read'),('inventario','lots','create'),('inventario','lots','update'),
  ('inventario','products','read'),('inventario','losses','read'),('inventario','losses','create'),
  ('inventario','orders','read'),('inventario','orders','update'),
  ('inventario','purchases','read'),('inventario','movements','read'),('inventario','movements','create'),
  -- EMPAQUE
  ('empaque','orders','read'),('empaque','orders','update'),
  ('empaque','products','read'),('empaque','inventory','read'),('empaque','lots','read'),
  ('empaque','losses','create'),('empaque','losses','read'),
  -- REPARTO
  ('reparto','deliveries','read'),('reparto','deliveries','update'),
  ('reparto','orders','read'),('reparto','customers','read'),
  ('reparto','payments','create'),('reparto','routes','read')
on conflict do nothing;

insert into public.settings (key, value, description) values
  ('empresa', jsonb_build_object(
      'nombre','JLIZ Distribuidora de Pescado Fresco',
      'rut','', 'direccion','', 'telefono','', 'email','', 'moneda','CLP'),
   'Datos de la empresa'),
  ('operacion', jsonb_build_object(
      'iva', 19, 'dias_credito_default', 30, 'alerta_stock_bajo', true,
      'permitir_stock_negativo', false),
   'Parámetros operativos')
on conflict (key) do nothing;
