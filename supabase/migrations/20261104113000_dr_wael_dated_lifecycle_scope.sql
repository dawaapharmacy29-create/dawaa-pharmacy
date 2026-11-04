-- Exclude out-of-scope dates from the operational reader while preserving historical attendance.
CREATE OR REPLACE FUNCTION public.get_dr_wael_fingerprints_v1(p_month_cycle text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
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
    where a.attendance_date between v_start and v_end and a.branch = any(v_branches)
      and not coalesce((
        select c.target_state = 'archived'
          or (c.target_state = 'leaving' and c.last_working_date < a.attendance_date)
        from public.hr_staff_lifecycle_changes_v2 c
        where c.staff_id = a.staff_id and c.state = 'approved'
          and c.effective_from <= a.attendance_date
        order by c.effective_from desc, c.decided_at desc nulls last, c.created_at desc, c.id desc
        limit 1
      ), false) and a.staff_id is not null
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
  where a.attendance_date between v_start and v_end and a.branch = any(v_branches)
      and not coalesce((
        select c.target_state = 'archived'
          or (c.target_state = 'leaving' and c.last_working_date < a.attendance_date)
        from public.hr_staff_lifecycle_changes_v2 c
        where c.staff_id = a.staff_id and c.state = 'approved'
          and c.effective_from <= a.attendance_date
        order by c.effective_from desc, c.decided_at desc nulls last, c.created_at desc, c.id desc
        limit 1
      ), false);

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
