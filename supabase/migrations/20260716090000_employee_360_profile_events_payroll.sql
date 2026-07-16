begin;

create table if not exists public.employee_events (
  id uuid primary key default gen_random_uuid(),
  subject_staff_id text not null,
  subject_user_id text,
  subject_name text,
  actor_staff_id text,
  actor_user_id text,
  actor_name text,
  actor_role text,
  branch text,
  category text not null,
  event_type text not null,
  title text not null,
  description text,
  source_table text,
  source_id text,
  route text,
  points_delta numeric default 0,
  money_delta numeric default 0,
  priority text not null default 'normal',
  requires_action boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  event_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists employee_events_subject_staff_idx
  on public.employee_events(subject_staff_id, event_at desc);
create index if not exists employee_events_source_idx
  on public.employee_events(source_table, source_id);
create unique index if not exists employee_events_dedupe_idx
  on public.employee_events(subject_staff_id, event_type, coalesce(source_table,''), coalesce(source_id,''))
  where source_id is not null;

create table if not exists public.employee_compensation_profiles (
  staff_id text primary key,
  staff_name text,
  branch text,
  hourly_rate numeric not null default 0,
  monthly_base_salary numeric not null default 0,
  overtime_hour_rate numeric not null default 0,
  monthly_incentive_base numeric not null default 1500,
  point_value numeric not null default 3,
  monthly_leave_allowance numeric not null default 0,
  annual_leave_allowance numeric not null default 21,
  annual_leave_carryover numeric not null default 0,
  effective_from date not null default current_date,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.employee_monthly_statements (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null,
  staff_name text,
  branch text,
  cycle_start date not null,
  cycle_end date not null,
  base_salary numeric not null default 0,
  hourly_rate numeric not null default 0,
  scheduled_hours numeric not null default 0,
  attendance_hours numeric not null default 0,
  overtime_hours numeric not null default 0,
  gross_salary numeric not null default 0,
  rewards_amount numeric not null default 0,
  deductions_amount numeric not null default 0,
  incentive_amount numeric not null default 0,
  net_salary numeric not null default 0,
  points_opening numeric not null default 0,
  points_rewards numeric not null default 0,
  points_deductions numeric not null default 0,
  points_closing numeric not null default 0,
  sales_total numeric not null default 0,
  invoices_count integer not null default 0,
  average_invoice numeric not null default 0,
  conversation_reviews_count integer not null default 0,
  conversation_reviews_average numeric not null default 0,
  monthly_leave_days numeric not null default 0,
  annual_leave_days numeric not null default 0,
  permission_hours numeric not null default 0,
  absence_days numeric not null default 0,
  alerts_count integer not null default 0,
  strengths jsonb not null default '[]'::jsonb,
  improvement_areas jsonb not null default '[]'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  pdf_storage_path text,
  status text not null default 'draft',
  generated_at timestamptz not null default now(),
  generated_by text,
  unique(staff_id, cycle_start, cycle_end)
);

alter table public.employee_events enable row level security;
alter table public.employee_compensation_profiles enable row level security;
alter table public.employee_monthly_statements enable row level security;

-- التطبيق الحالي يستخدم x-dawaa-user-id. نربط الحساب بالموظف بدون الاعتماد على الاسم.
create or replace function public.dawaa_current_staff_id_v1()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select sa.staff_id::text
  from public.staff_accounts sa
  where sa.id::text = coalesce(
    nullif(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', ''),
    nullif(auth.uid()::text, '')
  )
  limit 1
$$;

revoke all on function public.dawaa_current_staff_id_v1() from public;
grant execute on function public.dawaa_current_staff_id_v1() to anon, authenticated;

create policy employee_events_self_read_v1 on public.employee_events
for select to anon, authenticated
using (
  subject_staff_id = public.dawaa_current_staff_id_v1()
  or exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', auth.uid()::text)
      and sa.role in ('general_manager','executive_manager','branches_manager')
  )
);

create policy employee_events_insert_v1 on public.employee_events
for insert to anon, authenticated
with check (
  actor_user_id is null
  or actor_user_id = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', auth.uid()::text)
);

create policy employee_compensation_self_read_v1 on public.employee_compensation_profiles
for select to anon, authenticated
using (
  staff_id = public.dawaa_current_staff_id_v1()
  or exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', auth.uid()::text)
      and sa.role in ('general_manager','executive_manager','branches_manager')
  )
);

create policy employee_statements_self_read_v1 on public.employee_monthly_statements
for select to anon, authenticated
using (
  staff_id = public.dawaa_current_staff_id_v1()
  or exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', auth.uid()::text)
      and sa.role in ('general_manager','executive_manager','branches_manager')
  )
);

create policy employee_compensation_admin_write_v1 on public.employee_compensation_profiles
for all to anon, authenticated
using (exists (
  select 1 from public.staff_accounts sa
  where sa.id::text = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', auth.uid()::text)
    and sa.role in ('general_manager','executive_manager')
))
with check (exists (
  select 1 from public.staff_accounts sa
  where sa.id::text = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', auth.uid()::text)
    and sa.role in ('general_manager','executive_manager')
));

create policy employee_statements_admin_write_v1 on public.employee_monthly_statements
for all to anon, authenticated
using (exists (
  select 1 from public.staff_accounts sa
  where sa.id::text = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', auth.uid()::text)
    and sa.role in ('general_manager','executive_manager')
))
with check (exists (
  select 1 from public.staff_accounts sa
  where sa.id::text = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-dawaa-user-id', auth.uid()::text)
    and sa.role in ('general_manager','executive_manager')
));

grant select, insert on public.employee_events to anon, authenticated;
grant select on public.employee_compensation_profiles to anon, authenticated;
grant select on public.employee_monthly_statements to anon, authenticated;
grant insert, update, delete on public.employee_compensation_profiles to anon, authenticated;
grant insert, update, delete on public.employee_monthly_statements to anon, authenticated;

commit;
