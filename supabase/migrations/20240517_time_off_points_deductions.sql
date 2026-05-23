alter table public.shift_exceptions
  add column if not exists deduct_points boolean default false,
  add column if not exists deduction_points numeric default 0,
  add column if not exists deduction_status text default 'none',
  add column if not exists point_record_id uuid;

create table if not exists public.point_records (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text not null,
  type text not null,
  points numeric not null default 0,
  reason text,
  manager_note text,
  created_by text,
  branch text,
  cycle_start date,
  cycle_end date,
  source_type text,
  source_id text,
  points_delta numeric default 0,
  status text default 'approved',
  month_cycle text,
  created_by_id text,
  created_by_name text,
  created_by_role text,
  created_at timestamptz default now()
);

create index if not exists point_records_employee_cycle_idx
  on public.point_records (employee_id, month_cycle, created_at desc);

create index if not exists point_records_employee_name_idx
  on public.point_records (employee_name, created_at desc);

alter table public.point_records enable row level security;

drop policy if exists "Allow anon read point records" on public.point_records;
drop policy if exists "Allow anon insert point records" on public.point_records;
drop policy if exists "Allow anon update point records" on public.point_records;

create policy "Allow anon read point records"
on public.point_records
for select
to anon
using (true);

create policy "Allow anon insert point records"
on public.point_records
for insert
to anon
with check (true);

create policy "Allow anon update point records"
on public.point_records
for update
to anon
using (true)
with check (true);
