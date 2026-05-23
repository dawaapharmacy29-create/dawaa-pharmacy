create extension if not exists "pgcrypto";

create table if not exists public.point_records (
  id uuid primary key default gen_random_uuid()
);

alter table public.point_records
  add column if not exists employee_id text,
  add column if not exists employee_name text,
  add column if not exists branch_id uuid,
  add column if not exists branch text,
  add column if not exists points numeric not null default 0,
  add column if not exists points_delta numeric,
  add column if not exists type text not null default 'admin_adjustment',
  add column if not exists reason text,
  add column if not exists description text,
  add column if not exists manager_note text,
  add column if not exists source text,
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists created_by text,
  add column if not exists created_by_id text,
  add column if not exists created_by_name text,
  add column if not exists created_by_role text,
  add column if not exists approved_by text,
  add column if not exists status text default 'approved',
  add column if not exists cycle_start date,
  add column if not exists cycle_end date,
  add column if not exists month_cycle text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.point_records
set points_delta = points
where points_delta is null;

create index if not exists point_records_employee_cycle_idx
  on public.point_records (employee_id, cycle_start, cycle_end, created_at desc);

create index if not exists point_records_employee_name_idx
  on public.point_records (employee_name, created_at desc);

create index if not exists point_records_source_idx
  on public.point_records (source_type, source_id);

create index if not exists point_records_source_alias_idx
  on public.point_records (source, source_id);

drop index if exists point_records_unique_conversation_evaluation;

create unique index point_records_unique_conversation_evaluation
  on public.point_records (employee_id, source_id, type)
  where source_id is not null
    and type = 'deduction'
    and (source = 'conversation_evaluation' or source_type = 'conversation_evaluation');

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

create or replace view public.orphan_point_records as
select pr.*
from public.point_records pr
left join public.staff s on s.id::text = pr.employee_id
where pr.employee_id is not null
  and s.id is null;

do $$
begin
  if to_regclass('public.points_transactions') is not null then
    alter table public.points_transactions
      add column if not exists employee_id text,
      add column if not exists staff_id text,
      add column if not exists branch_id uuid,
      add column if not exists branch text,
      add column if not exists source text,
      add column if not exists source_type text,
      add column if not exists source_id text,
      add column if not exists points_delta numeric,
      add column if not exists cycle_start date,
      add column if not exists cycle_end date,
      add column if not exists month_cycle text,
      add column if not exists status text default 'approved',
      add column if not exists reason text,
      add column if not exists description text;
  end if;
end $$;

do $$
begin
  if to_regclass('public.shift_exceptions') is not null then
    alter table public.shift_exceptions
      add column if not exists deduct_points boolean default false,
      add column if not exists deduction_points numeric default 0,
      add column if not exists deduction_status text default 'none',
      add column if not exists point_record_id uuid;
  end if;
end $$;

do $$
begin
  if to_regclass('public.staff_accounts') is not null then
    update public.staff_accounts
    set active = false,
        updated_at = now()
    where username = 'mohamed.shehata';
  end if;
end $$;
