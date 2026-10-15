-- Fixture for 20261015150100_attendance_read_scope_initplan_callers_v1 (applied after 20261015140000).
-- Base actors, verified-session stand-in, dawaa_can_read_staff_attendance_log and staff_attendance_logs:
\ir rls_actor_scope_initplan_v1.fixture.sql

-- Attendance permissions for most actors (admin and general_manager pass dawaa_current_actor_can by role).
update public.account_permissions
   set permissions = permissions || '{"view_attendance_leaves": true, "view_schedule": true, "manage_payroll": true}'::jsonb
 where account_id not in ('a0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000011');

-- Minimal relations and helpers the five readers depend on (data access reduced to small tables).
create table public.staff (
  id uuid primary key, name text, role text, branch text, active boolean, is_active boolean, visible_in_schedule boolean
);
create table public.attendance_daily_summary (
  id uuid primary key, staff_id uuid, branch text, attendance_date date, status text, resolution_status text,
  scheduled_start_at timestamptz, scheduled_end_at timestamptz, late_minutes integer, early_leave_minutes integer,
  candidate_hours numeric
);
create table public.staff_overtime_approvals (
  id uuid primary key, staff_id uuid, staff_name text, branch text, attendance_date date, overtime_hours numeric,
  status text, source_resolution_id uuid, source_resolution_fingerprint text, decided_by_name text, decided_at timestamptz
);
create table public.biometric_attendance_logs (
  id bigint primary key, staff_id uuid, punch_time timestamptz, provider text, biometric_user_id text, raw_payload jsonb, branch text
);
create table public.biometric_employee_scope (provider text, biometric_user_id text, in_scope boolean);
create table public.attendance_manual_requests (staff_id uuid, status text, attendance_date date, requested_time timestamptz);
create table public.staff_time_off_requests (
  id uuid primary key, staff_id uuid, status text, start_date date, end_date date, request_kind text,
  request_label text, reason text, decided_at timestamptz, updated_at timestamptz
);
alter table public.staff_attendance_logs
  add column recorded_at timestamptz, add column attendance_type text, add column status text, add column shift_date date;

create or replace function public.attendance_resolution_fingerprint_v2(p_id uuid) returns text
language sql stable as $$ select md5(p_id::text) $$;
create or replace function public.resolve_attendance_policy_v2(p_staff_id uuid, p_date date) returns jsonb
language sql stable as $$ select case when extract(day from p_date)::int % 2 = 0 then '{"late_grace_minutes":"5","very_late_minutes":"20","early_leave_grace_minutes":"10"}'::jsonb else '{}'::jsonb end $$;
create or replace function public.get_attendance_policy_v1(p_date date) returns jsonb
language sql stable as $$ select '{"late_grace_minutes":15,"very_late_minutes":30}'::jsonb $$;
create or replace function public.attendance_schedule_for_date_v1(p_staff_id uuid, p_date date)
returns table(shift_start time, shift_end time, is_off boolean, is_day_off boolean, schedule_id uuid)
language sql stable as $$
  select '09:00'::time, '17:00'::time, false, false, md5(p_staff_id::text || p_date::text)::uuid
  where right(p_staff_id::text, 1) <> '7'
$$;
create or replace function public.attendance_branch_sync_complete_through_v1(p_branch text) returns timestamptz
language sql stable as $$ select now() $$;
create or replace function public.dawaa_biometric_source_branch_v1(p_raw_payload jsonb, p_fallback_branch text)
returns text language sql immutable set search_path to 'public', 'pg_catalog'
as $function$
  select nullif(trim(coalesce(p_raw_payload->>'branch',p_fallback_branch,'')),'');
$function$;
create or replace function public.dawaa_fingerprint_effective_time_v1(p_provider text, p_raw_payload jsonb, p_punch_time timestamp with time zone)
returns timestamp with time zone language sql stable set search_path to 'public', 'pg_catalog'
as $function$
  select case
    when p_provider = 'fingerprint_vendor_primary'
      and coalesce(p_raw_payload->>'event_time','') ~ '^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$'
    then (p_raw_payload->>'event_time')::timestamp at time zone 'Africa/Cairo'
    else p_punch_time
  end;
$function$;

-- Staff: subjects of the base actors in both branches, one archived, one hidden from the schedule.
insert into public.staff (id, name, role, branch, active, is_active, visible_in_schedule) values
  ('50000000-0000-4000-8000-000000000002', 'أحمد', 'pharmacist', 'فرع شكري', true, true, true),
  ('50000000-0000-4000-8000-000000000004', 'بسمة', 'branch_manager', 'فرع شكري', true, true, true),
  ('50000000-0000-4000-8000-000000000005', 'جمال', 'branch_manager', 'فرع الشامي', true, true, true),
  ('50000000-0000-4000-8000-000000000006', 'دينا', 'customer_service', 'فرع الشامي', true, true, true),
  ('50000000-0000-4000-8000-000000000007', 'هاني', 'pharmacist', 'فرع الشامي', true, true, true),
  ('50000000-0000-4000-8000-000000000031', 'وليد', 'pharmacist', 'فرع شكري', false, false, true),
  ('50000000-0000-4000-8000-000000000032', 'زينب', 'pharmacist', 'فرع الشامي', true, true, false);

insert into public.attendance_daily_summary
  (id, staff_id, branch, attendance_date, status, resolution_status, scheduled_start_at, scheduled_end_at, late_minutes, early_leave_minutes, candidate_hours)
select md5(s.id::text || d::text)::uuid, s.id, s.branch, d::date,
       case when extract(day from d)::int % 3 = 0 then 'pending_review' else 'approved' end,
       (array['on_time','late','very_late','missing_checkin','early_leave_review','off_day','absence_review'])[1 + (extract(day from d)::int + length(s.name)) % 7],
       (d::date::timestamp + time '09:00') at time zone 'Africa/Cairo', (d::date::timestamp + time '17:00') at time zone 'Africa/Cairo',
       (extract(day from d)::int * 7) % 45, (extract(day from d)::int * 3) % 20, 8
from public.staff s cross join generate_series(date '2026-10-01', date '2026-10-10', interval '1 day') d;

insert into public.staff_overtime_approvals
  (id, staff_id, staff_name, branch, attendance_date, overtime_hours, status, source_resolution_id, source_resolution_fingerprint, decided_by_name, decided_at)
select md5('ot' || a.id::text)::uuid, a.staff_id, s.name, s.branch, a.attendance_date, 1.5,
       (array['pending','approved','rejected'])[1 + extract(day from a.attendance_date)::int % 3],
       case when extract(day from a.attendance_date)::int % 4 = 0 then null else a.id end,
       case when extract(day from a.attendance_date)::int % 5 = 0 then 'stale' else md5(a.id::text) end,
       'مدير', now()
from public.attendance_daily_summary a join public.staff s on s.id = a.staff_id
where extract(day from a.attendance_date)::int % 2 = 0;

insert into public.biometric_attendance_logs (id, staff_id, punch_time, provider, biometric_user_id, raw_payload, branch)
select row_number() over (), a.staff_id, a.scheduled_start_at + interval '7 minutes', 'fingerprint_vendor_primary', 'u' || left(a.staff_id::text, 4),
       jsonb_build_object('branch', case when extract(day from a.attendance_date)::int % 4 = 0 then 'فرع الشامي' else a.branch end), a.branch
from public.attendance_daily_summary a where a.status = 'pending_review';
insert into public.biometric_attendance_logs (id, staff_id, punch_time, provider, biometric_user_id, raw_payload, branch) values
  (1001, null, '2026-10-04 08:55+02', 'fingerprint_vendor_primary', 'unmapped-1', '{"branch":"فرع شكري","event_time":"2026-10-04 08:55:00"}', 'فرع شكري'),
  (1002, null, '2026-10-06 09:05+02', 'fingerprint_vendor_primary', 'unmapped-2', '{}', 'فرع الشامي');
insert into public.biometric_employee_scope values ('fingerprint_vendor_primary', 'unmapped-2', false);

insert into public.attendance_manual_requests values
  ('50000000-0000-4000-8000-000000000002', 'pending', '2026-10-03', null),
  ('50000000-0000-4000-8000-000000000005', 'pending', null, '2026-10-04 10:00+02');
insert into public.staff_time_off_requests values
  ('70000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000006', 'approved', '2026-10-05', '2026-10-05', 'annual_leave', 'إجازة', 'سفر', now(), now()),
  ('70000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000004', 'pending', '2026-10-08', '2026-10-09', 'permission', null, null, null, now());

insert into public.staff_attendance_logs (id, staff_id, branch_name, recorded_at, attendance_type, status, shift_date) values
  (101, '50000000-0000-4000-8000-000000000002', 'فرع شكري', '2026-10-05 09:12+03', 'check_in', 'accepted', '2026-10-05'),
  (102, '50000000-0000-4000-8000-000000000002', 'فرع شكري', '2026-10-05 17:02+03', 'check_out', 'accepted', '2026-10-05'),
  (103, '50000000-0000-4000-8000-000000000005', 'فرع الشامي', '2026-10-05 09:40+03', 'check_in', 'accepted', '2026-10-05'),
  (104, '50000000-0000-4000-8000-000000000007', 'فرع الشامي', '2026-10-05 10:00+03', 'check_in', 'accepted', '2026-10-05');

-- Production definition (2026-10-15) of attendance_daily_command_v1 before the migration.
CREATE OR REPLACE FUNCTION public.attendance_daily_command_v1(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date, p_branch text DEFAULT NULL::text)
 RETURNS TABLE(staff_id uuid, staff_name text, role text, branch text, work_date date, schedule_status text, shift_start time without time zone, shift_end time without time zone, first_check_in timestamp with time zone, last_check_out timestamp with time zone, late_minutes integer, early_leave_minutes integer, attendance_status text, approved_exception_type text, approved_exception_reason text, biometric_events integer, source_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_policy jsonb:=public.get_attendance_policy_v1(p_date);
  v_late_grace integer:=coalesce((v_policy->>'late_grace_minutes')::int,15);
  v_very_late integer:=coalesce((v_policy->>'very_late_minutes')::int,30);
begin
  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;

  return query
  with canonical_staff as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,false)=true
      and s.branch in ('فرع الشامي','فرع شكري')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ), schedule_pick as (
    select cs.id staff_id,
           ss.shift_start,ss.shift_end,ss.is_off,ss.is_day_off,ss.schedule_id
    from canonical_staff cs
    left join lateral public.attendance_schedule_for_date_v1(cs.id,p_date) ss on true
  ), exceptions as (
    select cs.id staff_id,e.request_label as type,e.reason
    from canonical_staff cs
    left join lateral (
      select coalesce(x.request_label,x.request_kind) request_label,x.reason
      from public.staff_time_off_requests x
      where x.staff_id=cs.id and x.status='approved'
        and x.request_kind in ('permission','annual_leave','sick_leave','exceptional_leave','approved_absence')
        and p_date between x.start_date and x.end_date
      order by x.decided_at desc nulls last,x.updated_at desc,x.id desc limit 1
    ) e on true
  ), base as (
    select cs.id,cs.name,cs.role,cs.branch,
           sp.shift_start,sp.shift_end,sp.is_off,sp.is_day_off,sp.schedule_id,
           ex.type exception_type,ex.reason exception_reason,
           public.attendance_branch_sync_complete_through_v1(cs.branch) branch_complete_through,
           case when sp.schedule_id is null then 'missing'
                when (sp.is_off or sp.is_day_off) and sp.shift_start is not null and sp.shift_end is not null then 'conflict'
                when (sp.is_off or sp.is_day_off) then 'off'
                when sp.shift_start is null or sp.shift_end is null then 'missing_time'
                else 'scheduled' end schedule_state
    from canonical_staff cs
    left join schedule_pick sp on sp.staff_id=cs.id
    left join exceptions ex on ex.staff_id=cs.id
  ), scheduled as (
    select b.*,
      case when b.schedule_state='scheduled'
        then (p_date::timestamp+b.shift_start) at time zone 'Africa/Cairo' end scheduled_start,
      case when b.schedule_state='scheduled'
        then (((p_date+case when b.shift_end<=b.shift_start then 1 else 0 end)::timestamp+b.shift_end)
          at time zone 'Africa/Cairo') end scheduled_end
    from base b
  ), with_punches as (
    select s.*,p.first_in,p.last_out,coalesce(p.event_count,0) event_count
    from scheduled s
    left join lateral (
      select
        min(l.recorded_at) filter(where l.attendance_type='check_in') first_in,
        max(l.recorded_at) filter(where l.attendance_type='check_out') last_out,
        count(*)::int event_count
      from public.staff_attendance_logs l
      where l.staff_id=s.id and l.status='accepted'
        and (
          (s.schedule_state='scheduled'
            and l.recorded_at>=s.scheduled_start-interval '4 hours'
            and l.recorded_at<=s.scheduled_end+interval '6 hours')
          or (s.schedule_state<>'scheduled' and l.shift_date=p_date)
        )
    ) p on true
  )
  select c.id,c.name,c.role,c.branch,p_date,c.schedule_state,c.shift_start,c.shift_end,
    c.first_in,c.last_out,
    case when c.schedule_state<>'scheduled' or c.first_in is null then 0
      else greatest(0,floor(extract(epoch from(c.first_in-c.scheduled_start))/60)::int) end,
    case when c.schedule_state<>'scheduled' or c.last_out is null then 0
      else greatest(0,floor(extract(epoch from(c.scheduled_end-c.last_out))/60)::int) end,
    case
      when c.schedule_state='conflict' then 'schedule_conflict'
      when c.schedule_state='off' and c.event_count>0 then 'worked_on_off'
      when c.schedule_state='off' then 'off'
      when c.schedule_state in ('missing','missing_time') and c.event_count>0 then 'punch_without_valid_schedule'
      when c.schedule_state in ('missing','missing_time') then 'schedule_missing'
      when c.exception_type is not null and c.event_count=0 then 'approved_exception'
      when c.first_in is null and (c.branch_complete_through is null or c.branch_complete_through<c.scheduled_end) then 'sync_pending'
      when c.first_in is null and p_date<(now() at time zone 'Africa/Cairo')::date then 'absent'
      when c.first_in is null and p_date=(now() at time zone 'Africa/Cairo')::date
        and now()>c.scheduled_start+(v_late_grace||' minutes')::interval then 'not_arrived'
      when c.first_in is null then 'scheduled'
      when c.last_out is null and (c.branch_complete_through is null or c.branch_complete_through<c.scheduled_end) then 'sync_pending_checkout'
      when c.last_out is null and (p_date<(now() at time zone 'Africa/Cairo')::date or now()>c.scheduled_end+interval '6 hours') then 'missing_checkout'
      when c.last_out is null then 'working_now'
      when c.first_in>c.scheduled_start+(v_very_late||' minutes')::interval then 'very_late'
      when c.first_in>c.scheduled_start+(v_late_grace||' minutes')::interval then 'late'
      else 'on_time' end,
    c.exception_type,c.exception_reason,c.event_count,
    case when c.event_count>0 then 'fingerprint'
      when c.branch_complete_through is null or (c.scheduled_end is not null and c.branch_complete_through<c.scheduled_end)
        then 'sync_pending'
      else 'schedule' end
  from with_punches c
  where c.schedule_id is not null or c.event_count>0 or c.exception_type is not null
  order by c.branch,c.name;
end;
$function$;

-- Oracle copy of the same definition, kept after the migration replaces attendance_daily_command_v1.
CREATE OR REPLACE FUNCTION public.test_old_attendance_daily_command_v1(p_date date DEFAULT ((now() AT TIME ZONE 'Africa/Cairo'::text))::date, p_branch text DEFAULT NULL::text)
 RETURNS TABLE(staff_id uuid, staff_name text, role text, branch text, work_date date, schedule_status text, shift_start time without time zone, shift_end time without time zone, first_check_in timestamp with time zone, last_check_out timestamp with time zone, late_minutes integer, early_leave_minutes integer, attendance_status text, approved_exception_type text, approved_exception_reason text, biometric_events integer, source_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_policy jsonb:=public.get_attendance_policy_v1(p_date);
  v_late_grace integer:=coalesce((v_policy->>'late_grace_minutes')::int,15);
  v_very_late integer:=coalesce((v_policy->>'very_late_minutes')::int,30);
begin
  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;

  return query
  with canonical_staff as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,false)=true
      and s.branch in ('فرع الشامي','فرع شكري')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ), schedule_pick as (
    select cs.id staff_id,
           ss.shift_start,ss.shift_end,ss.is_off,ss.is_day_off,ss.schedule_id
    from canonical_staff cs
    left join lateral public.attendance_schedule_for_date_v1(cs.id,p_date) ss on true
  ), exceptions as (
    select cs.id staff_id,e.request_label as type,e.reason
    from canonical_staff cs
    left join lateral (
      select coalesce(x.request_label,x.request_kind) request_label,x.reason
      from public.staff_time_off_requests x
      where x.staff_id=cs.id and x.status='approved'
        and x.request_kind in ('permission','annual_leave','sick_leave','exceptional_leave','approved_absence')
        and p_date between x.start_date and x.end_date
      order by x.decided_at desc nulls last,x.updated_at desc,x.id desc limit 1
    ) e on true
  ), base as (
    select cs.id,cs.name,cs.role,cs.branch,
           sp.shift_start,sp.shift_end,sp.is_off,sp.is_day_off,sp.schedule_id,
           ex.type exception_type,ex.reason exception_reason,
           public.attendance_branch_sync_complete_through_v1(cs.branch) branch_complete_through,
           case when sp.schedule_id is null then 'missing'
                when (sp.is_off or sp.is_day_off) and sp.shift_start is not null and sp.shift_end is not null then 'conflict'
                when (sp.is_off or sp.is_day_off) then 'off'
                when sp.shift_start is null or sp.shift_end is null then 'missing_time'
                else 'scheduled' end schedule_state
    from canonical_staff cs
    left join schedule_pick sp on sp.staff_id=cs.id
    left join exceptions ex on ex.staff_id=cs.id
  ), scheduled as (
    select b.*,
      case when b.schedule_state='scheduled'
        then (p_date::timestamp+b.shift_start) at time zone 'Africa/Cairo' end scheduled_start,
      case when b.schedule_state='scheduled'
        then (((p_date+case when b.shift_end<=b.shift_start then 1 else 0 end)::timestamp+b.shift_end)
          at time zone 'Africa/Cairo') end scheduled_end
    from base b
  ), with_punches as (
    select s.*,p.first_in,p.last_out,coalesce(p.event_count,0) event_count
    from scheduled s
    left join lateral (
      select
        min(l.recorded_at) filter(where l.attendance_type='check_in') first_in,
        max(l.recorded_at) filter(where l.attendance_type='check_out') last_out,
        count(*)::int event_count
      from public.staff_attendance_logs l
      where l.staff_id=s.id and l.status='accepted'
        and (
          (s.schedule_state='scheduled'
            and l.recorded_at>=s.scheduled_start-interval '4 hours'
            and l.recorded_at<=s.scheduled_end+interval '6 hours')
          or (s.schedule_state<>'scheduled' and l.shift_date=p_date)
        )
    ) p on true
  )
  select c.id,c.name,c.role,c.branch,p_date,c.schedule_state,c.shift_start,c.shift_end,
    c.first_in,c.last_out,
    case when c.schedule_state<>'scheduled' or c.first_in is null then 0
      else greatest(0,floor(extract(epoch from(c.first_in-c.scheduled_start))/60)::int) end,
    case when c.schedule_state<>'scheduled' or c.last_out is null then 0
      else greatest(0,floor(extract(epoch from(c.scheduled_end-c.last_out))/60)::int) end,
    case
      when c.schedule_state='conflict' then 'schedule_conflict'
      when c.schedule_state='off' and c.event_count>0 then 'worked_on_off'
      when c.schedule_state='off' then 'off'
      when c.schedule_state in ('missing','missing_time') and c.event_count>0 then 'punch_without_valid_schedule'
      when c.schedule_state in ('missing','missing_time') then 'schedule_missing'
      when c.exception_type is not null and c.event_count=0 then 'approved_exception'
      when c.first_in is null and (c.branch_complete_through is null or c.branch_complete_through<c.scheduled_end) then 'sync_pending'
      when c.first_in is null and p_date<(now() at time zone 'Africa/Cairo')::date then 'absent'
      when c.first_in is null and p_date=(now() at time zone 'Africa/Cairo')::date
        and now()>c.scheduled_start+(v_late_grace||' minutes')::interval then 'not_arrived'
      when c.first_in is null then 'scheduled'
      when c.last_out is null and (c.branch_complete_through is null or c.branch_complete_through<c.scheduled_end) then 'sync_pending_checkout'
      when c.last_out is null and (p_date<(now() at time zone 'Africa/Cairo')::date or now()>c.scheduled_end+interval '6 hours') then 'missing_checkout'
      when c.last_out is null then 'working_now'
      when c.first_in>c.scheduled_start+(v_very_late||' minutes')::interval then 'very_late'
      when c.first_in>c.scheduled_start+(v_late_grace||' minutes')::interval then 'late'
      else 'on_time' end,
    c.exception_type,c.exception_reason,c.event_count,
    case when c.event_count>0 then 'fingerprint'
      when c.branch_complete_through is null or (c.scheduled_end is not null and c.branch_complete_through<c.scheduled_end)
        then 'sync_pending'
      else 'schedule' end
  from with_punches c
  where c.schedule_id is not null or c.event_count>0 or c.exception_type is not null
  order by c.branch,c.name;
end;
$function$;

-- Production definition (2026-10-15) of attendance_policy_shadow_audit_v1 before the migration.
CREATE OR REPLACE FUNCTION public.attendance_policy_shadow_audit_v1(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_policy_shadow_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with days as (
    select a.*,public.resolve_attendance_policy_v2(a.staff_id,a.attendance_date) policy
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(a.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
      and a.status in ('approved','pending_review')
  ), calc as (
    select *,
      coalesce(nullif(policy->>'late_grace_minutes','')::int,15) shadow_late_grace,
      coalesce(nullif(policy->>'very_late_minutes','')::int,30) shadow_very_late,
      coalesce(nullif(policy->>'early_leave_grace_minutes','')::int,0) shadow_early_grace
    from days
  ), compared as (
    select *,
      case
        when coalesce(late_minutes,0)>shadow_very_late then 'very_late'
        when coalesce(late_minutes,0)>shadow_late_grace then 'late'
        when resolution_status in ('late','very_late') then 'on_time'
        else resolution_status
      end shadow_late_status,
      (resolution_status='early_leave_review' and coalesce(early_leave_minutes,0)<=shadow_early_grace and shadow_early_grace>0) early_within_grace
    from calc
  )
  select jsonb_build_object(
    'evaluated_days',count(*),
    'late_classification_changes',count(*) filter(where shadow_late_status is distinct from resolution_status and resolution_status in ('on_time','on_time_with_permission','late','very_late')),
    'early_leave_within_new_grace',count(*) filter(where early_within_grace),
    'policies_resolved',count(*) filter(where policy<>'{}'::jsonb),
    'generated_at',now()
  ) into result
  from compared;

  return result;
end;
$function$;

-- Oracle copy of the same definition, kept after the migration replaces attendance_policy_shadow_audit_v1.
CREATE OR REPLACE FUNCTION public.test_old_attendance_policy_shadow_audit_v1(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_policy_shadow_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with days as (
    select a.*,public.resolve_attendance_policy_v2(a.staff_id,a.attendance_date) policy
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(a.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
      and a.status in ('approved','pending_review')
  ), calc as (
    select *,
      coalesce(nullif(policy->>'late_grace_minutes','')::int,15) shadow_late_grace,
      coalesce(nullif(policy->>'very_late_minutes','')::int,30) shadow_very_late,
      coalesce(nullif(policy->>'early_leave_grace_minutes','')::int,0) shadow_early_grace
    from days
  ), compared as (
    select *,
      case
        when coalesce(late_minutes,0)>shadow_very_late then 'very_late'
        when coalesce(late_minutes,0)>shadow_late_grace then 'late'
        when resolution_status in ('late','very_late') then 'on_time'
        else resolution_status
      end shadow_late_status,
      (resolution_status='early_leave_review' and coalesce(early_leave_minutes,0)<=shadow_early_grace and shadow_early_grace>0) early_within_grace
    from calc
  )
  select jsonb_build_object(
    'evaluated_days',count(*),
    'late_classification_changes',count(*) filter(where shadow_late_status is distinct from resolution_status and resolution_status in ('on_time','on_time_with_permission','late','very_late')),
    'early_leave_within_new_grace',count(*) filter(where early_within_grace),
    'policies_resolved',count(*) filter(where policy<>'{}'::jsonb),
    'generated_at',now()
  ) into result
  from compared;

  return result;
end;
$function$;

-- Production definition (2026-10-15) of attendance_review_triage_v1 before the migration.
CREATE OR REPLACE FUNCTION public.attendance_review_triage_v1(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with pending as (
  select
    a.staff_id,a.attendance_date,a.status,a.resolution_status,
    a.scheduled_start_at,a.scheduled_end_at,
    s.name staff_name,s.branch home_branch
  from public.attendance_daily_summary a
  join public.staff s on s.id=a.staff_id
  where a.attendance_date between p_start and p_end
    and a.status='pending_review'
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
    and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
),
raw_counts as (
  select
    p.*,
    count(b.id)::int raw_events,
    min(b.punch_time) first_raw,
    max(b.punch_time) last_raw
  from pending p
  left join public.biometric_attendance_logs b
    on b.staff_id=p.staff_id
   and (
     (p.scheduled_start_at is not null and p.scheduled_end_at is not null
      and b.punch_time between p.scheduled_start_at-interval '4 hours'
                           and p.scheduled_end_at+interval '6 hours')
     or
     ((p.scheduled_start_at is null or p.scheduled_end_at is null)
      and (b.punch_time at time zone 'Africa/Cairo')::date between p.attendance_date and p.attendance_date+1)
   )
  group by
    p.staff_id,p.attendance_date,p.status,p.resolution_status,
    p.scheduled_start_at,p.scheduled_end_at,p.staff_name,p.home_branch
),
classified as (
  select *,
    case
      when resolution_status in ('no_schedule','invalid_schedule_time','schedule_conflict') then 'schedule_issue'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review') and raw_events=0 then 'true_no_punch'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review') and raw_events=1 then 'single_punch'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review')
        and raw_events>=2
        and first_raw is not null and last_raw is not null
        and extract(epoch from(last_raw-first_raw))/3600.0 between 0.5 and 18
        then 'system_pairable'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review') and raw_events>=2
        then 'system_interpretation'
      else 'manager_review'
    end cause
  from raw_counts
),
unmapped as (
  select
    count(*)::int unmapped_events,
    count(distinct (b.provider,b.biometric_user_id))::int unmapped_codes
  from public.biometric_attendance_logs b
  left join public.biometric_employee_scope sc
    on sc.provider=b.provider and sc.biometric_user_id=b.biometric_user_id
  where b.staff_id is null and coalesce(sc.in_scope,true)=true
    and (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) at time zone 'Africa/Cairo')::date between p_start and p_end
    and (
      p_branch is null or trim(p_branch)='' or p_branch='الكل'
      or trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))=trim(p_branch)
    )
),
cross_branch as (
  select
    count(*)::int cross_events,
    count(distinct b.staff_id)::int cross_staff
  from public.biometric_attendance_logs b
  join public.staff s on s.id=b.staff_id
  where (b.punch_time at time zone 'Africa/Cairo')::date between p_start and p_end
    and nullif(trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch)),'') is not null
    and nullif(trim(s.branch),'') is not null
    and trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))<>trim(s.branch)
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
)
select jsonb_build_object(
  'total_pending',count(*),
  'needs_manager_decision',count(*) filter(
    where cause in ('true_no_punch','single_punch','manager_review','schedule_issue')
  ),
  'true_no_punch',count(*) filter(where cause='true_no_punch'),
  'single_punch',count(*) filter(where cause='single_punch'),
  'system_pairable',count(*) filter(where cause='system_pairable'),
  'system_interpretation',count(*) filter(where cause='system_interpretation'),
  'schedule_issues',count(*) filter(where cause='schedule_issue'),
  'unmapped_active_codes',(select unmapped_codes from unmapped),
  'unmapped_events',(select unmapped_events from unmapped),
  'cross_branch_events',(select cross_events from cross_branch),
  'cross_branch_staff',(select cross_staff from cross_branch),
  'generated_at',now()
)
from classified;
$function$;

-- Oracle copy of the same definition, kept after the migration replaces attendance_review_triage_v1.
CREATE OR REPLACE FUNCTION public.test_old_attendance_review_triage_v1(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
with pending as (
  select
    a.staff_id,a.attendance_date,a.status,a.resolution_status,
    a.scheduled_start_at,a.scheduled_end_at,
    s.name staff_name,s.branch home_branch
  from public.attendance_daily_summary a
  join public.staff s on s.id=a.staff_id
  where a.attendance_date between p_start and p_end
    and a.status='pending_review'
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
    and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
),
raw_counts as (
  select
    p.*,
    count(b.id)::int raw_events,
    min(b.punch_time) first_raw,
    max(b.punch_time) last_raw
  from pending p
  left join public.biometric_attendance_logs b
    on b.staff_id=p.staff_id
   and (
     (p.scheduled_start_at is not null and p.scheduled_end_at is not null
      and b.punch_time between p.scheduled_start_at-interval '4 hours'
                           and p.scheduled_end_at+interval '6 hours')
     or
     ((p.scheduled_start_at is null or p.scheduled_end_at is null)
      and (b.punch_time at time zone 'Africa/Cairo')::date between p.attendance_date and p.attendance_date+1)
   )
  group by
    p.staff_id,p.attendance_date,p.status,p.resolution_status,
    p.scheduled_start_at,p.scheduled_end_at,p.staff_name,p.home_branch
),
classified as (
  select *,
    case
      when resolution_status in ('no_schedule','invalid_schedule_time','schedule_conflict') then 'schedule_issue'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review') and raw_events=0 then 'true_no_punch'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review') and raw_events=1 then 'single_punch'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review')
        and raw_events>=2
        and first_raw is not null and last_raw is not null
        and extract(epoch from(last_raw-first_raw))/3600.0 between 0.5 and 18
        then 'system_pairable'
      when resolution_status in ('missing_checkin','missing_checkout','absence_review') and raw_events>=2
        then 'system_interpretation'
      else 'manager_review'
    end cause
  from raw_counts
),
unmapped as (
  select
    count(*)::int unmapped_events,
    count(distinct (b.provider,b.biometric_user_id))::int unmapped_codes
  from public.biometric_attendance_logs b
  left join public.biometric_employee_scope sc
    on sc.provider=b.provider and sc.biometric_user_id=b.biometric_user_id
  where b.staff_id is null and coalesce(sc.in_scope,true)=true
    and (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) at time zone 'Africa/Cairo')::date between p_start and p_end
    and (
      p_branch is null or trim(p_branch)='' or p_branch='الكل'
      or trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))=trim(p_branch)
    )
),
cross_branch as (
  select
    count(*)::int cross_events,
    count(distinct b.staff_id)::int cross_staff
  from public.biometric_attendance_logs b
  join public.staff s on s.id=b.staff_id
  where (b.punch_time at time zone 'Africa/Cairo')::date between p_start and p_end
    and nullif(trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch)),'') is not null
    and nullif(trim(s.branch),'') is not null
    and trim(public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch))<>trim(s.branch)
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
)
select jsonb_build_object(
  'total_pending',count(*),
  'needs_manager_decision',count(*) filter(
    where cause in ('true_no_punch','single_punch','manager_review','schedule_issue')
  ),
  'true_no_punch',count(*) filter(where cause='true_no_punch'),
  'single_punch',count(*) filter(where cause='single_punch'),
  'system_pairable',count(*) filter(where cause='system_pairable'),
  'system_interpretation',count(*) filter(where cause='system_interpretation'),
  'schedule_issues',count(*) filter(where cause='schedule_issue'),
  'unmapped_active_codes',(select unmapped_codes from unmapped),
  'unmapped_events',(select unmapped_events from unmapped),
  'cross_branch_events',(select cross_events from cross_branch),
  'cross_branch_staff',(select cross_staff from cross_branch),
  'generated_at',now()
)
from classified;
$function$;

-- Production definition (2026-10-15) of attendance_truth_cycle_v2 before the migration.
CREATE OR REPLACE FUNCTION public.attendance_truth_cycle_v2(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_attendance_truth_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not_authorized_for_attendance_truth' using errcode='42501';
  end if;

  with eligible as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.visible_in_schedule,true)
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ),
  attendance as (
    select a.staff_id,
      count(*) filter(where a.status='approved')::int approved_days,
      count(*) filter(where a.status='pending_review')::int pending_days,
      count(*) filter(where a.status='approved' and coalesce(a.candidate_hours,0)>0
        and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review'))::int worked_days,
      round(coalesce(sum(a.candidate_hours) filter(where a.status='approved'
        and coalesce(a.candidate_hours,0)>0
        and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')),0),2) worked_hours,
      count(*) filter(where a.status='approved' and a.resolution_status='off_day')::int off_days,
      count(*) filter(where a.status='approved' and a.resolution_status='approved_time_off')::int leave_days,
      count(*) filter(where a.status='approved' and a.resolution_status='absence_review')::int absence_days,
      count(*) filter(where a.status='approved' and a.resolution_status='worked_on_off')::int worked_on_off_days
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
    group by a.staff_id
  ),
  overtime as (
    select o.staff_id,
      round(coalesce(sum(o.overtime_hours) filter(where o.status='approved'),0),2) approved_ot_hours,
      round(coalesce(sum(o.overtime_hours) filter(where o.status='pending'),0),2) pending_ot_hours,
      count(*) filter(where o.status='pending')::int pending_ot_count,
      count(*) filter(where o.status='approved' and (
        o.source_resolution_id is null or not exists(
          select 1 from public.attendance_daily_summary a
          where a.id=o.source_resolution_id and a.status='approved'
            and public.attendance_resolution_fingerprint_v2(a.id)=o.source_resolution_fingerprint
        )
      ))::int stale_approved_ot
    from public.staff_overtime_approvals o
    where o.attendance_date between p_start and p_end
    group by o.staff_id
  ),
  corrections as (
    select r.staff_id,count(*) filter(where r.status='pending')::int pending_corrections
    from public.attendance_manual_requests r
    where coalesce(r.attendance_date,(r.requested_time at time zone 'Africa/Cairo')::date) between p_start and p_end
    group by r.staff_id
  ),
  timeoff as (
    select r.staff_id,count(*) filter(where r.status='pending')::int pending_timeoff
    from public.staff_time_off_requests r
    where r.start_date<=p_end and r.end_date>=p_start
    group by r.staff_id
  ),
  rows as (
    select e.*,
      coalesce(a.approved_days,0) approved_days,coalesce(a.pending_days,0) pending_days,
      coalesce(a.worked_days,0) worked_days,coalesce(a.worked_hours,0) worked_hours,
      coalesce(a.off_days,0) off_days,coalesce(a.leave_days,0) leave_days,
      coalesce(a.absence_days,0) absence_days,coalesce(a.worked_on_off_days,0) worked_on_off_days,
      coalesce(o.approved_ot_hours,0) approved_ot_hours,coalesce(o.pending_ot_hours,0) pending_ot_hours,
      coalesce(o.pending_ot_count,0) pending_ot_count,coalesce(o.stale_approved_ot,0) stale_approved_ot,
      coalesce(c.pending_corrections,0) pending_corrections,coalesce(t.pending_timeoff,0) pending_timeoff
    from eligible e
    left join attendance a on a.staff_id=e.id
    left join overtime o on o.staff_id=e.id
    left join corrections c on c.staff_id=e.id
    left join timeoff t on t.staff_id=e.id
  )
  select jsonb_build_object(
    'range_start',p_start,'range_end',p_end,'branch',p_branch,
    'summary',jsonb_build_object(
      'staff_count',(select count(*) from rows),
      'approved_days',(select coalesce(sum(approved_days),0) from rows),
      'pending_attendance_days',(select coalesce(sum(pending_days),0) from rows),
      'worked_days',(select coalesce(sum(worked_days),0) from rows),
      'worked_hours',(select coalesce(sum(worked_hours),0) from rows),
      'approved_overtime_hours',(select coalesce(sum(approved_ot_hours),0) from rows),
      'pending_overtime_hours',(select coalesce(sum(pending_ot_hours),0) from rows),
      'pending_corrections',(select coalesce(sum(pending_corrections),0) from rows),
      'pending_timeoff',(select coalesce(sum(pending_timeoff),0) from rows),
      'stale_approved_overtime',(select coalesce(sum(stale_approved_ot),0) from rows),
      'ready_for_payroll_truth',(select coalesce(sum(pending_days),0)=0
        and coalesce(sum(pending_ot_count),0)=0
        and coalesce(sum(stale_approved_ot),0)=0 from rows)
    ),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',id,'staff_name',name,'role',role,'branch',branch,
        'approved_days',approved_days,'pending_attendance_days',pending_days,
        'worked_days',worked_days,'worked_hours',worked_hours,'off_days',off_days,
        'approved_leave_days',leave_days,'absence_days',absence_days,'worked_on_off_days',worked_on_off_days,
        'approved_overtime_hours',approved_ot_hours,'pending_overtime_hours',pending_ot_hours,
        'pending_overtime_count',pending_ot_count,'stale_approved_overtime',stale_approved_ot,
        'pending_corrections',pending_corrections,'pending_timeoff',pending_timeoff,
        'truth_ready',(pending_days=0 and pending_ot_count=0 and stale_approved_ot=0)
      ) order by branch,name) from rows
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;
  return v_result;
end; $function$;

-- Oracle copy of the same definition, kept after the migration replaces attendance_truth_cycle_v2.
CREATE OR REPLACE FUNCTION public.test_old_attendance_truth_cycle_v2(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_attendance_truth_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','view_schedule','manage_payroll']) then
    raise exception 'not_authorized_for_attendance_truth' using errcode='42501';
  end if;

  with eligible as (
    select s.id,s.name,s.role,s.branch
    from public.staff s
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.visible_in_schedule,true)
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ),
  attendance as (
    select a.staff_id,
      count(*) filter(where a.status='approved')::int approved_days,
      count(*) filter(where a.status='pending_review')::int pending_days,
      count(*) filter(where a.status='approved' and coalesce(a.candidate_hours,0)>0
        and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review'))::int worked_days,
      round(coalesce(sum(a.candidate_hours) filter(where a.status='approved'
        and coalesce(a.candidate_hours,0)>0
        and coalesce(a.resolution_status,'') not in ('off_day','approved_time_off','absence_review')),0),2) worked_hours,
      count(*) filter(where a.status='approved' and a.resolution_status='off_day')::int off_days,
      count(*) filter(where a.status='approved' and a.resolution_status='approved_time_off')::int leave_days,
      count(*) filter(where a.status='approved' and a.resolution_status='absence_review')::int absence_days,
      count(*) filter(where a.status='approved' and a.resolution_status='worked_on_off')::int worked_on_off_days
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
    group by a.staff_id
  ),
  overtime as (
    select o.staff_id,
      round(coalesce(sum(o.overtime_hours) filter(where o.status='approved'),0),2) approved_ot_hours,
      round(coalesce(sum(o.overtime_hours) filter(where o.status='pending'),0),2) pending_ot_hours,
      count(*) filter(where o.status='pending')::int pending_ot_count,
      count(*) filter(where o.status='approved' and (
        o.source_resolution_id is null or not exists(
          select 1 from public.attendance_daily_summary a
          where a.id=o.source_resolution_id and a.status='approved'
            and public.attendance_resolution_fingerprint_v2(a.id)=o.source_resolution_fingerprint
        )
      ))::int stale_approved_ot
    from public.staff_overtime_approvals o
    where o.attendance_date between p_start and p_end
    group by o.staff_id
  ),
  corrections as (
    select r.staff_id,count(*) filter(where r.status='pending')::int pending_corrections
    from public.attendance_manual_requests r
    where coalesce(r.attendance_date,(r.requested_time at time zone 'Africa/Cairo')::date) between p_start and p_end
    group by r.staff_id
  ),
  timeoff as (
    select r.staff_id,count(*) filter(where r.status='pending')::int pending_timeoff
    from public.staff_time_off_requests r
    where r.start_date<=p_end and r.end_date>=p_start
    group by r.staff_id
  ),
  rows as (
    select e.*,
      coalesce(a.approved_days,0) approved_days,coalesce(a.pending_days,0) pending_days,
      coalesce(a.worked_days,0) worked_days,coalesce(a.worked_hours,0) worked_hours,
      coalesce(a.off_days,0) off_days,coalesce(a.leave_days,0) leave_days,
      coalesce(a.absence_days,0) absence_days,coalesce(a.worked_on_off_days,0) worked_on_off_days,
      coalesce(o.approved_ot_hours,0) approved_ot_hours,coalesce(o.pending_ot_hours,0) pending_ot_hours,
      coalesce(o.pending_ot_count,0) pending_ot_count,coalesce(o.stale_approved_ot,0) stale_approved_ot,
      coalesce(c.pending_corrections,0) pending_corrections,coalesce(t.pending_timeoff,0) pending_timeoff
    from eligible e
    left join attendance a on a.staff_id=e.id
    left join overtime o on o.staff_id=e.id
    left join corrections c on c.staff_id=e.id
    left join timeoff t on t.staff_id=e.id
  )
  select jsonb_build_object(
    'range_start',p_start,'range_end',p_end,'branch',p_branch,
    'summary',jsonb_build_object(
      'staff_count',(select count(*) from rows),
      'approved_days',(select coalesce(sum(approved_days),0) from rows),
      'pending_attendance_days',(select coalesce(sum(pending_days),0) from rows),
      'worked_days',(select coalesce(sum(worked_days),0) from rows),
      'worked_hours',(select coalesce(sum(worked_hours),0) from rows),
      'approved_overtime_hours',(select coalesce(sum(approved_ot_hours),0) from rows),
      'pending_overtime_hours',(select coalesce(sum(pending_ot_hours),0) from rows),
      'pending_corrections',(select coalesce(sum(pending_corrections),0) from rows),
      'pending_timeoff',(select coalesce(sum(pending_timeoff),0) from rows),
      'stale_approved_overtime',(select coalesce(sum(stale_approved_ot),0) from rows),
      'ready_for_payroll_truth',(select coalesce(sum(pending_days),0)=0
        and coalesce(sum(pending_ot_count),0)=0
        and coalesce(sum(stale_approved_ot),0)=0 from rows)
    ),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',id,'staff_name',name,'role',role,'branch',branch,
        'approved_days',approved_days,'pending_attendance_days',pending_days,
        'worked_days',worked_days,'worked_hours',worked_hours,'off_days',off_days,
        'approved_leave_days',leave_days,'absence_days',absence_days,'worked_on_off_days',worked_on_off_days,
        'approved_overtime_hours',approved_ot_hours,'pending_overtime_hours',pending_ot_hours,
        'pending_overtime_count',pending_ot_count,'stale_approved_overtime',stale_approved_ot,
        'pending_corrections',pending_corrections,'pending_timeoff',pending_timeoff,
        'truth_ready',(pending_days=0 and pending_ot_count=0 and stale_approved_ot=0)
      ) order by branch,name) from rows
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;
  return v_result;
end; $function$;

-- Production definition (2026-10-15) of overtime_truth_status_v2 before the migration.
CREATE OR REPLACE FUNCTION public.overtime_truth_status_v2(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_overtime_truth_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','manage_payroll']) then
    raise exception 'not_authorized_for_overtime_truth' using errcode='42501';
  end if;
  with rows as (
    select o.*,a.status attendance_status,a.resolution_status attendance_resolution_status,
      case when o.source_resolution_id is null then 'unlinked'
           when a.id is null then 'source_missing'
           when a.status<>'approved' then 'attendance_reopened'
           when public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint then 'attendance_changed'
           else 'valid' end truth_state
    from public.staff_overtime_approvals o
    left join public.attendance_daily_summary a on a.id=o.source_resolution_id
    where o.attendance_date between p_start and p_end
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(o.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(o.staff_id,o.branch)
  )
  select jsonb_build_object(
    'range_start',p_start,'range_end',p_end,'branch',p_branch,
    'pending',(select count(*) from rows where status='pending'),
    'approved',(select count(*) from rows where status='approved'),
    'rejected',(select count(*) from rows where status='rejected'),
    'approved_stale',(select count(*) from rows where status='approved' and truth_state<>'valid'),
    'pending_unlinked',(select count(*) from rows where status='pending' and truth_state='unlinked'),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'staff_id',staff_id,'staff_name',staff_name,'branch',branch,'attendance_date',attendance_date,
      'overtime_hours',overtime_hours,'status',status,'source_resolution_id',source_resolution_id,'truth_state',truth_state,
      'attendance_status',attendance_status,'attendance_resolution_status',attendance_resolution_status,
      'decided_by_name',decided_by_name,'decided_at',decided_at
    ) order by attendance_date desc,staff_name) from rows where truth_state<>'valid'),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;
  return v_result;
end; $function$;

-- Oracle copy of the same definition, kept after the migration replaces overtime_truth_status_v2.
CREATE OR REPLACE FUNCTION public.test_old_overtime_truth_status_v2(p_start date, p_end date, p_branch text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_result jsonb;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
    raise exception 'invalid_overtime_truth_range' using errcode='22023';
  end if;
  if not public.dawaa_current_actor_can(array['view_attendance_leaves','manage_payroll']) then
    raise exception 'not_authorized_for_overtime_truth' using errcode='42501';
  end if;
  with rows as (
    select o.*,a.status attendance_status,a.resolution_status attendance_resolution_status,
      case when o.source_resolution_id is null then 'unlinked'
           when a.id is null then 'source_missing'
           when a.status<>'approved' then 'attendance_reopened'
           when public.attendance_resolution_fingerprint_v2(a.id) is distinct from o.source_resolution_fingerprint then 'attendance_changed'
           else 'valid' end truth_state
    from public.staff_overtime_approvals o
    left join public.attendance_daily_summary a on a.id=o.source_resolution_id
    where o.attendance_date between p_start and p_end
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(o.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(o.staff_id,o.branch)
  )
  select jsonb_build_object(
    'range_start',p_start,'range_end',p_end,'branch',p_branch,
    'pending',(select count(*) from rows where status='pending'),
    'approved',(select count(*) from rows where status='approved'),
    'rejected',(select count(*) from rows where status='rejected'),
    'approved_stale',(select count(*) from rows where status='approved' and truth_state<>'valid'),
    'pending_unlinked',(select count(*) from rows where status='pending' and truth_state='unlinked'),
    'rows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',id,'staff_id',staff_id,'staff_name',staff_name,'branch',branch,'attendance_date',attendance_date,
      'overtime_hours',overtime_hours,'status',status,'source_resolution_id',source_resolution_id,'truth_state',truth_state,
      'attendance_status',attendance_status,'attendance_resolution_status',attendance_resolution_status,
      'decided_by_name',decided_by_name,'decided_at',decided_at
    ) order by attendance_date desc,staff_name) from rows where truth_state<>'valid'),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;
  return v_result;
end; $function$;

grant execute on all functions in schema public to anon, authenticated;
