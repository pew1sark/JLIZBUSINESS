-- GASTOS QUE NO PASAN POR UNA FACTURA: SUELDOS, FIJOS, VARIABLES Y CAJA CHICA
--
-- Hasta ahora Gastos mostraba solo lo que llega como documento tributario de
-- un proveedor (v_gastos_operacionales). Lo más grande del mes no está ahí: los
-- sueldos del personal, el TAG, los seguros, el lavado y el arreglo de la
-- camioneta, y la plata chica del día —colaciones, fileteo, hielo, la entrada
-- y el estacionamiento del terminal pesquero, bolsas—. Todo eso se ingresa a
-- mano y se puede corregir o borrar después.
--
-- 1. `trabajadores` — la ficha de cada persona de la planilla. No es una cuenta
--    del sistema (eso es `profiles`): la mayoría del personal no entra a la app.
-- 2. `sueldo_abonos` — cada pago a un trabajador, del mes al que corresponde:
--    sueldo final, cotizaciones, quincena, anticipo, bono u otro. Un mes puede
--    tener varios abonos del mismo tipo (dos quincenas, un anticipo extra).
-- 3. `gastos_manuales` — un gasto con fecha, hora opcional, grupo (fijo,
--    variable, insumos y caja chica), categoría, monto y forma de pago.
--
-- Sueldos es información sensible: lee y escribe solo administración
-- (`is_admin()`, que incluye a soporte) y el rol finanzas.

-- 1 · Trabajadores ------------------------------------------------------------
create table if not exists public.trabajadores (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  rut           text,
  cargo         text,
  telefono      text,
  fecha_ingreso date,
  sueldo_base   numeric(14,0) not null default 0 check (sueldo_base >= 0),
  afp           text,
  salud         text,
  banco         text,
  cuenta        text,
  activo        boolean not null default true,
  orden         int not null default 0,
  notas         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.trabajadores is
  'Ficha de cada trabajador de la planilla (no es una cuenta del sistema). Sueldo base = lo pactado por mes.';

-- 2 · Abonos de sueldo ----------------------------------------------------------
create table if not exists public.sueldo_abonos (
  id             uuid primary key default gen_random_uuid(),
  trabajador_id  uuid not null references public.trabajadores(id) on delete cascade,
  periodo        date not null check (extract(day from periodo) = 1),  -- mes al que corresponde
  tipo           text not null check (tipo in ('sueldo_final','cotizaciones','quincena','anticipo','bono','otro')),
  monto          numeric(14,0) not null check (monto > 0),
  fecha_pago     date not null default current_date,
  metodo         text not null default 'transferencia',
  detalle        text,
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists sueldo_abonos_periodo_idx on public.sueldo_abonos (periodo, trabajador_id);
create index if not exists sueldo_abonos_trabajador_idx on public.sueldo_abonos (trabajador_id, periodo desc);
comment on table public.sueldo_abonos is
  'Cada pago a un trabajador. periodo = primer día del mes al que corresponde; fecha_pago = cuándo salió la plata.';

-- 3 · Gastos manuales ---------------------------------------------------------
create table if not exists public.gastos_manuales (
  id             uuid primary key default gen_random_uuid(),
  fecha          date not null default current_date,
  hora           time,
  grupo          text not null check (grupo in ('fijo','variable','insumos')),
  categoria      text not null,
  detalle        text,
  monto          numeric(14,0) not null check (monto > 0),
  metodo         text not null default 'efectivo',
  lugar          text,
  trabajador_id  uuid references public.trabajadores(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists gastos_manuales_fecha_idx on public.gastos_manuales (fecha desc, hora desc);
create index if not exists gastos_manuales_grupo_idx on public.gastos_manuales (grupo, categoria, fecha);
comment on table public.gastos_manuales is
  'Gastos sin factura de proveedor: fijos (autopista, seguros), variables (lavado, arreglo de camioneta) e insumos y caja chica.';

-- 4 · Triggers: updated_at y auditoría ----------------------------------------
drop trigger if exists trabajadores_updated_at on public.trabajadores;
create trigger trabajadores_updated_at before update on public.trabajadores
  for each row execute function public.set_updated_at();
drop trigger if exists sueldo_abonos_updated_at on public.sueldo_abonos;
create trigger sueldo_abonos_updated_at before update on public.sueldo_abonos
  for each row execute function public.set_updated_at();
drop trigger if exists gastos_manuales_updated_at on public.gastos_manuales;
create trigger gastos_manuales_updated_at before update on public.gastos_manuales
  for each row execute function public.set_updated_at();

drop trigger if exists trabajadores_audit on public.trabajadores;
create trigger trabajadores_audit after insert or update or delete on public.trabajadores
  for each row execute function public.audit_row();
drop trigger if exists sueldo_abonos_audit on public.sueldo_abonos;
create trigger sueldo_abonos_audit after insert or update or delete on public.sueldo_abonos
  for each row execute function public.audit_row();
drop trigger if exists gastos_manuales_audit on public.gastos_manuales;
create trigger gastos_manuales_audit after insert or update or delete on public.gastos_manuales
  for each row execute function public.audit_row();

-- 5 · Seguridad -----------------------------------------------------------------
create or replace function public.puede_gastos()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or coalesce(public.auth_role() = 'finanzas', false);
$$;
revoke all on function public.puede_gastos() from public, anon;
grant execute on function public.puede_gastos() to authenticated;

alter table public.trabajadores    enable row level security;
alter table public.sueldo_abonos   enable row level security;
alter table public.gastos_manuales enable row level security;

revoke all on public.trabajadores, public.sueldo_abonos, public.gastos_manuales from anon;
grant select, insert, update, delete on public.trabajadores, public.sueldo_abonos, public.gastos_manuales to authenticated;

drop policy if exists trabajadores_gastos on public.trabajadores;
create policy trabajadores_gastos on public.trabajadores for all to authenticated
  using (public.puede_gastos()) with check (public.puede_gastos());
drop policy if exists sueldo_abonos_gastos on public.sueldo_abonos;
create policy sueldo_abonos_gastos on public.sueldo_abonos for all to authenticated
  using (public.puede_gastos()) with check (public.puede_gastos());
drop policy if exists gastos_manuales_gastos on public.gastos_manuales;
create policy gastos_manuales_gastos on public.gastos_manuales for all to authenticated
  using (public.puede_gastos()) with check (public.puede_gastos());

-- 6 · Las ocho fichas de la planilla, para completar desde la pantalla --------
insert into public.trabajadores (nombre, orden)
select 'Trabajador ' || n, n from generate_series(1, 8) n
where not exists (select 1 from public.trabajadores);
