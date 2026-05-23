-- Inventory tracking extensions for stagnant and incentive medicines.
-- Run manually in Supabase SQL Editor after reviewing.

create extension if not exists "uuid-ossp";

alter table public.stagnant_medicines
  add column if not exists product_type text,
  add column if not exists batch_details jsonb default '[]'::jsonb,
  add column if not exists responsible_doctor text,
  add column if not exists dispensed_quantity integer default 0,
  add column if not exists last_dispensed_at timestamptz,
  add column if not exists source_file_date date default current_date;

alter table public.incentive_medicines
  add column if not exists product_type text,
  add column if not exists product_price numeric default 0,
  add column if not exists incentive_type text default 'fixed',
  add column if not exists incentive_percent numeric default 0,
  add column if not exists sold_quantity integer default 0,
  add column if not exists responsible_doctor text,
  add column if not exists source_file_date date default current_date;

create table if not exists public.medicine_dispense_log (
  id uuid primary key default uuid_generate_v4(),
  medicine_kind text not null check (medicine_kind in ('stagnant', 'incentive')),
  medicine_id uuid,
  medicine_name text not null,
  branch text,
  doctor_name text,
  customer_id text,
  customer_name text,
  customer_phone text,
  quantity integer not null default 1,
  unit_price numeric default 0,
  incentive_value numeric default 0,
  dispense_reason text,
  dispensed_at timestamptz default now(),
  created_by uuid,
  created_at timestamptz default now()
);

create table if not exists public.medicine_daily_uploads (
  id uuid primary key default uuid_generate_v4(),
  upload_kind text not null check (upload_kind in ('stagnant', 'incentive')),
  source_file_name text,
  source_file_date date not null default current_date,
  branch text,
  rows_count integer default 0,
  uploaded_by uuid,
  uploaded_at timestamptz default now(),
  notes text
);

create index if not exists stagnant_medicines_source_idx
  on public.stagnant_medicines (source_file_date desc, branch);

create index if not exists stagnant_medicines_responsible_idx
  on public.stagnant_medicines (responsible_doctor, priority);

create index if not exists incentive_medicines_source_idx
  on public.incentive_medicines (source_file_date desc, branch);

create index if not exists incentive_medicines_doctor_idx
  on public.incentive_medicines (responsible_doctor, active);

create index if not exists medicine_dispense_log_medicine_idx
  on public.medicine_dispense_log (medicine_kind, medicine_id, dispensed_at desc);

alter table public.stagnant_medicines enable row level security;
alter table public.incentive_medicines enable row level security;
alter table public.medicine_dispense_log enable row level security;
alter table public.medicine_daily_uploads enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stagnant_medicines' and policyname = 'Allow anon read stagnant medicines') then
    create policy "Allow anon read stagnant medicines" on public.stagnant_medicines for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'stagnant_medicines' and policyname = 'Allow anon write stagnant medicines') then
    create policy "Allow anon write stagnant medicines" on public.stagnant_medicines for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incentive_medicines' and policyname = 'Allow anon read incentive medicines') then
    create policy "Allow anon read incentive medicines" on public.incentive_medicines for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'incentive_medicines' and policyname = 'Allow anon write incentive medicines') then
    create policy "Allow anon write incentive medicines" on public.incentive_medicines for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'medicine_dispense_log' and policyname = 'Allow anon read medicine dispense log') then
    create policy "Allow anon read medicine dispense log" on public.medicine_dispense_log for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'medicine_dispense_log' and policyname = 'Allow anon write medicine dispense log') then
    create policy "Allow anon write medicine dispense log" on public.medicine_dispense_log for all to anon using (true) with check (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'medicine_daily_uploads' and policyname = 'Allow anon read medicine daily uploads') then
    create policy "Allow anon read medicine daily uploads" on public.medicine_daily_uploads for select to anon using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'medicine_daily_uploads' and policyname = 'Allow anon write medicine daily uploads') then
    create policy "Allow anon write medicine daily uploads" on public.medicine_daily_uploads for all to anon using (true) with check (true);
  end if;
end $$;
