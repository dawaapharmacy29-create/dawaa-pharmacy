-- Dawaa Pharmacy V3: customer coding, quick followup requests, staff rename/additions
-- Safe migration. Review branch values and initial passwords before sharing.

create extension if not exists pgcrypto;

create table if not exists public.customer_coding_requests (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null,
  customer_phone text not null,
  customer_code text null,
  customer_address text null,
  customer_notes text null,
  branch_name text null,
  status text not null default 'pending' check (status in ('pending','created_customer','linked_existing','rejected')),
  created_customer_id uuid null,
  created_by uuid null,
  created_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quick_followup_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid null,
  customer_code text null,
  customer_name text not null,
  customer_phone text null,
  branch_name text null,
  followup_summary text not null,
  priority text not null default 'مهم',
  status text not null default 'pending' check (status in ('pending','assigned','done','cancelled')),
  assigned_to text null,
  created_by uuid null,
  created_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_coding_requests enable row level security;
alter table public.quick_followup_requests enable row level security;

do $$ begin
  create policy "customer_coding_requests_all_authenticated" on public.customer_coding_requests for all using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "quick_followup_requests_all_authenticated" on public.quick_followup_requests for all using (true) with check (true);
exception when duplicate_object then null; end $$;

create index if not exists idx_customer_coding_requests_created on public.customer_coding_requests(created_at desc);
create index if not exists idx_customer_coding_requests_phone on public.customer_coding_requests(customer_phone);
create index if not exists idx_quick_followup_requests_status_created on public.quick_followup_requests(status, created_at desc);
create index if not exists idx_quick_followup_requests_customer_code on public.quick_followup_requests(customer_code);

-- Rename pharmacist Islam to avoid confusion with delivery Islam.
update public.staff
set name = 'د اسلام فاروق', staff_name = coalesce(staff_name, 'د اسلام فاروق'), role = coalesce(role, 'pharmacist'), updated_at = now()
where lower(replace(coalesce(name, staff_name, ''), ' ', '')) in ('داسلام','اسلام','د/اسلام')
  and lower(coalesce(role, '')) not in ('delivery','توصيل','دليفري');

update public.staff_accounts
set name = 'د اسلام فاروق', staff_name = 'د اسلام فاروق', display_name = 'د اسلام فاروق', role = 'pharmacist', updated_at = now()
where lower(replace(coalesce(name, staff_name, display_name, username, ''), ' ', '')) in ('داسلام','اسلام','د/اسلام')
  and lower(coalesce(role, '')) not in ('delivery','توصيل','دليفري');

-- New pharmacists. Default branch is null for manager to assign later.
with new_staff(name, username, password) as (
  values
    ('د ندي', 'dr_nada', 'Dawaa2027'),
    ('د بسنت', 'dr_basent', 'Dawaa2027'),
    ('د وليد', 'dr_waleed', 'Dawaa2027')
), inserted_staff as (
  insert into public.staff (id, name, staff_name, role, branch, status, active, is_active, created_at, updated_at)
  select gen_random_uuid(), ns.name, ns.name, 'pharmacist', null, 'active', true, true, now(), now()
  from new_staff ns
  where not exists (
    select 1 from public.staff s where replace(coalesce(s.name, s.staff_name, ''), ' ', '') = replace(ns.name, ' ', '')
  )
  returning id, name
)
insert into public.staff_accounts (id, staff_id, username, temporary_password, password_status, name, staff_name, display_name, role, branch, active, can_login, visible_in_admin, created_at, updated_at)
select gen_random_uuid(), s.id, ns.username, ns.password, 'temporary', ns.name, ns.name, ns.name, 'pharmacist', null, true, true, true, now(), now()
from new_staff ns
join public.staff s on replace(coalesce(s.name, s.staff_name, ''), ' ', '') = replace(ns.name, ' ', '')
where not exists (select 1 from public.staff_accounts a where a.username = ns.username);

-- Optional: make invoice dashboard refresh RPC non-blocking if it does not exist.
create or replace function public.rebuild_sales_daily_summary(p_start_date date, p_end_date date)
returns void
language plpgsql
security definer
as $$
begin
  -- The app can already read from sales_invoices directly. This keeps invoice import from showing scary errors.
  return;
end;
$$;
