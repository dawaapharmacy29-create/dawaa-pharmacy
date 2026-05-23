-- Movement logs for stagnant medicines and incentive medicines.
-- The pharmacy cycle is always 26 -> 25.

alter table if exists public.stagnant_medicines
  add column if not exists target_min_percent numeric default 0,
  add column if not exists target_min_quantity numeric default 0,
  add column if not exists doctor_id text;

alter table if exists public.incentive_medicines
  add column if not exists target_min_percent numeric default 0,
  add column if not exists target_min_quantity numeric default 0,
  add column if not exists doctor_id text;

create table if not exists public.stagnant_medicine_dispenses (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid,
  medicine_name text not null,
  doctor_id text,
  doctor_name text not null,
  branch text,
  quantity numeric not null default 0,
  expiry_date date,
  usage text,
  transaction_date date not null default current_date,
  month_cycle text,
  notes text,
  points_awarded numeric default 0,
  created_by text,
  created_by_name text,
  created_at timestamptz default now()
);

create table if not exists public.incentive_medicine_sales (
  id uuid primary key default gen_random_uuid(),
  medicine_id uuid,
  product_name text not null,
  doctor_id text,
  doctor_name text not null,
  branch text,
  quantity numeric not null default 0,
  incentive_per_unit numeric not null default 0,
  incentive_total numeric not null default 0,
  sale_date date not null default current_date,
  month_cycle text,
  notes text,
  points_awarded numeric default 0,
  created_by text,
  created_by_name text,
  created_at timestamptz default now()
);

create index if not exists stagnant_dispenses_doctor_cycle_idx
  on public.stagnant_medicine_dispenses (doctor_name, month_cycle, transaction_date desc);

create index if not exists stagnant_dispenses_medicine_cycle_idx
  on public.stagnant_medicine_dispenses (medicine_id, month_cycle);

create index if not exists incentive_sales_doctor_cycle_idx
  on public.incentive_medicine_sales (doctor_name, month_cycle, sale_date desc);

create index if not exists incentive_sales_medicine_cycle_idx
  on public.incentive_medicine_sales (medicine_id, month_cycle);

alter table public.stagnant_medicine_dispenses enable row level security;
alter table public.incentive_medicine_sales enable row level security;

drop policy if exists "Allow anon read stagnant dispenses" on public.stagnant_medicine_dispenses;
drop policy if exists "Allow anon insert stagnant dispenses" on public.stagnant_medicine_dispenses;
drop policy if exists "Allow anon update stagnant dispenses" on public.stagnant_medicine_dispenses;

create policy "Allow anon read stagnant dispenses"
on public.stagnant_medicine_dispenses for select
to anon, authenticated
using (true);

create policy "Allow anon insert stagnant dispenses"
on public.stagnant_medicine_dispenses for insert
to anon, authenticated
with check (true);

create policy "Allow anon update stagnant dispenses"
on public.stagnant_medicine_dispenses for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "Allow anon read incentive sales" on public.incentive_medicine_sales;
drop policy if exists "Allow anon insert incentive sales" on public.incentive_medicine_sales;
drop policy if exists "Allow anon update incentive sales" on public.incentive_medicine_sales;

create policy "Allow anon read incentive sales"
on public.incentive_medicine_sales for select
to anon, authenticated
using (true);

create policy "Allow anon insert incentive sales"
on public.incentive_medicine_sales for insert
to anon, authenticated
with check (true);

create policy "Allow anon update incentive sales"
on public.incentive_medicine_sales for update
to anon, authenticated
using (true)
with check (true);
