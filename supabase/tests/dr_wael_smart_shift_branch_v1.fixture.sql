-- Synthetic isolated fixture; no production connections. Dates are relative to today (Cairo) because the
-- insights read the last two weeks.
create role anon;
create role authenticated;
create role service_role;

create table public.staff_accounts(id uuid primary key, name text, role text, branch text, active boolean,
  can_login boolean, staff_id text);
create function public.dawaa_current_staff_account_id_strict() returns uuid language sql stable as $$
  select nullif(current_setting('test.actor', true), '')::uuid $$;

create table public.staff(id uuid primary key, name text, branch text, role text, type text, is_active boolean,
  active boolean, join_date date);
create table public.attendance_daily_summary(id uuid primary key default gen_random_uuid(), staff_id uuid,
  attendance_date date, branch text, first_in timestamptz, last_out timestamptz, total_hours numeric,
  payroll_eligible_hours numeric, late_minutes integer, early_leave_minutes integer, missing_punch boolean,
  status text, resolution_status text, review_required boolean, scheduled_start_at timestamptz,
  scheduled_end_at timestamptz, time_off_request_id uuid, approved_by text, updated_at timestamptz,
  unique(staff_id, attendance_date));
create table public.biometric_attendance_logs(id uuid primary key default gen_random_uuid(), provider text,
  device_id text, biometric_user_id text, staff_id uuid, staff_name_snapshot text, branch text,
  punch_time timestamptz, punch_type text);
create table public.staff_attendance_logs(id uuid primary key default gen_random_uuid(), staff_id uuid,
  shift_date date, recorded_at timestamptz, status text default 'accepted', biometric_source_log_id uuid);
create table public.staff_time_off_requests(id uuid primary key default gen_random_uuid(), staff_id uuid,
  request_kind text, request_label text, status text, start_date date, end_date date, start_time time,
  end_time time, duration_minutes integer, reason text, decided_by_name text);
create table public.staff_payroll_incentive_truth_v1(staff_id uuid, month_cycle text, performance_incentive numeric,
  target_bonus numeric, automated_incentives_total numeric);
create table public.employee_transactions(id uuid primary key default gen_random_uuid(), staff_id uuid, type text,
  category text, title text, reason text, display_reason text, amount numeric, transaction_date date,
  month_cycle text, status text);
create table public.staff_payroll_manual_entries_v1(id uuid primary key default gen_random_uuid(), staff_id uuid,
  month_cycle text, entry_kind text, category text, amount numeric, signed_amount numeric, reason text,
  reversal_of uuid, created_by_name text, created_at timestamptz default now());
create table public.shift_schedules(id uuid primary key default gen_random_uuid(), staff_id uuid references public.staff(id),
  staff_name text not null, employee_name text, role text, branch text not null, day_name text not null,
  shift_start text, shift_end text, start_time time, end_time time, hours numeric, is_off boolean default false,
  is_day_off boolean default false, is_different boolean default false, has_custom_time boolean default false,
  shift_date date, date date, notes text, source text, status text default 'scheduled',
  effective_from date not null, effective_to date, created_at timestamptz default now(), updated_at timestamptz default now(),
  check (effective_to is null or effective_to >= effective_from));

-- The production per-day schedule resolver, verbatim.
create function public.attendance_schedule_for_date_v1(p_staff_id uuid, p_date date)
returns table(schedule_id uuid, staff_id uuid, branch text, day_name text, shift_start time, shift_end time,
  is_off boolean, is_day_off boolean, source_kind text)
language sql stable security definer set search_path to 'public', 'pg_catalog' as $$
  with d as (
    select case extract(dow from p_date)::int
      when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء'
      when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة'
      else 'السبت' end as day_ar
  )
  select
    ss.id,ss.staff_id,ss.branch,
    coalesce(nullif(trim(ss.day_name),''),(select day_ar from d)),
    case when trim(coalesce(ss.shift_start,'')) ~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
      then trim(ss.shift_start)::time else ss.start_time end,
    case when trim(coalesce(ss.shift_end,'')) ~ '^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$'
      then trim(ss.shift_end)::time else ss.end_time end,
    coalesce(ss.is_off,false),coalesce(ss.is_day_off,false),
    case when coalesce(ss.shift_date,ss.date)=p_date then 'date_override' else 'weekly' end
  from public.shift_schedules ss
  where ss.staff_id=p_staff_id
    and ss.effective_from<=p_date
    and (ss.effective_to is null or ss.effective_to>=p_date)
    and (
      coalesce(ss.shift_date,ss.date)=p_date
      or (
        ss.shift_date is null and ss.date is null
        and trim(coalesce(ss.day_name,''))=(select day_ar from d)
      )
    )
  order by (coalesce(ss.shift_date,ss.date)=p_date) desc nulls last,
           ss.effective_from desc,
           coalesce(ss.updated_at,ss.created_at) desc nulls last,
           ss.id desc
  limit 1;
$$;

-- Stand-in for the canonical day resolver: an approved day stays frozen, any other day is rebuilt and
-- approved by the system.
create table public.materialized_days_log(staff_id uuid, attendance_date date, at timestamptz default clock_timestamp());
create function public.dawaa_materialize_attendance_day_internal_v3(p_staff_id uuid, p_attendance_date date)
returns void language plpgsql as $$
begin
  insert into public.materialized_days_log(staff_id, attendance_date) values (p_staff_id, p_attendance_date);
  insert into public.attendance_daily_summary(staff_id, attendance_date, branch, status, approved_by)
  select p_staff_id, p_attendance_date, s.branch, 'approved', 'system:auto-attendance-v3'
  from public.staff s where s.id = p_staff_id
  on conflict (staff_id, attendance_date) do update
    set status = 'approved', approved_by = 'system:auto-attendance-v3'
    where public.attendance_daily_summary.status <> 'approved';
end $$;

-- One engine function with the two-branch scope the migration widens.
create function public.dawaa_attendance_engine_route_v1(p_staff_id uuid) returns jsonb language plpgsql stable as $$
declare v_branch text;
begin
  select s.branch into v_branch from public.staff s where s.id = p_staff_id;
  if v_branch not in ('فرع الشامي','فرع شكري') then return '{"in_scope":false}'; end if;
  return '{"in_scope":true}';
end $$;

insert into public.staff_accounts values
  ('00000000-0000-4000-8000-000000000001', 'مشاهد', 'executive_manager', null, true, true, null),
  ('00000000-0000-4000-8000-000000000002', 'مدير عام آخر', 'general_manager', null, true, true, null),
  ('00000000-0000-4000-8000-000000000012', 'حساب منتظم', 'pharmacist', 'فرع شكري', true, true, '00000000-0000-4000-9000-000000000002');

insert into public.staff(id, name, branch, role, type, is_active, active) values
  ('00000000-0000-4000-9000-000000000001', 'د رضا', 'فرع الشامي', 'صيدلاني', 'Pharmacist', true, true),
  ('00000000-0000-4000-9000-000000000002', 'منتظم', 'فرع شكري', 'pharmacist', 'Pharmacist', true, true),
  ('00000000-0000-4000-9000-000000000003', 'هاجر', 'المخزن', 'assistant', 'فريق', true, true),
  ('00000000-0000-4000-9000-000000000004', 'سواق', 'فرع شكري', 'توصيل', 'Pharmacist', true, true),
  ('00000000-0000-4000-9000-000000000005', 'فرع تاني', 'فرع زكريا', 'pharmacist', 'Pharmacist', true, true);

-- Weekly schedules: Reda 10–18 every day; the regular employee 09–17 with Friday off.
insert into public.shift_schedules(staff_id, staff_name, branch, day_name, shift_start, shift_end, is_off, effective_from)
select s.id, s.name, s.branch, d.day_name,
  case when s.name = 'د رضا' then '10:00' else '09:00' end,
  case when s.name = 'د رضا' then '18:00' else '17:00' end,
  s.name = 'منتظم' and d.day_name = 'الجمعة',
  (now() at time zone 'Africa/Cairo')::date - 60
from public.staff s
cross join unnest(array['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت']) d(day_name)
where s.name in ('د رضا', 'منتظم');

-- The last 10 days: Reda really works 14:30–20:30; the regular employee 09:00–17:00 on the Shami device.
insert into public.staff_attendance_logs(staff_id, shift_date, recorded_at)
select s.id, g.day, (g.day + t.at) at time zone 'Africa/Cairo'
from public.staff s
cross join lateral (select (now() at time zone 'Africa/Cairo')::date - k as day from generate_series(1, 10) k) g
cross join lateral (values (case when s.name = 'د رضا' then time '14:30' else time '09:00' end),
                           (case when s.name = 'د رضا' then time '20:30' else time '17:00' end)) t(at)
where s.name in ('د رضا', 'منتظم');

insert into public.biometric_attendance_logs(provider, staff_id, branch, punch_time)
select case when s.name = 'منتظم' then 'zk_shami_direct_bridge' else 'zk_shami_direct_bridge' end, l.staff_id, s.branch, l.recorded_at
from public.staff_attendance_logs l join public.staff s on s.id = l.staff_id
where l.shift_date >= (now() at time zone 'Africa/Cairo')::date - 6;

-- The warehouse employee punched yesterday (never built) and today on the Shami device.
insert into public.staff_attendance_logs(staff_id, shift_date, recorded_at)
select '00000000-0000-4000-9000-000000000003', (now() at time zone 'Africa/Cairo')::date - 1, now() - interval '1 day';
insert into public.biometric_attendance_logs(provider, staff_id, branch, punch_time)
values ('zk_shami_direct_bridge', '00000000-0000-4000-9000-000000000003', 'المخزن', now());

-- A day a manager approved inside the window the shift change will cover.
insert into public.attendance_daily_summary(staff_id, attendance_date, branch, status, approved_by)
values ('00000000-0000-4000-9000-000000000001', (now() at time zone 'Africa/Cairo')::date - 2, 'فرع الشامي', 'approved', 'manager-account');
