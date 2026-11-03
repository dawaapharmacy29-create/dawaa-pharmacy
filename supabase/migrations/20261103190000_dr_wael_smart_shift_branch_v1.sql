-- «بصمات د وائل» v2: the fingerprints tell the schedule and the branch.
--  * المخزن joins the attendance engine: its staff punch on the branch devices but their days were never built.
--  * Delivery is read from the payroll classification (role «توصيل» with type Pharmacist is still a driver).
--  * Smart insights: who keeps punching at other hours than the schedule (with the shift the punches suggest)
--    and which branch device each employee actually uses. Staff who inventory the branches (roaming) are
--    never asked to move; the page only shows where they punched today.
--  * Two actions for the two viewers: apply a shift (permanent from a date, one day, or a period) and move an
--    employee to the branch the device shows. Both write the admin app's own tables and are logged.
-- Payroll, points and incentives are not touched; changed days are rebuilt by the canonical day resolver,
-- and a day a manager approved is left to the manager.

-- 1) المخزن joins the attendance engine scope (the engine hard-codes the two device branches).
do $$
declare
  v_fn text;
  v_def text;
  v_new text;
begin
  foreach v_fn in array array[
    'public.dawaa_mark_attendance_dirty_from_log_v1()',
    'public.dawaa_mark_attendance_dirty_v1(uuid,date,text)',
    'public.dawaa_enqueue_attendance_materialization_v1()',
    'public.dawaa_attendance_engine_route_v1(uuid)',
    'public.dawaa_materialize_attendance_range_internal_v2(date,date,text)',
    'public.dawaa_materialize_attendance_range_route_aware_v1(date,date,text)',
    'public.dawaa_reconcile_attendance_dirty_day_v1(uuid,date)',
    'public.dawaa_reconcile_attendance_range_route_aware_v1(date,date,text)',
    'public.dawaa_reconcile_attendance_system_review_backlog_v1(integer)',
    'public.dawaa_reconcile_flexible_attendance_dirty_day_v1(uuid,date)',
    'public.attendance_daily_command_v1(date,text)',
    'public.attendance_daily_intelligence_v2(date,text)',
    'public.attendance_schedule_health_v1(text)',
    'public.get_attendance_system_health_core_v1(text)',
    'public.list_biometric_mapping_staff_candidates_v1(text,integer)'
  ] loop
    if to_regprocedure(v_fn) is null then
      continue;
    end if;
    v_def := pg_get_functiondef(to_regprocedure(v_fn));
    v_new := replace(v_def, $q$('فرع الشامي','فرع شكري')$q$, $q$('فرع الشامي','فرع شكري','المخزن')$q$);
    if v_new = v_def then
      if position($q$'المخزن'$q$ in v_def) > 0 then
        continue;
      end if;
      raise exception 'attendance_scope_pattern_missing: %', v_fn;
    end if;
    execute v_new;
  end loop;
end $$;

-- Build the warehouse days of the current pay cycle that were never built.
do $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_start date;
  v_day record;
begin
  if to_regprocedure('public.dawaa_materialize_attendance_day_internal_v3(uuid,date)') is null then
    return;
  end if;
  v_start := (date_trunc('month', case when extract(day from v_today) >= 26 then v_today else v_today - interval '1 month' end)
              + interval '25 days')::date;
  for v_day in
    select distinct l.staff_id, l.shift_date
    from public.staff_attendance_logs l
    join public.staff s on s.id = l.staff_id
    where s.branch = 'المخزن' and coalesce(s.active, s.is_active, false)
      and l.shift_date between v_start and v_today - 1
      and not exists (select 1 from public.attendance_daily_summary a
                      where a.staff_id = l.staff_id and a.attendance_date = l.shift_date)
  loop
    perform public.dawaa_materialize_attendance_day_internal_v3(v_day.staff_id, v_day.shift_date);
  end loop;
end $$;

-- 2) Staff who inventory the branches, and the log of what the page changed.
create table if not exists public.dr_wael_roaming_staff_v1(
  staff_id uuid primary key references public.staff(id) on delete cascade,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.dr_wael_roaming_staff_v1 enable row level security;
revoke all on table public.dr_wael_roaming_staff_v1 from public, anon, authenticated;

create table if not exists public.dr_wael_change_log_v1(
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  staff_id uuid not null,
  payload jsonb not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);
alter table public.dr_wael_change_log_v1 enable row level security;
revoke all on table public.dr_wael_change_log_v1 from public, anon, authenticated;

insert into public.dr_wael_roaming_staff_v1(staff_id, note)
select s.id, 'جرد الفروع'
from public.staff s
where s.is_active is true and trim(s.name) in ('هاجر', 'هبه محمد', 'نور')
  and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن')
on conflict (staff_id) do nothing;

-- 3) Helpers.
create or replace function public.dr_wael_device_branch_v1(p_provider text)
returns text
language sql
immutable
as $$
  select case p_provider
    when 'zk_shami_direct_bridge' then 'فرع الشامي'
    when 'zk_shokry_direct_bridge' then 'فرع شكري'
  end;
$$;

-- Signed minutes from b to a on a 24h clock, in [-720, 720).
create or replace function public.dr_wael_clock_diff_v1(p_a numeric, p_b numeric)
returns numeric
language sql
immutable
as $$
  select (((p_a - p_b + 720)::numeric % 1440) + 1440) % 1440 - 720;
$$;

-- Minutes after midnight rounded to the nearest half hour, as a clock time.
create or replace function public.dr_wael_round_clock_v1(p_minutes numeric)
returns time
language sql
immutable
as $$
  select time '00:00' + make_interval(mins => ((((round(p_minutes / 30.0) * 30)::int % 1440) + 1440) % 1440));
$$;

create or replace function public.dr_wael_is_delivery_v1(p_staff_id uuid, p_month_cycle text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  return coalesce((public.dawaa_delivery_payroll_classification_v1(p_staff_id, p_month_cycle)->>'payroll_eligible')::boolean, false);
exception when others then
  return exists (select 1 from public.staff s where s.id = p_staff_id
                 and lower(coalesce(s.type, '') || ' ' || coalesce(s.role, '')) ~ '(deliver|توصيل)');
end;
$function$;

revoke all on function public.dr_wael_device_branch_v1(text) from public, anon, authenticated;
revoke all on function public.dr_wael_clock_diff_v1(numeric, numeric) from public, anon, authenticated;
revoke all on function public.dr_wael_round_clock_v1(numeric) from public, anon, authenticated;
revoke all on function public.dr_wael_is_delivery_v1(uuid, text) from public, anon, authenticated;

-- 4) The page bundle, now with the payroll delivery rule and the roaming flag.
create or replace function public.get_dr_wael_fingerprints_v1(p_month_cycle text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_branches text[] := array['فرع شكري', 'فرع الشامي', 'المخزن'];
  v_cycle text := p_month_cycle;
  v_start date;
  v_end date;
  v_staff uuid[];
  v_employees jsonb;
  v_days jsonb;
  v_time_off jsonb;
  v_incentives jsonb;
  v_movements jsonb;
  v_manual jsonb;
begin
  perform public.dr_wael_fingerprints_actor_v1();
  if v_cycle is null then
    v_cycle := to_char(case when extract(day from v_today) >= 26 then v_today + interval '1 month' else v_today end, 'YYYY-MM');
  elsif v_cycle !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_cycle' using errcode = '22023';
  end if;
  v_end := to_date(v_cycle || '-25', 'YYYY-MM-DD');
  v_start := (v_end - interval '1 month')::date + 1;

  -- Today's staff of the three branches plus anyone with an attendance day there in the cycle.
  select coalesce(array_agg(distinct x.id), '{}') into v_staff
  from (
    select s.id from public.staff s where s.is_active is true and s.branch = any(v_branches)
    union
    select a.staff_id from public.attendance_daily_summary a
    where a.attendance_date between v_start and v_end and a.branch = any(v_branches) and a.staff_id is not null
  ) x;

  -- The week ending today, from the canonical per-day schedule resolver.
  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', s.id, 'name', s.name, 'branch', s.branch, 'role', s.role, 'type', s.type,
      'active', coalesce(s.is_active, false), 'delivery', public.dr_wael_is_delivery_v1(s.id, v_cycle),
      'roaming', exists (select 1 from public.dr_wael_roaming_staff_v1 r where r.staff_id = s.id),
      'join_date', s.join_date,
      'week', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d.day, 'start', w.shift_start, 'end', w.shift_end,
            'off', coalesce(w.is_off, false) or coalesce(w.is_day_off, false), 'scheduled', w.staff_id is not null)
          order by d.day), '[]'::jsonb)
        from (select v_today - g as day from generate_series(0, 6) g) d
        left join lateral (select * from public.attendance_schedule_for_date_v1(s.id, d.day) limit 1) w on true)
    ) order by s.branch, s.name), '[]'::jsonb)
    into v_employees
  from public.staff s where s.id = any(v_staff);

  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', a.staff_id, 'date', a.attendance_date, 'branch', a.branch,
      'first_in', a.first_in, 'last_out', a.last_out, 'hours', a.total_hours, 'payable_hours', a.payroll_eligible_hours,
      'late_minutes', coalesce(a.late_minutes, 0), 'early_leave_minutes', coalesce(a.early_leave_minutes, 0),
      'missing_punch', coalesce(a.missing_punch, false), 'status', a.status, 'resolution', a.resolution_status,
      'review', coalesce(a.review_required, a.status = 'pending_review'),
      'scheduled_start', a.scheduled_start_at, 'scheduled_end', a.scheduled_end_at,
      'time_off', a.time_off_request_id is not null, 'punches', coalesce(p.n, 0))
    order by a.attendance_date desc, a.branch), '[]'::jsonb)
    into v_days
  from public.attendance_daily_summary a
  left join (
    select b.staff_id, (b.punch_time at time zone 'Africa/Cairo')::date as day, count(*)::int as n
    from public.biometric_attendance_logs b
    where b.staff_id = any(v_staff)
      and b.punch_time >= (v_start::timestamp at time zone 'Africa/Cairo')
      and b.punch_time < ((v_end + 1)::timestamp at time zone 'Africa/Cairo')
    group by 1, 2
  ) p on p.staff_id = a.staff_id and p.day = a.attendance_date
  where a.attendance_date between v_start and v_end and a.branch = any(v_branches);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'staff_id', r.staff_id, 'kind', r.request_kind, 'label', r.request_label, 'status', r.status,
      'start_date', r.start_date, 'end_date', coalesce(r.end_date, r.start_date), 'start_time', r.start_time,
      'end_time', r.end_time, 'minutes', r.duration_minutes, 'reason', r.reason, 'decided_by', r.decided_by_name)
    order by r.start_date desc), '[]'::jsonb)
    into v_time_off
  from public.staff_time_off_requests r
  where r.staff_id = any(v_staff) and r.status <> 'cancelled'
    and r.start_date <= v_end and coalesce(r.end_date, r.start_date) >= v_start;

  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', t.staff_id, 'performance_incentive', coalesce(t.performance_incentive, 0),
      'target_bonus', coalesce(t.target_bonus, 0), 'automated_total', coalesce(t.automated_incentives_total, 0))), '[]'::jsonb)
    into v_incentives
  from public.staff_payroll_incentive_truth_v1 t
  where t.month_cycle = v_cycle and t.staff_id = any(v_staff);

  -- Money movements on the employee ledger this cycle (rewards and penalties with an amount).
  select coalesce(jsonb_agg(x.row order by x.day desc), '[]'::jsonb) into v_movements
  from (
    select e.transaction_date as day, jsonb_build_object(
        'id', e.id, 'staff_id', e.staff_id, 'type', e.type, 'category', e.category,
        'reason', coalesce(nullif(e.display_reason, ''), nullif(e.title, ''), e.reason),
        'amount', e.amount, 'date', e.transaction_date, 'status', e.status) as row
    from public.employee_transactions e
    where e.month_cycle = v_cycle and e.staff_id = any(v_staff)
      and coalesce(e.amount, 0) <> 0 and e.status in ('approved', 'active')
    order by e.transaction_date desc
    limit 500
  ) x;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'staff_id', m.staff_id, 'kind', m.entry_kind, 'category', m.category, 'amount', m.amount,
      'signed_amount', m.signed_amount, 'reason', m.reason, 'reversal_of', m.reversal_of,
      'created_at', m.created_at, 'created_by', m.created_by_name) order by m.created_at desc), '[]'::jsonb)
    into v_manual
  from public.staff_payroll_manual_entries_v1 m
  where m.month_cycle = v_cycle and m.staff_id = any(v_staff);

  return jsonb_build_object(
    'month_cycle', v_cycle, 'cycle_start', v_start, 'cycle_end', v_end, 'today', v_today,
    'branches', to_jsonb(v_branches), 'employees', v_employees, 'days', v_days, 'time_off', v_time_off,
    'incentives', v_incentives, 'movements', v_movements, 'manual_entries', v_manual);
end;
$function$;

-- 5) What the last two weeks of punches say, per employee of the three branches.
--  shift: at least 3 recent worked days 90+ minutes away from the schedule (or with no schedule) that agree
--         with each other; the suggested shift is their median, to the half hour.
--  branch: the device branch of 70%+ of the punch days (3+ days) when it is not the employee's branch.
create or replace function public.get_dr_wael_smart_insights_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_branches text[] := array['فرع شكري', 'فرع الشامي', 'المخزن'];
  v_result jsonb;
begin
  perform public.dr_wael_fingerprints_actor_v1();

  with st as (
    select s.id, s.branch, exists (select 1 from public.dr_wael_roaming_staff_v1 r where r.staff_id = s.id) as roaming
    from public.staff s where s.is_active is true and s.branch = any(v_branches)
  ),
  worked as (
    select l.staff_id, l.shift_date as day, min(l.recorded_at) as first_at, max(l.recorded_at) as last_at
    from public.staff_attendance_logs l
    join st on st.id = l.staff_id
    where l.shift_date between v_today - 14 and v_today - 1
      and l.recorded_at is not null and coalesce(l.status, 'accepted') <> 'rejected'
    group by 1, 2
    having count(*) >= 2 and max(l.recorded_at) - min(l.recorded_at) >= interval '3 hours'
  ),
  scheduled as (
    select w.*, sc.shift_start, sc.shift_end,
      sc.staff_id is not null and sc.shift_start is not null as has_schedule,
      coalesce(sc.is_off, false) or coalesce(sc.is_day_off, false) as off,
      extract(hour from w.first_at at time zone 'Africa/Cairo') * 60 + extract(minute from w.first_at at time zone 'Africa/Cairo') as fm,
      extract(hour from w.last_at at time zone 'Africa/Cairo') * 60 + extract(minute from w.last_at at time zone 'Africa/Cairo') as tm,
      row_number() over (partition by w.staff_id order by w.day desc) as recent_rank
    from worked w
    left join lateral (select * from public.attendance_schedule_for_date_v1(w.staff_id, w.day) limit 1) sc on true
  ),
  drift as (
    select s.* from scheduled s
    where not s.has_schedule
       or (not s.off and abs(public.dr_wael_clock_diff_v1(s.fm,
             extract(hour from s.shift_start) * 60 + extract(minute from s.shift_start))) >= 90)
  ),
  pivot as (
    select distinct on (staff_id) staff_id, fm as pf, tm as pt from drift order by staff_id, day desc
  ),
  rel as (
    select d.*, public.dr_wael_clock_diff_v1(d.fm, p.pf) as rf, public.dr_wael_clock_diff_v1(d.tm, p.pt) as rt
    from drift d join pivot p using (staff_id)
  ),
  med as (
    select staff_id, (percentile_cont(0.5) within group (order by rf))::numeric as mf,
      (percentile_cont(0.5) within group (order by rt))::numeric as mt
    from rel group by staff_id
  ),
  agree as (
    select r.staff_id, count(*) as n, min(r.day) as since, count(*) filter (where r.recent_rank <= 7) as recent_n,
      jsonb_agg(jsonb_build_object('date', r.day, 'first_in', r.first_at, 'last_out', r.last_at,
        'scheduled_start', r.shift_start, 'scheduled_end', r.shift_end) order by r.day desc) as sample
    from rel r join med m using (staff_id)
    where abs(r.rf - m.mf) <= 60 and abs(r.rt - m.mt) <= 90
    group by r.staff_id
  ),
  shift as (
    select a.staff_id, a.n, a.since, a.sample,
      public.dr_wael_round_clock_v1(p.pf + m.mf) as start_at, public.dr_wael_round_clock_v1(p.pt + m.mt) as end_at
    from agree a join med m using (staff_id) join pivot p using (staff_id)
    where a.n >= 3 and a.recent_n >= 3
  ),
  device_days as (
    select b.staff_id, public.dr_wael_device_branch_v1(b.provider) as branch, (b.punch_time at time zone 'Africa/Cairo')::date as day
    from public.biometric_attendance_logs b
    join st on st.id = b.staff_id
    where b.punch_time >= ((v_today - 14)::timestamp at time zone 'Africa/Cairo')
      and public.dr_wael_device_branch_v1(b.provider) is not null
    group by 1, 2, 3
  ),
  device_sum as (
    select staff_id, branch, count(*) as days from device_days group by 1, 2
  ),
  device_top as (
    select distinct on (ds.staff_id) ds.staff_id, ds.branch, ds.days,
      (select count(distinct dd.day) from device_days dd where dd.staff_id = ds.staff_id) as total
    from device_sum ds order by ds.staff_id, ds.days desc, ds.branch
  ),
  today_device as (
    select distinct on (b.staff_id) b.staff_id, public.dr_wael_device_branch_v1(b.provider) as branch, b.punch_time
    from public.biometric_attendance_logs b
    join st on st.id = b.staff_id
    where b.punch_time >= (v_today::timestamp at time zone 'Africa/Cairo')
      and public.dr_wael_device_branch_v1(b.provider) is not null
    order by b.staff_id, b.punch_time desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', st.id, 'branch', st.branch, 'roaming', st.roaming,
      'shift', case when sh.staff_id is null then null else jsonb_build_object(
          'start', to_char(sh.start_at, 'HH24:MI'), 'end', to_char(sh.end_at, 'HH24:MI'),
          'since', sh.since, 'days', sh.n, 'sample', sh.sample) end,
      'device_branches', (select jsonb_object_agg(ds.branch, ds.days) from device_sum ds where ds.staff_id = st.id),
      'device_branch', dt.branch,
      'today_branch', td.branch,
      'branch_suggestion', case
        when not st.roaming and st.branch <> 'المخزن' and dt.branch is distinct from st.branch
             and dt.days >= 3 and dt.days >= 0.7 * dt.total then dt.branch end)
    order by st.branch, st.id), '[]'::jsonb)
    into v_result
  from st
  left join shift sh on sh.staff_id = st.id
  left join device_top dt on dt.staff_id = st.id
  left join today_device td on td.staff_id = st.id;

  return jsonb_build_object('today', v_today, 'employees', v_result);
end;
$function$;

-- 6) Apply a shift: 'permanent' (a new weekly version from p_from for p_days, default the current working days),
--    'day' (p_from only, even a day off) or 'period' (p_from..p_to, skipping days off). Past days in range
--    are rebuilt by the canonical resolver; a day a manager approved is kept as is.
create or replace function public.dr_wael_apply_shift_change_v1(
  p_staff_id uuid, p_start time, p_end time, p_mode text, p_from date,
  p_to date default null, p_days text[] default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_week text[] := array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  v_note text := coalesce(nullif(trim(p_note), ''), 'تعديل ميعاد من بصمات د وائل');
  v_staff public.staff%rowtype;
  v_to date;
  v_hours numeric;
  v_day text;
  v_date date;
  v_row record;
  v_override uuid;
  v_written int := 0;
  v_rebuilt int := 0;
  v_kept int := 0;
  v_skipped jsonb := '[]'::jsonb;
begin
  if p_staff_id is null or p_start is null or p_end is null or p_start = p_end or p_from is null
     or p_mode not in ('permanent', 'day', 'period') then
    raise exception 'invalid_shift_change' using errcode = '22023';
  end if;
  if p_from < v_today - 40 or p_from > v_today + 60 then
    raise exception 'shift_change_date_out_of_range' using errcode = '22023';
  end if;
  v_to := case p_mode when 'permanent' then null when 'day' then p_from else p_to end;
  if p_mode = 'period' and (v_to is null or v_to < p_from or v_to - p_from > 62) then
    raise exception 'invalid_shift_change_period' using errcode = '22023';
  end if;
  if p_days is not null and not (p_days <@ v_week) then
    raise exception 'invalid_shift_change_days' using errcode = '22023';
  end if;

  select * into v_staff from public.staff s
  where s.id = p_staff_id and s.is_active is true and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن');
  if not found then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;

  v_hours := round((extract(epoch from (p_end - p_start)) / 3600.0
                    + case when p_end <= p_start then 24 else 0 end)::numeric, 2);
  if v_hours > 18 then
    raise exception 'shift_change_exceeds_18_hours' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dr_wael_shift:' || p_staff_id::text, 0));

  if p_mode = 'permanent' then
    foreach v_day in array v_week loop
      select ss.* into v_row from public.shift_schedules ss
      where ss.staff_id = p_staff_id and ss.shift_date is null and ss.date is null and trim(ss.day_name) = v_day
        and ss.effective_from <= p_from and (ss.effective_to is null or ss.effective_to >= p_from)
      order by ss.effective_from desc, coalesce(ss.updated_at, ss.created_at) desc nulls last
      limit 1;
      if p_days is not null then
        if not (v_day = any(p_days)) then
          continue;
        end if;
      elsif found and (coalesce(v_row.is_off, false) or coalesce(v_row.is_day_off, false)) then
        continue;
      end if;

      if found and v_row.effective_from = p_from then
        update public.shift_schedules
        set shift_start = to_char(p_start, 'HH24:MI'), shift_end = to_char(p_end, 'HH24:MI'),
            start_time = p_start, end_time = p_end, hours = v_hours, is_off = false, is_day_off = false,
            has_custom_time = true, is_different = true, source = 'dr_wael_smart_shift_v1',
            notes = concat_ws(' | ', nullif(notes, ''), v_note)
        where id = v_row.id;
      else
        update public.shift_schedules
        set effective_to = p_from - 1,
            notes = concat_ws(' | ', nullif(notes, ''), 'أُغلق بميعاد جديد من بصمات د وائل')
        where staff_id = p_staff_id and shift_date is null and date is null and trim(day_name) = v_day
          and effective_from < p_from and (effective_to is null or effective_to >= p_from);
        insert into public.shift_schedules(
          staff_id, staff_name, employee_name, role, branch, day_name, shift_start, shift_end, start_time, end_time,
          hours, is_off, is_day_off, is_different, has_custom_time, notes, source, status, effective_from, effective_to)
        values (
          p_staff_id, v_staff.name, v_staff.name, v_staff.role, v_staff.branch, v_day,
          to_char(p_start, 'HH24:MI'), to_char(p_end, 'HH24:MI'), p_start, p_end,
          v_hours, false, false, true, true, v_note, 'dr_wael_smart_shift_v1', 'scheduled', p_from, null);
      end if;
      v_written := v_written + 1;
    end loop;
  else
    for v_date in select g::date from generate_series(p_from, v_to, interval '1 day') g loop
      select * into v_row from public.attendance_schedule_for_date_v1(p_staff_id, v_date) limit 1;
      if p_mode = 'period' and found and (coalesce(v_row.is_off, false) or coalesce(v_row.is_day_off, false)) then
        v_skipped := v_skipped || jsonb_build_object('date', v_date, 'reason', 'day_off');
        continue;
      end if;
      select ss.id into v_override from public.shift_schedules ss
      where ss.staff_id = p_staff_id and coalesce(ss.shift_date, ss.date) = v_date and ss.source = 'dr_wael_smart_shift_v1'
      order by coalesce(ss.updated_at, ss.created_at) desc nulls last limit 1;
      if found then
        update public.shift_schedules
        set shift_start = to_char(p_start, 'HH24:MI'), shift_end = to_char(p_end, 'HH24:MI'),
            start_time = p_start, end_time = p_end, hours = v_hours, is_off = false, is_day_off = false,
            notes = v_note
        where id = v_override;
      else
        insert into public.shift_schedules(
          staff_id, staff_name, employee_name, role, branch, day_name, shift_start, shift_end, start_time, end_time,
          hours, is_off, is_day_off, is_different, has_custom_time, shift_date, date, notes, source, status,
          effective_from, effective_to)
        values (
          p_staff_id, v_staff.name, v_staff.name, v_staff.role, v_staff.branch, v_week[extract(dow from v_date)::int + 1],
          to_char(p_start, 'HH24:MI'), to_char(p_end, 'HH24:MI'), p_start, p_end,
          v_hours, false, false, true, true, v_date, v_date, v_note, 'dr_wael_smart_shift_v1', 'scheduled',
          v_date, v_date);
      end if;
      v_written := v_written + 1;
    end loop;
  end if;

  -- Rebuild the past days the change covers.
  for v_date in
    select g::date from generate_series(greatest(p_from, v_today - 40), least(coalesce(v_to, v_today), v_today), interval '1 day') g
  loop
    if exists (select 1 from public.attendance_daily_summary a
               where a.staff_id = p_staff_id and a.attendance_date = v_date
                 and a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%') then
      v_kept := v_kept + 1;
      continue;
    end if;
    if not exists (select 1 from public.attendance_daily_summary a where a.staff_id = p_staff_id and a.attendance_date = v_date)
       and not exists (select 1 from public.staff_attendance_logs l where l.staff_id = p_staff_id and l.shift_date = v_date) then
      continue;
    end if;
    update public.attendance_daily_summary
    set status = 'pending_review', updated_at = now()
    where staff_id = p_staff_id and attendance_date = v_date and status = 'approved' and approved_by like 'system:%';
    perform public.dawaa_materialize_attendance_day_internal_v3(p_staff_id, v_date);
    v_rebuilt := v_rebuilt + 1;
  end loop;

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('shift', p_staff_id, jsonb_build_object('mode', p_mode, 'start', p_start, 'end', p_end, 'from', p_from,
    'to', v_to, 'days', to_jsonb(p_days), 'written', v_written, 'rebuilt', v_rebuilt, 'kept', v_kept,
    'skipped', v_skipped, 'note', v_note), v_actor);

  return jsonb_build_object('success', true, 'staff_id', p_staff_id, 'mode', p_mode, 'from', p_from, 'to', v_to,
    'rows_written', v_written, 'days_rebuilt', v_rebuilt, 'days_kept_manager_approved', v_kept, 'skipped', v_skipped);
end;
$function$;

-- 7) Move an employee to a branch (the device's, or any of the three) and keep the login account with them.
create or replace function public.dr_wael_apply_branch_change_v1(p_staff_id uuid, p_branch text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_from text;
  v_accounts int;
begin
  if p_staff_id is null or p_branch is null or p_branch not in ('فرع شكري', 'فرع الشامي', 'المخزن') then
    raise exception 'invalid_branch_change' using errcode = '22023';
  end if;
  select s.branch into v_from from public.staff s
  where s.id = p_staff_id and s.is_active is true and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن')
  for update;
  if not found then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;
  if v_from = p_branch then
    return jsonb_build_object('success', true, 'changed', false, 'branch', p_branch);
  end if;

  update public.staff set branch = p_branch where id = p_staff_id;
  update public.staff_accounts set branch = p_branch
  where staff_id::text = p_staff_id::text and coalesce(active, false) and branch is distinct from p_branch;
  get diagnostics v_accounts = row_count;

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('branch', p_staff_id, jsonb_build_object('from', v_from, 'to', p_branch, 'accounts', v_accounts), v_actor);
  return jsonb_build_object('success', true, 'changed', true, 'from', v_from, 'branch', p_branch, 'accounts_updated', v_accounts);
end;
$function$;

create or replace function public.dr_wael_set_roaming_v1(p_staff_id uuid, p_roaming boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
begin
  if p_staff_id is null or p_roaming is null or not exists (
    select 1 from public.staff s where s.id = p_staff_id and s.is_active is true
      and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن')) then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;
  if p_roaming then
    insert into public.dr_wael_roaming_staff_v1(staff_id, note, created_by) values (p_staff_id, 'جرد الفروع', v_actor)
    on conflict (staff_id) do nothing;
  else
    delete from public.dr_wael_roaming_staff_v1 where staff_id = p_staff_id;
  end if;
  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('roaming', p_staff_id, jsonb_build_object('roaming', p_roaming), v_actor);
  return jsonb_build_object('success', true, 'roaming', p_roaming);
end;
$function$;

revoke all on function public.get_dr_wael_fingerprints_v1(text) from public;
revoke all on function public.get_dr_wael_smart_insights_v1() from public;
revoke all on function public.dr_wael_apply_shift_change_v1(uuid, time, time, text, date, date, text[], text) from public;
revoke all on function public.dr_wael_apply_branch_change_v1(uuid, text) from public;
revoke all on function public.dr_wael_set_roaming_v1(uuid, boolean) from public;
grant execute on function public.get_dr_wael_fingerprints_v1(text) to anon, authenticated;
grant execute on function public.get_dr_wael_smart_insights_v1() to anon, authenticated;
grant execute on function public.dr_wael_apply_shift_change_v1(uuid, time, time, text, date, date, text[], text) to anon, authenticated;
grant execute on function public.dr_wael_apply_branch_change_v1(uuid, text) to anon, authenticated;
grant execute on function public.dr_wael_set_roaming_v1(uuid, boolean) to anon, authenticated;
