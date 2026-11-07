-- Owner request 2026-11-07, for the fingerprints page:
-- 1. «البصمات اليدوية»: record a punch by name in seconds, and see per employee how many there are, how many count,
--    and how many fall inside the cycle's missing-punch allowance.
-- 2. Staff whose branch is «كل الفروع» (د/ علا، د وائل) punch every day, but the attendance engine treats them as
--    out of scope, so the page never listed them. They now show, read from their punches and nothing else. Their
--    days are built on read: attendance_daily_summary and payroll stay exactly as they are.

create or replace function public.dr_wael_all_branch_puncher_v1(p_staff_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1 from public.staff s
    where s.id = p_staff_id and s.is_active is true
      and coalesce(s.branch, '') not in ('فرع شكري', 'فرع الشامي', 'المخزن')
      and exists (select 1 from public.staff_attendance_logs l
                  where l.staff_id = s.id and l.recorded_at >= now() - interval '60 days')
  );
$function$;

-- First to last accepted punch of each shift date, the same rule the flexible schedule follows.
create or replace function public.dr_wael_all_branch_days_v1(p_start date, p_end date)
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', x.staff_id, 'date', x.shift_date, 'branch', x.branch,
      'first_in', x.first_at,
      'last_out', case when x.has_span then x.last_at end,
      'hours', case when x.has_span then round((extract(epoch from (x.last_at - x.first_at)) / 3600.0)::numeric, 2) else 0 end,
      'payable_hours', null,
      'late_minutes', 0, 'early_leave_minutes', 0, 'missing_punch', false,
      'status', 'approved', 'resolution', 'flexible_present', 'review', false,
      'scheduled_start', null, 'scheduled_end', null, 'time_off', false,
      'punches', x.n, 'other_branch', null)
    order by x.shift_date desc), '[]'::jsonb)
  from (
    select l.staff_id, l.shift_date, s.branch, min(l.recorded_at) as first_at, max(l.recorded_at) as last_at,
           count(*)::int as n,
           max(l.recorded_at) > min(l.recorded_at) + interval '2 minutes' as has_span
    from public.staff_attendance_logs l
    join public.staff s on s.id = l.staff_id
    where l.status = 'accepted' and l.shift_date between p_start and p_end
      and public.dr_wael_all_branch_puncher_v1(l.staff_id)
    group by l.staff_id, l.shift_date, s.branch
  ) x;
$function$;

do $migration$
declare
  v_before text;
  v_after text;
begin
  v_before := pg_get_functiondef('public.get_dr_wael_fingerprints_v1(text)'::regprocedure);

  v_after := replace(
    v_before,
    $q$select s.id from public.staff s where s.is_active is true and s.branch = any(v_branches)$q$,
    $q$select s.id from public.staff s where s.is_active is true and (s.branch = any(v_branches) or public.dr_wael_all_branch_puncher_v1(s.id))$q$
  );
  if v_after = v_before then
    raise exception 'get_dr_wael_fingerprints_v1: staff scope not found';
  end if;

  v_before := v_after;
  v_after := replace(
    v_before,
    $q$'branches', to_jsonb(v_branches), 'employees', v_employees, 'days', v_days,$q$,
    $q$'branches', to_jsonb(v_branches || 'كل الفروع'::text), 'employees', v_employees,
    'days', v_days || public.dr_wael_all_branch_days_v1(v_start, v_end),$q$
  );
  if v_after = v_before then
    raise exception 'get_dr_wael_fingerprints_v1: return not found';
  end if;

  execute v_after;
end;
$migration$;

-- p_date is the shift's day and p_next_day says the time falls on the morning after it, so an overnight check-out
-- lands on the right shift. The time is read in Cairo here, never in the browser's zone.
create or replace function public.dr_wael_record_manual_punch_v1(
  p_staff_id uuid,
  p_date date,
  p_type text,
  p_time time without time zone,
  p_next_day boolean default false,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor_id uuid := public.dr_wael_fingerprints_actor_v1();
  v_actor public.staff_accounts%rowtype;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_note text := coalesce(nullif(trim(p_note), ''), 'بصمة يدوية من صفحة البصمات');
  v_staff public.staff%rowtype;
  v_at timestamptz;
  v_cycle record;
  v_label text;
  v_incident public.attendance_missing_punch_incidents%rowtype;
  v_occurrence int;
  v_log uuid;
  v_route jsonb;
  v_day public.attendance_daily_summary%rowtype;
begin
  if p_staff_id is null or p_date is null or p_time is null or p_type not in ('check_in', 'check_out') then
    raise exception 'manual_punch_invalid' using errcode = '22023';
  end if;
  if p_date < v_today - 40 or p_date > v_today then
    raise exception 'manual_punch_date_out_of_range' using errcode = '22023';
  end if;
  v_at := ((p_date + case when coalesce(p_next_day, false) then 1 else 0 end) + p_time) at time zone 'Africa/Cairo';
  if v_at > now() + interval '5 minutes' then
    raise exception 'manual_punch_in_future' using errcode = '22023';
  end if;

  select * into v_staff from public.staff where id = p_staff_id and coalesce(active, false) = true;
  if not found then
    raise exception 'manual_punch_staff_not_active' using errcode = '22023';
  end if;
  select * into v_actor from public.staff_accounts where id = v_actor_id;

  v_label := public.dawaa_points_cycle_label_for_date_v3(p_date);
  -- The same locks resolve_missing_punch_incident_v1 takes, so the two can never hand out one occurrence number twice.
  perform pg_advisory_xact_lock(hashtextextended(p_staff_id::text || ':' || p_date::text || ':' || p_type, 0));
  perform pg_advisory_xact_lock(hashtextextended('missing-punch-cycle:' || p_staff_id::text || ':' || v_label, 0));

  select * into v_cycle from public.dawaa_pay_cycle_bounds_v1(p_date);
  if exists (select 1 from public.payroll_finalized_snapshots_v2 f
             where f.staff_id = p_staff_id and f.month_cycle = v_cycle.month_cycle)
     or exists (select 1 from public.staff_payroll_monthly_v13 m
                where m.staff_id = p_staff_id
                  and ((m.cycle_start = v_cycle.cycle_start and m.cycle_end = v_cycle.cycle_end)
                       or m.payroll_month = v_cycle.cycle_end)
                  and (coalesce(m.status, '') in ('approved', 'paid', 'locked', 'closed')
                       or m.approved_at is not null or m.paid_at is not null)) then
    raise exception 'manual_punch_cycle_locked' using errcode = '55000';
  end if;

  if exists (select 1 from public.attendance_daily_summary a
             where a.staff_id = p_staff_id and a.attendance_date = p_date
               and a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%') then
    raise exception 'manual_punch_day_approved' using errcode = '55000';
  end if;
  if exists (select 1 from public.staff_attendance_logs l
             where l.staff_id = p_staff_id and l.shift_date = p_date
               and l.attendance_type = p_type and l.status = 'accepted') then
    raise exception 'manual_punch_already_exists' using errcode = '55000';
  end if;

  perform set_config('dawaa.manual_attendance_target', v_staff.id::text, true);
  insert into public.staff_attendance_logs(
    staff_id, staff_name, role, branch_name, attendance_type, recorded_at,
    shift_date, biometric_verified, biometric_method, status, rejection_reason, created_by)
  values (
    v_staff.id, v_staff.name, v_staff.role, v_staff.branch, p_type, v_at,
    p_date, false, 'not_checked', 'accepted', null, v_actor.id)
  returning id into v_log;

  select * into v_incident from public.attendance_missing_punch_incidents
  where staff_id = p_staff_id and attendance_date = p_date and missing_type = p_type
  for update;
  if v_incident.id is null then
    select count(*)::int + 1 into v_occurrence from public.attendance_missing_punch_incidents
    where staff_id = p_staff_id and month_cycle = v_label;
    insert into public.attendance_missing_punch_incidents(
      staff_id, staff_name, branch, attendance_date, missing_type, month_cycle,
      occurrence_no, allowance_limit, penalty_eligible, penalty_amount,
      reason, actor_id, actor_name, actor_role, manual_punch_id)
    values (
      v_staff.id, v_staff.name, v_staff.branch, p_date, p_type, v_label,
      v_occurrence, 2, v_occurrence > 2, 50,
      v_note, v_actor.id::text, coalesce(v_actor.name, v_actor.staff_name, v_actor.username), v_actor.role, v_log)
    returning * into v_incident;
  else
    update public.attendance_missing_punch_incidents
    set manual_punch_id = v_log, reason = v_note, updated_at = now()
    where id = v_incident.id
    returning * into v_incident;
  end if;

  insert into public.attendance_manual_actions_audit(
    action_type, staff_id, target_id, old_value, new_value, reason, actor_account_id, actor_name, actor_role)
  values (
    'manual_punch_entry', v_staff.id, v_log, null,
    jsonb_build_object('attendance_type', p_type, 'recorded_at', v_at, 'attendance_date', p_date,
                       'incident_id', v_incident.id, 'occurrence_no', v_incident.occurrence_no),
    v_note, v_actor.id, coalesce(v_actor.name, v_actor.staff_name, v_actor.username), v_actor.role);

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('manual_punch', p_staff_id,
          jsonb_build_object('date', p_date, 'type', p_type, 'at', v_at, 'log_id', v_log, 'note', v_note), v_actor_id);

  -- A day the system approved is read again with the new punch. The flexible schedule has its own engine, and
  -- staff outside the engine have no stored day.
  v_route := public.dawaa_attendance_engine_route_v1(p_staff_id);
  if coalesce((v_route->>'in_scope')::boolean, false) then
    update public.attendance_daily_summary
    set status = 'pending_review', updated_at = now()
    where staff_id = p_staff_id and attendance_date = p_date and status = 'approved' and approved_by like 'system:%';
    if v_route->>'route' = 'flexible_v3' then
      perform public.dawaa_materialize_attendance_day_internal_v3(p_staff_id, p_date);
    else
      perform public.dawaa_materialize_attendance_day_internal_v2(p_staff_id, p_date);
    end if;
    select * into v_day from public.attendance_daily_summary
    where staff_id = p_staff_id and attendance_date = p_date;
  end if;

  return jsonb_build_object(
    'id', v_log, 'staff_id', p_staff_id, 'date', p_date, 'type', p_type, 'at', v_at,
    'occurrence_no', v_incident.occurrence_no, 'allowance_limit', v_incident.allowance_limit,
    'over_allowance', v_incident.occurrence_no > v_incident.allowance_limit,
    'day_status', v_day.status, 'resolution', v_day.resolution_status);
end;
$function$;

create or replace function public.get_dr_wael_manual_punches_v1(p_month_cycle text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_cycle text := p_month_cycle;
  v_start date;
  v_end date;
  v_rows jsonb;
begin
  perform public.dr_wael_fingerprints_actor_v1();
  if v_cycle is null then
    v_cycle := to_char(case when extract(day from v_today) >= 26 then v_today + interval '1 month' else v_today end, 'YYYY-MM');
  elsif v_cycle !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_cycle' using errcode = '22023';
  end if;
  v_end := to_date(v_cycle || '-25', 'YYYY-MM-DD');
  v_start := (v_end - interval '1 month')::date + 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'staff_id', l.staff_id, 'date', l.shift_date, 'type', l.attendance_type, 'at', l.recorded_at,
      'reason', coalesce(i.reason, au.reason), 'by', au.actor_name,
      'occurrence_no', i.occurrence_no, 'allowance_limit', i.allowance_limit,
      'penalized', i.deduction_transaction_id is not null,
      'day_status', a.status, 'resolution', a.resolution_status,
      -- Counted: the day is approved with paid hours. Staff outside the engine have no stored day to wait on.
      'counted', case when a.id is null then public.dr_wael_all_branch_puncher_v1(l.staff_id)
                      else a.status = 'approved' and coalesce(a.payroll_eligible_hours, 0) > 0 end)
    order by l.recorded_at desc), '[]'::jsonb)
    into v_rows
  from public.staff_attendance_logs l
  left join public.attendance_missing_punch_incidents i on i.manual_punch_id = l.id
  left join lateral (select x.reason, x.actor_name from public.attendance_manual_actions_audit x
                     where x.target_id = l.id and x.action_type = 'manual_punch_entry'
                     order by x.created_at desc limit 1) au on true
  left join public.attendance_daily_summary a on a.staff_id = l.staff_id and a.attendance_date = l.shift_date
  where l.shift_date between v_start and v_end
    and l.status = 'accepted' and l.biometric_verified is false
    and l.biometric_source_log_id is null
    -- Typed by a manager, not an employee's own check-in from the app.
    and (l.created_by is not null or i.id is not null or au.reason is not null);

  return jsonb_build_object('month_cycle', v_cycle, 'cycle_start', v_start, 'cycle_end', v_end,
                            'missing_limit', 2, 'rows', v_rows);
end;
$function$;

revoke all on function public.dr_wael_all_branch_puncher_v1(uuid) from public, anon, authenticated;
revoke all on function public.dr_wael_all_branch_days_v1(date, date) from public, anon, authenticated;
revoke all on function public.dr_wael_record_manual_punch_v1(uuid, date, text, time, boolean, text) from public;
revoke all on function public.get_dr_wael_manual_punches_v1(text) from public;
-- The site's staff session runs as anon; dr_wael_fingerprints_actor_v1 refuses everyone but the page's two viewers.
grant execute on function public.dr_wael_record_manual_punch_v1(uuid, date, text, time, boolean, text) to anon, authenticated;
grant execute on function public.get_dr_wael_manual_punches_v1(text) to anon, authenticated;
