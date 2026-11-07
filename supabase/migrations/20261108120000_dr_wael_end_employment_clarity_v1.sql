-- «ترك عمل»: say what a decision does and what it leaves open, and let it be taken back.
-- 1) dr_wael_end_employment_left_v1 (internal): what stays open for someone: days to review in the pay cycle of the last day,
--    pending overtime, days with punches after the last day, approved leave running past it.
-- 2) dr_wael_end_employment_preview_v1: the above plus what would be closed, shown before the decision.
-- 3) dr_wael_end_employment_v1: a repeat of the same decision does nothing (it used to log a second change whose
--    previous_* values were already the archived ones), the closed days are kept in the log so they can be restored,
--    and the result says what is left.
-- 4) dr_wael_undo_end_employment_v1: restores the staff record and the days closed by that decision. Login stays
--    closed, as in hr_apply_due_staff_lifecycle_v2: opening it again is a separate decision.
-- 5) dr_wael_recent_end_employments_v1: the last 45 days of decisions and what each one still has open.

create or replace function public.dr_wael_end_employment_left_v1(p_staff_id uuid, p_last_day date)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select jsonb_build_object(
    'open_days', coalesce((
      select jsonb_agg(a.attendance_date order by a.attendance_date)
      from public.attendance_daily_summary a
      where a.staff_id = p_staff_id and a.attendance_date <= p_last_day
        and a.attendance_date >= (select b.cycle_start from public.dawaa_pay_cycle_bounds_v1(p_last_day) b)
        and (a.status = 'pending_review' or a.review_required is true)
    ), '[]'::jsonb),
    'punch_days_after', coalesce((
      select jsonb_agg(a.attendance_date order by a.attendance_date)
      from public.attendance_daily_summary a
      where a.staff_id = p_staff_id and a.attendance_date > p_last_day
        and (a.first_in is not null or a.last_out is not null)
    ), '[]'::jsonb),
    'pending_overtime', (
      select count(*) from public.staff_overtime_approvals o
      where o.staff_id = p_staff_id and o.status = 'pending'
    ),
    'leave_after', (
      select count(*) from public.staff_time_off_requests t
      where t.staff_id = p_staff_id and t.status = 'approved' and t.end_date > p_last_day
    ));
$function$;

revoke all on function public.dr_wael_end_employment_left_v1(uuid, date) from public, anon, authenticated;

create or replace function public.dr_wael_end_employment_preview_v1(p_staff_id uuid, p_last_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
begin
  if p_staff_id is null or p_last_day is null then
    raise exception 'invalid_last_day' using errcode = '22023';
  end if;
  return public.dr_wael_end_employment_left_v1(p_staff_id, p_last_day) || jsonb_build_object(
    'last_punch_day', (
      select max(a.attendance_date) from public.attendance_daily_summary a
      where a.staff_id = p_staff_id and (a.first_in is not null or a.last_out is not null)
    ),
    'days_to_close', (
      select count(*) from public.attendance_daily_summary a
      where a.staff_id = p_staff_id and a.attendance_date > p_last_day
        and a.first_in is null and a.last_out is null and a.time_off_request_id is null
        and not (a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%')
    ),
    'closes_now', p_last_day < v_today,
    'logins_open', (
      select count(*) from public.staff_accounts sa
      where trim(coalesce(sa.staff_id, '')) = p_staff_id::text and (sa.active is true or sa.can_login is true)
    ),
    'already', exists (
      select 1 from public.hr_staff_lifecycle_changes_v2 c
      where c.staff_id = p_staff_id and c.state = 'approved' and c.target_state = 'leaving'
        and c.last_working_date = p_last_day
    ));
end;
$function$;

create or replace function public.dr_wael_end_employment_v1(
  p_staff_id uuid, p_last_day date, p_kind text default 'resignation', p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_staff public.staff%rowtype;
  v_kind text := coalesce(nullif(trim(p_kind), ''), 'resignation');
  v_reason text;
  v_cancelled int := 0;
  v_closed int := 0;
  v_change uuid;
  v_logins int := 0;
  v_snapshot jsonb;
begin
  if p_staff_id is null or p_last_day is null or p_last_day > v_today + 60 or p_last_day < v_today - 120 then
    raise exception 'invalid_last_day' using errcode = '22023';
  end if;
  if v_kind not in ('resignation', 'termination', 'contract_end', 'other') then
    raise exception 'invalid_separation_kind' using errcode = '22023';
  end if;
  select * into v_staff from public.staff s
  where s.id = p_staff_id and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن') for update;
  if not found then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;
  if exists (select 1 from public.dr_wael_fingerprints_viewers_v1 v
             join public.staff_accounts sa on sa.id = v.staff_account_id
             where trim(coalesce(sa.staff_id, '')) = p_staff_id::text) then
    raise exception 'cannot_end_viewer' using errcode = '22023';
  end if;

  -- The same decision again (a second tap, or two managers) changes nothing.
  select c.id into v_change from public.hr_staff_lifecycle_changes_v2 c
  where c.staff_id = p_staff_id and c.state = 'approved' and c.target_state = 'leaving'
    and c.last_working_date = p_last_day
  order by c.created_at desc limit 1;
  if found then
    return public.dr_wael_end_employment_left_v1(p_staff_id, p_last_day) || jsonb_build_object(
      'success', true, 'already', true, 'change_id', v_change, 'last_day', p_last_day,
      'archived', p_last_day < v_today, 'days_closed', 0);
  end if;

  if exists (select 1 from public.hr_staff_lifecycle_changes_v2 c
             where c.staff_id = p_staff_id and c.state = 'approved'
               and c.effective_from > least(p_last_day, v_today)) then
    raise exception 'later_lifecycle_change_exists' using errcode = '22023';
  end if;

  v_reason := left(concat_ws(' — ', 'ترك عمل من بصمات د وائل', nullif(trim(p_note), '')), 1000);

  update public.hr_staff_lifecycle_changes_v2
  set state = 'cancelled', decided_by = v_actor, decided_at = now(),
      decision_note = 'اتلغى — ترك عمل مباشر من بصمات د وائل'
  where staff_id = p_staff_id and state = 'pending';
  get diagnostics v_cancelled = row_count;

  -- An approved change on the same day is replaced by this one.
  update public.hr_staff_lifecycle_changes_v2
  set state = 'cancelled', decision_note = concat_ws(' | ', nullif(decision_note, ''), 'اتبدل بترك عمل من بصمات د وائل')
  where staff_id = p_staff_id and state = 'approved' and effective_from = least(p_last_day, v_today);

  select count(*) into v_logins from public.staff_accounts sa
  where trim(coalesce(sa.staff_id, '')) = p_staff_id::text and (sa.active is true or sa.can_login is true);

  -- projection/offboarding are stamped up front: hr_apply_due_staff_lifecycle_v2 then only updates staff and login,
  -- and skips add_staff_employment_event_v1, which needs an HR permission that the hourly cron (no session) lacks.
  insert into public.hr_staff_lifecycle_changes_v2(
    staff_id, effective_from, target_state, last_working_date, separation_kind, reason, state,
    requested_by, requested_at, decided_by, decided_at, decision_note,
    projection_applied_at, offboarding_applied_at,
    previous_staff_status, previous_active, previous_is_active, previous_visible_in_schedule)
  values (
    p_staff_id, least(p_last_day, v_today), 'leaving', p_last_day, v_kind, v_reason, 'approved',
    v_actor, now(), v_actor, now(), 'ترك عمل بضغطة واحدة من بصمات د وائل',
    now(), now(),
    v_staff.status, v_staff.active, v_staff.is_active, v_staff.visible_in_schedule)
  returning id into v_change;

  perform public.hr_apply_due_staff_lifecycle_v2(p_staff_id);

  -- Kept in the log so dr_wael_undo_end_employment_v1 can put these days back as they were.
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_snapshot
  from public.attendance_daily_summary a
  where a.staff_id = p_staff_id and a.attendance_date > p_last_day
    and a.first_in is null and a.last_out is null and a.time_off_request_id is null
    and not (a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%');

  -- Empty days after the last working day (no punches, no leave, not approved by a person) are closed as
  -- «خارج الخدمة» (employment_ended, 0 hours, no deduction), the same way earlier GM decisions closed them.
  -- They are not deleted: attendance_resolution_audit references them.
  update public.attendance_daily_summary a
  set status = 'approved', review_required = false, resolution_status = 'employment_ended',
      total_hours = 0, candidate_hours = 0, payroll_eligible_hours = 0, late_minutes = 0, early_leave_minutes = 0,
      missing_punch = false, approved_at = now(), approved_by = 'dr_wael:' || v_actor::text,
      approved_by_name = 'ترك عمل — بصمات د وائل', resolution_origin = 'manager', resolved_at = now(),
      approval_note = 'ترك عمل: آخر يوم فعلي ' || to_char(p_last_day, 'DD/MM/YYYY') || '؛ لا يُحتسب غيابًا أو خصمًا.',
      updated_at = now()
  where a.staff_id = p_staff_id and a.attendance_date > p_last_day
    and a.first_in is null and a.last_out is null and a.time_off_request_id is null
    and not (a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%');
  get diagnostics v_closed = row_count;

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('end_employment', p_staff_id, jsonb_build_object('change_id', v_change, 'last_day', p_last_day,
    'kind', v_kind, 'note', p_note, 'cancelled_pending', v_cancelled, 'days_closed', v_closed,
    'previous_status', v_staff.status, 'logins_open', v_logins, 'closed_days', v_snapshot), v_actor);

  return public.dr_wael_end_employment_left_v1(p_staff_id, p_last_day) || jsonb_build_object(
    'success', true, 'change_id', v_change, 'last_day', p_last_day,
    'archived', p_last_day < v_today, 'days_closed', v_closed);
end;
$function$;

create or replace function public.dr_wael_undo_end_employment_v1(p_change_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_change public.hr_staff_lifecycle_changes_v2%rowtype;
  v_log public.dr_wael_change_log_v1%rowtype;
  v_days jsonb;
  v_reopened int := 0;
begin
  select * into v_change from public.hr_staff_lifecycle_changes_v2 c
  where c.id = p_change_id and c.target_state = 'leaving' for update;
  if not found then
    raise exception 'undo_not_available' using errcode = '22023';
  end if;
  if v_change.state <> 'approved' then
    raise exception 'already_undone' using errcode = '22023';
  end if;
  perform 1 from public.staff s where s.id = v_change.staff_id for update;

  -- Decisions from before this migration kept no record of the days they closed.
  select * into v_log from public.dr_wael_change_log_v1 l
  where l.kind = 'end_employment' and l.staff_id = v_change.staff_id
    and l.payload->>'change_id' = p_change_id::text and l.payload ? 'closed_days'
  order by l.created_at desc limit 1;
  if not found then
    raise exception 'undo_not_available' using errcode = '22023';
  end if;
  if v_log.created_at < now() - interval '30 days' then
    raise exception 'undo_too_late' using errcode = '22023';
  end if;

  -- hr_apply_due_staff_lifecycle_v2 applies the latest approved change that is due, so another one would undo this.
  if exists (select 1 from public.hr_staff_lifecycle_changes_v2 c
             where c.staff_id = v_change.staff_id and c.id <> p_change_id and c.state = 'approved') then
    raise exception 'other_lifecycle_change_exists' using errcode = '22023';
  end if;

  v_days := coalesce(v_log.payload->'closed_days', '[]'::jsonb);
  if exists (
    select 1
    from jsonb_array_elements(v_days) d
    cross join lateral public.dawaa_pay_cycle_bounds_v1((d->>'attendance_date')::date) b
    join public.payroll_finalized_snapshots_v2 f
      on f.staff_id = v_change.staff_id and f.month_cycle = b.month_cycle
  ) then
    raise exception 'payroll_finalized' using errcode = '55000';
  end if;

  update public.hr_staff_lifecycle_changes_v2
  set state = 'cancelled',
      decision_note = concat_ws(' | ', nullif(decision_note, ''), 'رجوع في القرار من بصمات د وائل')
  where id = p_change_id;

  update public.staff
  set status = v_change.previous_staff_status,
      active = v_change.previous_active,
      is_active = v_change.previous_is_active,
      visible_in_schedule = v_change.previous_visible_in_schedule,
      updated_at = now()
  where id = v_change.staff_id;

  -- A day that got a punch since, or that someone decided since, is left as it is.
  update public.attendance_daily_summary a
  set status = r.status, review_required = r.review_required, resolution_status = r.resolution_status,
      total_hours = r.total_hours, candidate_hours = r.candidate_hours,
      payroll_eligible_hours = r.payroll_eligible_hours, late_minutes = r.late_minutes,
      early_leave_minutes = r.early_leave_minutes, missing_punch = r.missing_punch,
      approved_at = r.approved_at, approved_by = r.approved_by, approved_by_name = r.approved_by_name,
      resolution_origin = r.resolution_origin, resolved_at = r.resolved_at, approval_note = r.approval_note,
      updated_at = now()
  from jsonb_populate_recordset(null::public.attendance_daily_summary, v_days) r
  where a.id = r.id and a.staff_id = v_change.staff_id
    and a.resolution_status = 'employment_ended'
    and a.approved_by = 'dr_wael:' || v_log.actor_id::text
    and a.first_in is null and a.last_out is null;
  get diagnostics v_reopened = row_count;

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('undo_end_employment', v_change.staff_id, jsonb_build_object('change_id', p_change_id,
    'last_day', v_change.last_working_date, 'days_reopened', v_reopened,
    'days_in_decision', jsonb_array_length(v_days)), v_actor);

  return jsonb_build_object('success', true, 'days_reopened', v_reopened,
    'days_kept', jsonb_array_length(v_days) - v_reopened,
    'login_still_closed', coalesce((v_log.payload->>'logins_open')::int, 0) > 0 and not exists (
      select 1 from public.staff_accounts sa
      where trim(coalesce(sa.staff_id, '')) = v_change.staff_id::text and sa.active is true and sa.can_login is true));
end;
$function$;

create or replace function public.dr_wael_recent_end_employments_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
begin
  return coalesce((
    select jsonb_agg(x.row order by x.at desc)
    from (
      select c.created_at as at,
        public.dr_wael_end_employment_left_v1(c.staff_id, c.last_working_date) || jsonb_build_object(
          'change_id', c.id,
          'staff_id', c.staff_id,
          'name', s.name,
          'branch', s.branch,
          'last_day', c.last_working_date,
          'kind', c.separation_kind,
          'decided_at', c.created_at,
          -- A repeat of the same decision was logged apart, before this migration.
          'days_closed', (
            select coalesce(sum((l.payload->>'days_closed')::int), 0)
            from public.dr_wael_change_log_v1 l
            where l.kind = 'end_employment' and l.staff_id = c.staff_id
              and l.payload->>'last_day' = c.last_working_date::text
          ),
          'can_undo', c.created_at >= now() - interval '30 days' and exists (
            select 1 from public.dr_wael_change_log_v1 l
            where l.kind = 'end_employment' and l.staff_id = c.staff_id
              and l.payload->>'change_id' = c.id::text and l.payload ? 'closed_days'
          )) as row
      from public.hr_staff_lifecycle_changes_v2 c
      join public.staff s on s.id = c.staff_id
      where c.state = 'approved' and c.target_state = 'leaving'
        and c.last_working_date is not null
        and c.created_at >= now() - interval '45 days'
    ) x
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.dr_wael_end_employment_preview_v1(uuid, date) from public;
revoke all on function public.dr_wael_end_employment_v1(uuid, date, text, text) from public;
revoke all on function public.dr_wael_undo_end_employment_v1(uuid) from public;
revoke all on function public.dr_wael_recent_end_employments_v1() from public;
grant execute on function public.dr_wael_end_employment_preview_v1(uuid, date) to anon, authenticated;
grant execute on function public.dr_wael_end_employment_v1(uuid, date, text, text) to anon, authenticated;
grant execute on function public.dr_wael_undo_end_employment_v1(uuid) to anon, authenticated;
grant execute on function public.dr_wael_recent_end_employments_v1() to anon, authenticated;
