-- «بصمات د وائل»: ترك عمل بضغطة واحدة + نظام الشغل (عادي / بارت تايم / جوكر).
-- 1) dr_wael_end_employment_v1: an approved «leaving» lifecycle change with the given last working day, applied at once.
--    Days up to the last day stay for payroll; empty unapproved days after it are closed as «خارج الخدمة»
--    (0 hours, no deduction) so they stop showing as pending.
-- 2) dr_wael_set_work_mode_v1: part-time and joker use the flexible (actual hours) attendance rule; a joker's punches
--    count in any branch (roaming).
-- 3) get_dr_wael_fingerprints_v1: each employee also carries status, work_mode and last_punch.

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
    'previous_status', v_staff.status), v_actor);

  return jsonb_build_object('success', true, 'change_id', v_change, 'last_day', p_last_day,
    'archived', p_last_day < v_today, 'days_closed', v_closed);
end;
$function$;

create or replace function public.dr_wael_set_work_mode_v1(p_staff_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_staff public.staff%rowtype;
  v_from date;
  v_date date;
  v_rebuilt int := 0;
  v_kept int := 0;
begin
  if p_mode is null or p_mode not in ('regular', 'part_time', 'joker') then
    raise exception 'invalid_work_mode' using errcode = '22023';
  end if;
  select * into v_staff from public.staff s
  where s.id = p_staff_id and s.is_active is true and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن');
  if not found then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;

  update public.staff_monthly_hour_rules
  set is_active = false, updated_at = now()
  where staff_id = p_staff_id and is_active is true;

  if p_mode in ('part_time', 'joker') then
    insert into public.staff_monthly_hour_rules(staff_id, staff_name, role, branch_name, target_hours,
      monthly_days_off, flexible_daily_hours, allow_split_shifts, notes, is_active)
    values (p_staff_id, coalesce(v_staff.name, ''), v_staff.role, v_staff.branch, 0, 0, true, true,
      case p_mode when 'joker' then 'جوكر: يحاسب على ساعات الحضور الفعلية وبصمته تتحسب في أي فرع'
                  else 'بارت تايم: يحاسب على أيام وساعات الحضور الفعلية فقط' end,
      true);
  end if;

  if p_mode = 'joker' then
    insert into public.dr_wael_roaming_staff_v1(staff_id, note, created_by) values (p_staff_id, 'جوكر', v_actor)
    on conflict (staff_id) do nothing;
  else
    delete from public.dr_wael_roaming_staff_v1 where staff_id = p_staff_id and note = 'جوكر';
  end if;

  -- Re-resolve the current pay cycle (26th → today) with the new rule.
  v_from := case when extract(day from v_today) >= 26 then date_trunc('month', v_today)::date + 25
                 else (date_trunc('month', v_today) - interval '1 month')::date + 25 end;
  for v_date in select g::date from generate_series(v_from, v_today, interval '1 day') g loop
    if exists (select 1 from public.attendance_daily_summary a where a.staff_id = p_staff_id and a.attendance_date = v_date)
       or exists (select 1 from public.biometric_attendance_logs b where b.staff_id = p_staff_id
                    and b.punch_time >= (v_date::timestamp at time zone 'Africa/Cairo')
                    and b.punch_time < ((v_date + 1)::timestamp at time zone 'Africa/Cairo')) then
      if public.dr_wael_rebuild_day_internal_v1(p_staff_id, v_date) then
        v_rebuilt := v_rebuilt + 1;
      else
        v_kept := v_kept + 1;
      end if;
    end if;
  end loop;

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('work_mode', p_staff_id, jsonb_build_object('mode', p_mode, 'rebuilt', v_rebuilt, 'kept', v_kept), v_actor);

  return jsonb_build_object('success', true, 'mode', p_mode, 'days_rebuilt', v_rebuilt,
    'days_kept_manager_approved', v_kept);
end;
$function$;

revoke all on function public.dr_wael_end_employment_v1(uuid, date, text, text) from public;
revoke all on function public.dr_wael_set_work_mode_v1(uuid, text) from public;
grant execute on function public.dr_wael_end_employment_v1(uuid, date, text, text) to anon, authenticated;
grant execute on function public.dr_wael_set_work_mode_v1(uuid, text) to anon, authenticated;

do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.get_dr_wael_fingerprints_v1(text)'::regprocedure);
  v_old := $$'roaming', exists (select 1 from public.dr_wael_roaming_staff_v1 r where r.staff_id = s.id),$$;
  v_new := $$'roaming', exists (select 1 from public.dr_wael_roaming_staff_v1 r where r.staff_id = s.id),
      'status', s.status,
      'work_mode', (
        select case when hr.notes like 'جوكر:%' then 'joker'
                    when hr.notes like 'بارت تايم:%' or hr.notes ilike 'part-time%' then 'part_time'
                    else 'flexible' end
        from public.staff_monthly_hour_rules hr
        where hr.staff_id = s.id and hr.is_active is true and hr.flexible_daily_hours is true
        order by hr.updated_at desc limit 1),
      'last_punch', (select max(b.punch_time) from public.biometric_attendance_logs b where b.staff_id = s.id),$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'get_dr_wael_fingerprints_v1: roaming anchor not found once';
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;
