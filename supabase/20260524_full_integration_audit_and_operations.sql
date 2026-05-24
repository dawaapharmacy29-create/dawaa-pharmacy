-- Dawaa Pharmacy 2027 full integration audit and operations migration
-- Idempotent, non-destructive, safe to run multiple times.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table if exists public.customers add column if not exists team_notes text;
alter table if exists public.customers add column if not exists handling_notes text;
alter table if exists public.customers add column if not exists customer_flags jsonb not null default '{}'::jsonb;
alter table if exists public.customers add column if not exists updated_at timestamptz not null default now();

alter table if exists public.employee_transactions add column if not exists employee_name text;
alter table if exists public.employee_transactions add column if not exists executor_name text;
alter table if exists public.employee_transactions add column if not exists created_by_name text;
alter table if exists public.employee_transactions add column if not exists approved_by_name text;
alter table if exists public.employee_transactions add column if not exists clean_reason text;
alter table if exists public.employee_transactions add column if not exists display_reason text;
alter table if exists public.employee_transactions add column if not exists item_name text;
alter table if exists public.employee_transactions add column if not exists item_quantity numeric;
alter table if exists public.employee_transactions add column if not exists source_label text;
alter table if exists public.employee_transactions add column if not exists display_source text;
alter table if exists public.employee_transactions add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table if exists public.employee_transactions add column if not exists approved_at timestamptz;
alter table if exists public.employee_transactions add column if not exists updated_at timestamptz not null default now();

alter table if exists public.customer_requests add column if not exists item_image_url text;
alter table if exists public.customer_requests add column if not exists current_stage text not null default 'registered';
alter table if exists public.customer_requests add column if not exists priority text not null default 'medium';
alter table if exists public.customer_requests add column if not exists is_urgent boolean not null default false;
alter table if exists public.customer_requests add column if not exists needed_by_date date;
alter table if exists public.customer_requests add column if not exists expected_fulfillment_days integer;
alter table if exists public.customer_requests add column if not exists potential_source_id uuid;
alter table if exists public.customer_requests add column if not exists potential_source_name text;
alter table if exists public.customer_requests add column if not exists expected_price numeric;
alter table if exists public.customer_requests add column if not exists assigned_to uuid;
alter table if exists public.customer_requests add column if not exists due_date date;
alter table if exists public.customer_requests add column if not exists last_action_at timestamptz;
alter table if exists public.customer_requests add column if not exists closed_at timestamptz;
alter table if exists public.customer_requests add column if not exists updated_at timestamptz not null default now();

create table if not exists public.customer_request_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_type text not null default 'supplier',
  phone text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_role_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid,
  staff_name text not null,
  role_key text not null,
  branch text,
  active boolean not null default true,
  assigned_by uuid,
  assigned_by_name text,
  started_at date not null default current_date,
  ended_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.manager_performance_reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.manager_role_assignments(id) on delete set null,
  staff_id uuid,
  staff_name text not null,
  role_key text not null,
  month_cycle text,
  score numeric not null default 0,
  status text not null default 'draft',
  metrics jsonb not null default '{}'::jsonb,
  notes text,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.customer_requests(id) on delete cascade,
  from_stage text,
  to_stage text,
  event_type text not null default 'stage_change',
  event_note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  image_url text,
  branch text,
  start_date date,
  end_date date,
  discount_type text,
  discount_value numeric,
  included_items text,
  team_notes text,
  whatsapp_script text,
  status text not null default 'scheduled',
  created_by uuid,
  created_by_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_stories (
  id uuid primary key default gen_random_uuid(),
  story_date date not null default current_date,
  story_order integer,
  title text not null,
  image_url text,
  story_type text,
  views_count integer default 0,
  inquiries_count integer default 0,
  sales_count integer default 0,
  sales_value numeric default 0,
  related_offer_id uuid references public.offers(id) on delete set null,
  related_items text,
  uploaded_by uuid,
  uploaded_by_name text,
  report_by uuid,
  report_by_name text,
  report_notes text,
  report_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.shortage_items
  add column if not exists responsible_staff_id uuid,
  add column if not exists responsible_staff_name text,
  add column if not exists registered_by_staff_id uuid,
  add column if not exists registered_by_staff_name text,
  add column if not exists created_by_name text;

alter table if exists public.supplies_items
  add column if not exists responsible_staff_id uuid,
  add column if not exists responsible_staff_name text,
  add column if not exists weekly_checker_staff_id uuid,
  add column if not exists weekly_checker_staff_name text,
  add column if not exists created_by_name text;

alter table if exists public.accessory_items
  add column if not exists responsible_staff_id uuid,
  add column if not exists responsible_staff_name text,
  add column if not exists supplier_name text,
  add column if not exists supplier_phone text,
  add column if not exists created_by_name text;

alter table if exists public.branch_cleaning_tasks
  add column if not exists responsible_staff_id uuid,
  add column if not exists responsible_staff_name text,
  add column if not exists reviewer_staff_id uuid,
  add column if not exists reviewer_staff_name text,
  add column if not exists cleaning_responsible_id uuid,
  add column if not exists cleaning_responsible_name text,
  add column if not exists checklist jsonb not null default '{}'::jsonb,
  add column if not exists evaluation_score numeric,
  add column if not exists reviewed_at timestamptz,
  add column if not exists created_by_name text;

alter table if exists public.shelf_tasks
  add column if not exists responsible_staff_id uuid,
  add column if not exists responsible_staff_name text,
  add column if not exists reviewer_staff_id uuid,
  add column if not exists reviewer_staff_name text,
  add column if not exists created_by_name text;

alter table if exists public.inventory_count_sessions
  add column if not exists responsible_staff_id uuid,
  add column if not exists responsible_staff_name text,
  add column if not exists reviewer_staff_id uuid,
  add column if not exists reviewer_staff_name text,
  add column if not exists created_by_name text;

alter table if exists public.inventory_count_items
  add column if not exists expiry_date date,
  add column if not exists unit_price numeric,
  add column if not exists reviewed_qty numeric,
  add column if not exists reviewed_expiry_date date,
  add column if not exists review_result text;

alter table if exists public.stagnant_medicines
  add column if not exists product_price numeric,
  add column if not exists unit_price numeric;

alter table if exists public.incentive_medicines
  add column if not exists product_price numeric,
  add column if not exists unit_price numeric;

create table if not exists public.branch_cleaning_responsibles (
  id uuid primary key default gen_random_uuid(),
  branch text not null,
  cleaning_responsible_id uuid,
  cleaning_responsible_name text not null,
  reviewer_staff_id uuid,
  reviewer_staff_name text,
  active boolean not null default true,
  notes text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.supplier_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  phone text,
  contact_person text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array[
    'customers','employee_transactions','customer_request_sources','manager_role_assignments',
    'manager_performance_reviews','customer_requests','offers','whatsapp_stories',
    'branch_cleaning_responsibles','supplier_directory'
  ]
  loop
    if exists (select 1 from information_schema.tables where table_schema='public' and table_name=t) then
      execute format('drop trigger if exists trg_%I_updated_at on public.%I', t, t);
      execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    end if;
  end loop;
end $$;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employee_transactions' and column_name='source') then
    create index if not exists idx_employee_transactions_source on public.employee_transactions(source);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='employee_transactions' and column_name='created_at') then
    create index if not exists idx_employee_transactions_created_at on public.employee_transactions(created_at);
  end if;
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='customer_requests' and column_name='current_stage') then
    create index if not exists idx_customer_requests_current_stage on public.customer_requests(current_stage);
  end if;
  create index if not exists idx_customer_request_sources_active on public.customer_request_sources(is_active);
  create index if not exists idx_manager_role_assignments_role on public.manager_role_assignments(role_key, active);
  create index if not exists idx_manager_reviews_cycle on public.manager_performance_reviews(month_cycle, role_key);
  create index if not exists idx_branch_cleaning_responsibles_branch on public.branch_cleaning_responsibles(branch, active);
  create index if not exists idx_supplier_directory_name on public.supplier_directory(name, active);
end $$;

insert into storage.buckets (id, name, public)
values
  ('customer-request-images', 'customer-request-images', true),
  ('story-assets', 'story-assets', true),
  ('offer-assets', 'offer-assets', true)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
