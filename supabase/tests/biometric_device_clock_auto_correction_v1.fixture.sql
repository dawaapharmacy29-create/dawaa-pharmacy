-- Synthetic isolated fixture; no production connections. History is loaded before the migration so its
-- replay and repair run on it; the test then inserts live punches through the trigger.
create role anon;
create role authenticated;
create role service_role;

create table public.biometric_attendance_logs(id uuid primary key default gen_random_uuid(), provider text,
  raw_payload jsonb, punch_time timestamptz, staff_id uuid, created_at timestamptz not null default now());
create table public.staff_attendance_logs(id uuid primary key default gen_random_uuid(), staff_id uuid,
  shift_date date, recorded_at timestamptz, biometric_source_log_id uuid, updated_at timestamptz);
create table public.attendance_daily_summary(staff_id uuid, attendance_date date, status text, approved_by text,
  first_in timestamptz, updated_at timestamptz, primary key(staff_id, attendance_date));
-- Stand-in for the canonical day resolver: an approved day stays frozen, any other day is rebuilt
-- from its attendance logs and approved by the system.
create table public.materialized_days_log(staff_id uuid, attendance_date date);
create function public.dawaa_materialize_attendance_day_internal_v3(p_staff_id uuid, p_attendance_date date)
returns void language plpgsql as $$
begin
  insert into public.materialized_days_log values (p_staff_id, p_attendance_date);
  update public.attendance_daily_summary a
  set first_in = (select min(s.recorded_at) from public.staff_attendance_logs s
                  where s.staff_id = p_staff_id and s.shift_date = p_attendance_date),
      status = 'approved', approved_by = 'system:auto-attendance-v3'
  where a.staff_id = p_staff_id and a.attendance_date = p_attendance_date and a.status <> 'approved';
end $$;

-- Helper: one ZK punch whose device showed p_event (Cairo wall time) and that reached the server at p_arrived.
create function public.fixture_punch(p_provider text, p_device text, p_event_id text, p_event text, p_arrived timestamptz, p_staff uuid default null)
returns uuid language sql as $$
  insert into public.biometric_attendance_logs(provider, raw_payload, punch_time, staff_id, created_at)
  values (p_provider,
    jsonb_build_object('event_id', p_event_id, 'external_device_id', p_device, 'event_time', p_event),
    p_event::timestamp at time zone 'Africa/Cairo', p_staff, p_arrived)
  returning id $$;

-- History (UTC arrivals; Cairo is UTC+3 in summer, UTC+2 from 2026-10-30).
-- Shami device, summer and in sync: 09:00 punch arrives at 06:03 UTC.
select public.fixture_punch('zk_shami_direct_bridge', 'DEV-A', 'h1', '2026-10-20 09:00:00', '2026-10-20 06:03:00+00', '00000000-0000-4000-9000-000000000001');
-- After the winter change the device kept summer time: a real 09:00 (07:00 UTC) shows 10:00.
select public.fixture_punch('zk_shami_direct_bridge', 'DEV-A', 'h2', '2026-11-01 10:00:00', '2026-11-01 07:04:00+00', '00000000-0000-4000-9000-000000000001');
select public.fixture_punch('zk_shami_direct_bridge', 'DEV-A', 'h3', '2026-11-02 10:00:00', '2026-11-02 07:04:00+00', '00000000-0000-4000-9000-000000000002');
-- A manager already approved this day by hand.
select public.fixture_punch('zk_shami_direct_bridge', 'DEV-A', 'h4', '2026-11-03 10:00:00', '2026-11-03 07:04:00+00', '00000000-0000-4000-9000-000000000003');
-- The other device was right all along: nothing changes for it.
select public.fixture_punch('zk_shokry_direct_bridge', 'DEV-B', 'h5', '2026-11-01 09:00:00', '2026-11-01 07:02:00+00', '00000000-0000-4000-9000-000000000004');

insert into public.staff_attendance_logs(staff_id, shift_date, recorded_at, biometric_source_log_id)
select l.staff_id, (l.punch_time at time zone 'Africa/Cairo')::date, l.punch_time, l.id from public.biometric_attendance_logs l;

insert into public.attendance_daily_summary(staff_id, attendance_date, status, approved_by, first_in)
select s.staff_id, s.shift_date,
  'approved',
  case when s.staff_id = '00000000-0000-4000-9000-000000000003' then 'manager-account' else 'system:auto-attendance-v2' end,
  s.recorded_at
from public.staff_attendance_logs s;
