-- ============================================================
-- JLIZ BUSINESS · CUENTAS POR COBRAR
-- Documentos tributarios de venta, imputación de pagos y
-- portal de pagos del cliente.
--
-- Problema que resuelve: hasta ahora un pago solo podía apuntar
-- a un documento (payments.order_id XOR opening_receivable_id).
-- Cuando un cliente transfiere un monto que cubre varias
-- facturas -- o paga sin decir cuál -- no había dónde
-- registrarlo. payment_allocations rompe esa restricción:
-- un pago se reparte entre N documentos y lo que sobra queda
-- como saldo a favor del cliente.
-- ============================================================

create type public.doc_type as enum ('factura','boleta','nota_credito','nota_debito');

-- ---------- DOCUMENTOS DE VENTA ----------
-- Las facturas se emiten en el sistema de facturación electrónica
-- y entran acá por importación; el pedido interno es opcional.
create table public.invoices (
  id                 uuid primary key default gen_random_uuid(),
  code               text not null default next_code('DOC'),
  doc_type           public.doc_type not null default 'factura',
  doc_number         text not null,
  customer_id        uuid not null references public.customers(id) on delete restrict,
  order_id           uuid references public.orders(id) on delete set null,
  issued_at          date not null,
  due_date           date,
  net_amount         numeric(14,2) not null default 0,
  tax_amount         numeric(14,2) not null default 0,
  total              numeric(14,2) not null default 0,  -- firmado: la nota de crédito es negativa
  cost_total         numeric(14,2) not null default 0,
  amount_paid        numeric(14,2) not null default 0,
  payment_status     public.payment_status not null default 'pendiente',
  source             text not null default 'manual' check (source in ('manual','importado','pedido')),
  related_doc_number text,                               -- NC/ND -> factura de referencia
  salesperson        text,
  branch             text,
  external_ref       text,
  notes              text,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (doc_type, doc_number)
);
comment on table public.invoices is 'Documentos tributarios de venta (facturas, notas de crédito y débito). El saldo es total - amount_paid.';

create index invoices_customer_idx on public.invoices (customer_id, issued_at desc);
create index invoices_due_idx      on public.invoices (due_date) where payment_status <> 'pagado';
create index invoices_status_idx   on public.invoices (payment_status);
create index invoices_number_idx   on public.invoices (doc_number);

create table public.invoice_items (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices(id) on delete cascade,
  line_no        int not null default 1,
  product_id     uuid references public.products(id) on delete set null,
  sku            text,
  description    text not null,
  variant        text,
  category       text,
  quantity       numeric(12,3) not null default 0,
  unit_price_net numeric(14,4) not null default 0,
  net_total      numeric(14,2) not null default 0,
  tax_total      numeric(14,2) not null default 0,
  gross_total    numeric(14,2) not null default 0,
  unit_cost_net  numeric(14,4) not null default 0,
  cost_total     numeric(14,2) not null default 0
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index invoice_items_product_idx on public.invoice_items (product_id);

-- ---------- IMPUTACIÓN DE PAGOS ----------
-- Un pago (una transferencia real) se reparte entre varios documentos.
create table public.payment_allocations (
  id                    uuid primary key default gen_random_uuid(),
  payment_id            uuid not null references public.payments(id) on delete cascade,
  invoice_id            uuid references public.invoices(id) on delete cascade,
  order_id              uuid references public.orders(id) on delete cascade,
  opening_receivable_id uuid references public.opening_receivables(id) on delete cascade,
  amount                numeric(14,2) not null check (amount > 0),
  created_at            timestamptz not null default now(),
  created_by            uuid references public.profiles(id) on delete set null,
  constraint alloc_un_solo_destino check (
    (invoice_id is not null)::int
  + (order_id is not null)::int
  + (opening_receivable_id is not null)::int = 1
  )
);
comment on table public.payment_allocations is 'Reparte un pago entre los documentos que cubre. Lo no imputado queda como saldo a favor del cliente.';

create index alloc_payment_idx  on public.payment_allocations (payment_id);
create index alloc_invoice_idx  on public.payment_allocations (invoice_id);
create index alloc_order_idx    on public.payment_allocations (order_id);
create index alloc_opening_idx  on public.payment_allocations (opening_receivable_id);

-- Un pago puede existir sin documento asociado (pago a cuenta).
create index if not exists payments_customer_idx on public.payments (customer_id, paid_at desc);

-- ---------- PORTAL DEL CLIENTE ----------
create table public.customer_portal_tokens (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers(id) on delete cascade,
  token        text not null unique default encode(gen_random_bytes(16), 'hex'),
  is_active    boolean not null default true,
  view_count   int not null default 0,
  last_seen_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
comment on table public.customer_portal_tokens is 'Enlace personal de cada cliente al portal de pagos. Se envía por WhatsApp y se puede revocar.';
create unique index portal_token_cliente_activo on public.customer_portal_tokens (customer_id) where is_active;

-- El cliente avisa "ya transferí"; cobranza confirma y recién ahí se imputa.
create table public.payment_reports (
  id            uuid primary key default gen_random_uuid(),
  code          text not null default next_code('AVI'),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  amount        numeric(14,2) not null check (amount > 0),
  method        public.payment_method not null default 'transferencia',
  paid_at       date not null,
  reference     text,
  invoice_ids   uuid[] not null default '{}',
  notes         text,
  status        text not null default 'pendiente' check (status in ('pendiente','confirmado','rechazado')),
  payment_id    uuid references public.payments(id) on delete set null,
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  review_notes  text,
  created_at    timestamptz not null default now()
);
create index payment_reports_status_idx on public.payment_reports (status, created_at desc);
create index payment_reports_customer_idx on public.payment_reports (customer_id, created_at desc);

-- ---------- RLS ----------
alter table public.invoices               enable row level security;
alter table public.invoice_items          enable row level security;
alter table public.payment_allocations    enable row level security;
alter table public.customer_portal_tokens enable row level security;
alter table public.payment_reports        enable row level security;

create policy invoices_read   on public.invoices for select using (public.has_perm('invoices','read') or public.is_admin());
create policy invoices_insert on public.invoices for insert with check (public.has_perm('invoices','create') or public.is_admin());
create policy invoices_update on public.invoices for update using (public.has_perm('invoices','update') or public.is_admin())
                                                     with check (public.has_perm('invoices','update') or public.is_admin());
create policy invoices_delete on public.invoices for delete using (public.is_admin());

create policy invoice_items_read  on public.invoice_items for select using (public.has_perm('invoices','read') or public.is_admin());
create policy invoice_items_write on public.invoice_items for all
  using (public.has_perm('invoices','create') or public.is_admin())
  with check (public.has_perm('invoices','create') or public.is_admin());

create policy alloc_read  on public.payment_allocations for select using (public.has_perm('payments','read') or public.is_admin());
create policy alloc_write on public.payment_allocations for all
  using (public.has_perm('payments','create') or public.is_admin())
  with check (public.has_perm('payments','create') or public.is_admin());

create policy portal_tokens_read  on public.customer_portal_tokens for select using (public.has_perm('customers','read') or public.is_admin());
create policy portal_tokens_write on public.customer_portal_tokens for all
  using (public.has_perm('customers','update') or public.is_admin())
  with check (public.has_perm('customers','update') or public.is_admin());

create policy payment_reports_read  on public.payment_reports for select using (public.has_perm('payments','read') or public.is_admin());
create policy payment_reports_write on public.payment_reports for all
  using (public.has_perm('payments','update') or public.is_admin())
  with check (public.has_perm('payments','update') or public.is_admin());

-- ---------- PERMISOS DE ROL ----------
insert into public.role_permissions (role, resource, action) values
  ('finanzas','invoices','read'), ('finanzas','invoices','create'), ('finanzas','invoices','update'),
  ('ventas','invoices','read')
on conflict do nothing;

-- ---------- AUDITORÍA ----------
create trigger invoices_audit    after insert or update or delete on public.invoices
  for each row execute function public.audit_row();
create trigger allocations_audit after insert or update or delete on public.payment_allocations
  for each row execute function public.audit_row();

create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();
