-- بصمات د وائل: a punch on another branch's device counts for the employee, with a small note.
--
-- The fingerprint code is one person on every device: the 25 codes enrolled on both the الشامي and شكري devices all
-- point at the same employee. A code that punches on a device where it is not mapped yet (د محمد وليد, code 178,
-- punched out on the شكري device on 3/11) used to stay «كود مش متربط» and the day lost its check-out.
-- 1) dr_wael_cross_branch_mapping_v1 (BEFORE INSERT on biometric_attendance_logs): when the code is not mapped on
--    this device but is mapped on another device to exactly one active employee, it adds the mapping for this device
--    so dawaa_promote_biometric_attendance_v1 credits the punch to him as usual. Logged in dr_wael_change_log_v1.
-- 2) One-time backfill of the last 40 days of such unmapped punches, then the days are rebuilt from the punches
--    (manager-approved days are kept).
-- 3) get_dr_wael_fingerprints_v1 returns other_branch per day: the device branch(es) he punched on that are not
--    his branch, shown on the page as «بصم في فرع …».

create or replace function public.dr_wael_cross_branch_owner_v1(p_provider text, p_code text)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select case when count(distinct m.staff_id) = 1 then min(m.staff_id::text)::uuid end
  from public.biometric_staff_mapping m
  join public.staff s on s.id = m.staff_id and coalesce(s.active, false) and s.is_active is true
  where m.active and m.provider like 'zk_%' and m.provider <> p_provider
    and m.biometric_user_id = p_code and m.staff_id is not null;
$function$;

revoke all on function public.dr_wael_cross_branch_owner_v1(text, text) from public, anon, authenticated;

-- Maps the code on this device to its owner from the other device. Returns the staff id, or null when nothing to do.
create or replace function public.dr_wael_map_cross_branch_code_internal_v1(p_provider text, p_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_code text := nullif(trim(coalesce(p_code, '')), '');
  v_staff uuid;
  v_from record;
begin
  if v_code is null or coalesce(p_provider, '') not like 'zk_%' then
    return null;
  end if;
  if exists (select 1 from public.biometric_staff_mapping m
             where m.provider = p_provider and m.biometric_user_id = v_code and m.active) then
    return null;
  end if;
  v_staff := public.dr_wael_cross_branch_owner_v1(p_provider, v_code);
  if v_staff is null then
    return null;
  end if;
  select m.staff_account_id, m.provider into v_from from public.biometric_staff_mapping m
  where m.active and m.provider like 'zk_%' and m.provider <> p_provider and m.biometric_user_id = v_code
    and m.staff_id = v_staff
  order by m.updated_at desc limit 1;

  insert into public.biometric_staff_mapping(provider, device_id, biometric_user_id, staff_account_id, branch, active, staff_id)
  select p_provider, '*', v_code, v_from.staff_account_id, s.branch, true, s.id
  from public.staff s where s.id = v_staff
  on conflict (provider, device_id, biometric_user_id) do update
    set active = true, staff_id = excluded.staff_id, staff_account_id = excluded.staff_account_id,
        branch = excluded.branch, updated_at = now();

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('cross_branch_mapping', v_staff, jsonb_build_object('provider', p_provider, 'code', v_code,
    'copied_from', v_from.provider), null);
  return v_staff;
end;
$function$;

revoke all on function public.dr_wael_map_cross_branch_code_internal_v1(text, text) from public, anon, authenticated;

create or replace function public.dr_wael_cross_branch_mapping_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
begin
  if new.staff_id is null then
    begin
      perform public.dr_wael_map_cross_branch_code_internal_v1(new.provider, new.biometric_user_id);
    exception when others then
      -- Never lose a punch because of the cross-branch lookup.
      null;
    end;
  end if;
  return new;
end;
$function$;

revoke all on function public.dr_wael_cross_branch_mapping_v1() from public, anon, authenticated;

drop trigger if exists trg_b_dr_wael_cross_branch_mapping_v1 on public.biometric_attendance_logs;
create trigger trg_b_dr_wael_cross_branch_mapping_v1
  before insert on public.biometric_attendance_logs
  for each row execute function public.dr_wael_cross_branch_mapping_v1();

-- One-time backfill: unmapped punches of the last 40 days whose code has a single owner on another device.
do $backfill$
declare
  v_log record;
  v_staff public.staff%rowtype;
  v_effective timestamptz;
  v_day date;
  v_days jsonb := '{}'::jsonb;
  v_key text;
begin
  for v_log in
    select b.* from public.biometric_attendance_logs b
    where b.staff_id is null and b.provider like 'zk_%'
      and b.punch_time > now() - interval '40 days'
      and nullif(trim(coalesce(b.biometric_user_id, '')), '') is not null
    order by b.punch_time
  loop
    perform public.dr_wael_map_cross_branch_code_internal_v1(v_log.provider, v_log.biometric_user_id);
    select s.* into v_staff from public.biometric_staff_mapping m
    join public.staff s on s.id = m.staff_id and s.is_active is true
    where m.active and m.provider = v_log.provider and m.biometric_user_id = v_log.biometric_user_id
    order by m.updated_at desc limit 1;
    if v_staff.id is null then
      continue;
    end if;
    v_effective := public.dawaa_fingerprint_effective_time_v1(v_log.provider, v_log.raw_payload, v_log.punch_time);
    v_day := (v_effective at time zone 'Africa/Cairo')::date;
    update public.biometric_attendance_logs
    set staff_id = v_staff.id, staff_name_snapshot = coalesce(nullif(staff_name_snapshot, ''), v_staff.name),
        punch_time = v_effective, branch = public.dawaa_biometric_source_branch_v1(raw_payload, branch)
    where id = v_log.id;
    insert into public.staff_attendance_logs(
      staff_id, staff_name, role, branch_name, attendance_type, recorded_at, shift_date,
      biometric_verified, biometric_method, device_id, status, rejection_reason, biometric_source_log_id)
    values (
      v_staff.id, v_staff.name, v_staff.role, v_staff.branch,
      case lower(trim(coalesce(v_log.punch_type, ''))) when 'check_out' then 'check_out' when 'out' then 'check_out'
        else 'check_in' end,
      v_effective, v_day, true, 'fingerprint_terminal', v_log.device_id::text, 'manual_review',
      'بصمة من فرع تاني اتربطت بصاحبها', v_log.id)
    on conflict (biometric_source_log_id) where biometric_source_log_id is not null do nothing;
    v_days := v_days || jsonb_build_object(v_staff.id::text || '|' || v_day::text, true)
                     || jsonb_build_object(v_staff.id::text || '|' || (v_day - 1)::text, true);
  end loop;

  for v_key in select jsonb_object_keys(v_days) loop
    if exists (select 1 from public.attendance_daily_summary a
               where a.staff_id = split_part(v_key, '|', 1)::uuid and a.attendance_date = split_part(v_key, '|', 2)::date)
       or exists (select 1 from public.staff_attendance_logs l
                  where l.staff_id = split_part(v_key, '|', 1)::uuid and l.shift_date = split_part(v_key, '|', 2)::date) then
      perform public.dr_wael_rebuild_day_internal_v1(split_part(v_key, '|', 1)::uuid, split_part(v_key, '|', 2)::date);
    end if;
  end loop;
end;
$backfill$;

-- Same reader as 20261104113000, plus other_branch per day.
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
      'time_off', a.time_off_request_id is not null, 'punches', coalesce(p.n, 0),
      'other_branch', (select string_agg(x, '، ' order by x) from unnest(p.branches) x where x is distinct from a.branch))
    order by a.attendance_date desc, a.branch), '[]'::jsonb)
    into v_days
  from public.attendance_daily_summary a
  left join (
    select b.staff_id, (b.punch_time at time zone 'Africa/Cairo')::date as day, count(*)::int as n,
           array_agg(distinct b.branch) filter (where b.branch is not null) as branches
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
