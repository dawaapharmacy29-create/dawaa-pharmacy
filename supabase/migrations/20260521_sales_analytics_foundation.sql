-- Sales analytics foundation for B Connect invoice imports.
-- Run in Supabase SQL editor before importing the new Excel shape.

alter table public.sales_invoices
  add column if not exists invoice_datetime timestamptz,
  add column if not exists close_datetime timestamptz,
  add column if not exists analysis_datetime timestamptz,
  add column if not exists gross_amount numeric,
  add column if not exists discounted_amount numeric,
  add column if not exists net_amount numeric,
  add column if not exists discount_amount numeric,
  add column if not exists courier_cash numeric,
  add column if not exists extra_fees numeric,
  add column if not exists line_items_count numeric,
  add column if not exists shift_name text,
  add column if not exists clinic text,
  add column if not exists delivery_address text,
  add column if not exists notes text,
  add column if not exists save_status text,
  add column if not exists device_name text;

update public.sales_invoices
set
  invoice_datetime = coalesce(invoice_datetime, invoice_date::timestamptz),
  analysis_datetime = coalesce(analysis_datetime, close_datetime, invoice_datetime, invoice_date::timestamptz),
  net_amount = coalesce(net_amount, amount)
where invoice_date is not null;

create index if not exists idx_sales_invoices_analysis_datetime
  on public.sales_invoices (analysis_datetime);

create index if not exists idx_sales_invoices_seller_analysis
  on public.sales_invoices (seller_name, analysis_datetime);

create index if not exists idx_sales_invoices_branch_analysis
  on public.sales_invoices (branch, analysis_datetime);

create table if not exists public.branch_sales_targets (
  id uuid primary key default gen_random_uuid(),
  branch_name text not null,
  cycle_start_day int not null default 26,
  target_amount numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists branch_sales_targets_branch_name_uidx
  on public.branch_sales_targets (branch_name);

insert into public.branch_sales_targets (branch_name, cycle_start_day, target_amount, active)
values
  ('فرع الشامي', 26, 1000000, true),
  ('فرع شكري', 26, 1500000, true)
on conflict (branch_name) do update
set
  cycle_start_day = excluded.cycle_start_day,
  target_amount = excluded.target_amount,
  active = true,
  updated_at = now();

alter table public.branch_sales_targets enable row level security;

drop policy if exists "branch_sales_targets_select_authenticated" on public.branch_sales_targets;
create policy "branch_sales_targets_select_authenticated"
on public.branch_sales_targets
for select
to authenticated, anon
using (true);

drop policy if exists "branch_sales_targets_write_admin" on public.branch_sales_targets;
create policy "branch_sales_targets_write_admin"
on public.branch_sales_targets
for all
to authenticated, anon
using (
  coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-user-id', '') in (
    select id::text
    from public.staff_accounts
    where coalesce(active, true) = true
      and coalesce(can_login, true) = true
      and (
        role in ('مدير عام', 'admin', 'مدير')
        or staff_role in ('مدير عام', 'admin', 'مدير')
        or coalesce(permissions, '{}'::jsonb) ? 'view_analytics_sales'
        or coalesce(permissions, '{}'::jsonb) ? 'manage_settings'
      )
  )
)
with check (
  coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-user-id', '') in (
    select id::text
    from public.staff_accounts
    where coalesce(active, true) = true
      and coalesce(can_login, true) = true
      and (
        role in ('مدير عام', 'admin', 'مدير')
        or staff_role in ('مدير عام', 'admin', 'مدير')
        or coalesce(permissions, '{}'::jsonb) ? 'view_analytics_sales'
        or coalesce(permissions, '{}'::jsonb) ? 'manage_settings'
      )
  )
);
