-- Link incentive medicines and sales to real doctors, and keep writes open for the current app client.
-- Date: 2024-05-21

alter table if exists public.incentive_medicines
  add column if not exists doctor_id text,
  add column if not exists responsible_doctor text,
  add column if not exists target_min_percent numeric default 0,
  add column if not exists target_min_quantity numeric default 0,
  add column if not exists product_type text,
  add column if not exists product_price numeric default 0,
  add column if not exists incentive_type text default 'fixed',
  add column if not exists incentive_percent numeric default 0,
  add column if not exists sold_quantity numeric default 0,
  add column if not exists source_file_date date;

alter table if exists public.incentive_medicine_sales
  add column if not exists doctor_id text,
  add column if not exists doctor_name text,
  add column if not exists medicine_id uuid,
  add column if not exists product_name text,
  add column if not exists incentive_per_unit numeric default 0,
  add column if not exists incentive_total numeric default 0,
  add column if not exists month_cycle text,
  add column if not exists created_by text,
  add column if not exists created_by_name text;

create index if not exists incentive_medicines_doctor_id_idx
  on public.incentive_medicines(doctor_id);

create index if not exists incentive_medicine_sales_doctor_id_idx
  on public.incentive_medicine_sales(doctor_id, month_cycle);

alter table if exists public.incentive_medicines enable row level security;
alter table if exists public.incentive_medicine_sales enable row level security;

drop policy if exists "incentive_medicines_client_read" on public.incentive_medicines;
drop policy if exists "incentive_medicines_client_write" on public.incentive_medicines;
drop policy if exists "incentive_medicine_sales_client_read" on public.incentive_medicine_sales;
drop policy if exists "incentive_medicine_sales_client_write" on public.incentive_medicine_sales;

create policy "incentive_medicines_client_read"
on public.incentive_medicines for select
to anon, authenticated
using (true);

create policy "incentive_medicines_client_write"
on public.incentive_medicines for all
to anon, authenticated
using (true)
with check (true);

create policy "incentive_medicine_sales_client_read"
on public.incentive_medicine_sales for select
to anon, authenticated
using (true);

create policy "incentive_medicine_sales_client_write"
on public.incentive_medicine_sales for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.incentive_medicines to anon, authenticated;
grant select, insert, update, delete on public.incentive_medicine_sales to anon, authenticated;
