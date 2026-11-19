-- The clear fingerprint decisions are taken every morning by the database, not only when the page is opened
-- (19/11/2026). They follow the same rules as the page (src/lib/drWaelFingerprints.ts, quickPlan and
-- overtimeAutoDecision) and are recorded in the name of the manager who set them, with a note «قرار تلقائي».
--   * a day worked on an off day with one punch that is the end (or start) of the night shift next to it: the
--     punch is already counted in that day, so this one closes as off with 0 hours;
--   * days: forgotten punch, lateness or early leave on his own shift, an empty day, an absence older than 2 days;
--     the days that may be another shift (both ends moved, or an employee whose punches keep a different shift)
--     and the flexible / part-time staff stay for the page;
--   * overtime: the fair minutes (waiting for the relief + 30 minutes handing over, alone of his group while the
--     branch sold), the warehouse with the warehouse, what the manager asked for approved; the rest stays.

-- 1. A punch that belongs to the night shift next to it.
create or replace function public.dr_wael_punch_belongs_to_neighbor_v1(p_staff_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1
    from public.attendance_daily_summary d
    join public.attendance_daily_summary n
      on n.staff_id = d.staff_id and n.attendance_date in (d.attendance_date - 1, d.attendance_date + 1)
    where d.staff_id = p_staff_id and d.attendance_date = p_date
      and (d.first_in is null) <> (d.last_out is null)
      and (
        (n.attendance_date = d.attendance_date - 1 and n.last_out is not null
          and abs(extract(epoch from (coalesce(d.last_out, d.first_in) - n.last_out))) <= 90 * 60)
        or (n.attendance_date = d.attendance_date + 1 and n.first_in is not null
          and abs(extract(epoch from (coalesce(d.first_in, d.last_out) - n.first_in))) <= 90 * 60)
      )
  );
$function$;
revoke all on function public.dr_wael_punch_belongs_to_neighbor_v1(uuid, date) from public, anon;

do $migration$
declare
  v_def text := pg_get_functiondef('public.dr_wael_quick_day_decision_v1(uuid,date,text)'::regprocedure);
  v_old text := $old$       or (v_day.resolution_status = 'worked_on_off' and (v_day.first_in is not null or v_day.last_out is not null)) then$old$;
  v_new text := $new$       or (v_day.resolution_status = 'worked_on_off' and (v_day.first_in is not null or v_day.last_out is not null)
           and not public.dr_wael_punch_belongs_to_neighbor_v1(p_staff_id, p_date)) then$new$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'dr_wael_quick_day_decision_v1 is not the expected version';
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;

-- 2. In whose name the morning decisions are taken: the manager who runs the fingerprints page.
create table if not exists public.dr_wael_auto_decider_v1 (
  staff_account_id uuid primary key references public.staff_accounts(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.dr_wael_auto_decider_v1 enable row level security;
revoke all on public.dr_wael_auto_decider_v1 from public, anon, authenticated;
insert into public.dr_wael_auto_decider_v1(staff_account_id)
select id from public.staff_accounts where id = '748fad73-5aab-4e61-bfd6-8be299af8aa9'
on conflict do nothing;

create table if not exists public.dr_wael_auto_decision_runs_v1 (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  actor_id uuid,
  result jsonb not null
);
alter table public.dr_wael_auto_decision_runs_v1 enable row level security;
revoke all on public.dr_wael_auto_decision_runs_v1 from public, anon, authenticated;

-- 3. The overtime rule (overtimeAutoDecision on the page).
create or replace function public.dr_wael_overtime_auto_choice_v1(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_ot public.staff_overtime_approvals%rowtype;
  v_ev jsonb;
  v_after int;
  v_late int;
  v_res text;
  v_start timestamptz;
  v_end timestamptz;
  v_relief timestamptz;
  v_relief_name text;
  v_handover_end timestamptz;
  v_ho int := 0;
  v_alone int := 0;
  v_paid int;
  v_warehouse boolean;
  v_branch int;
  v_own int;
  v_parts text[] := '{}';
  v_with text;
  v_request text;
  v_group text;
begin
  select * into v_ot from public.staff_overtime_approvals where id = p_id and status = 'pending';
  if not found then return jsonb_build_object('action', 'skip', 'why', 'decided'); end if;
  v_ev := public.overtime_decision_evidence_v3(p_id);
  if coalesce((v_ev->>'evidence_available')::boolean, false) is false then
    return jsonb_build_object('action', 'ask', 'why', 'مفيش بيانات كفاية عن الوقت ده');
  end if;
  v_after := greatest(coalesce((v_ev->'attendance_truth'->>'raw_post_shift_minutes')::int, 0), 0);
  v_late := greatest(coalesce((v_ev->'attendance_truth'->>'late_minutes')::int, 0), 0);
  v_res := v_ev->'attendance_truth'->>'resolution_status';
  v_start := (v_ev->'attendance_truth'->>'scheduled_end_at')::timestamptz;
  v_end := v_start + v_after * interval '1 minute';

  select coalesce(nullif(r.note, ''), '') into v_request
  from public.dr_wael_overtime_requests_v1 r
  where r.staff_id = v_ot.staff_id and r.cancelled_at is null
    and v_ot.attendance_date between r.from_date and r.to_date
  limit 1;
  if found and v_after > 20 then
    return jsonb_build_object('action', 'approve',
      'why', 'انت اللي طالب منه يقعد' || case when v_request <> '' then ' (' || v_request || ')' else '' end);
  end if;
  if v_after <= 20 then
    return jsonb_build_object('action', 'reject', 'why', format('قعد بعد الشيفت %s د بس، و20 دقيقة أو أقل مابتتحسبش', v_after));
  end if;
  if coalesce(v_res, '') not in ('on_time', 'late', 'very_late', 'on_time_with_permission', 'worked_on_off') then
    return jsonb_build_object('action', 'ask', 'why', 'اليوم مش مظبوط على الجدول');
  end if;
  if v_late > 20 and v_after - v_late <= 20 then
    return jsonb_build_object('action', 'reject', 'why', format('جه متأخر %s د وقعد بعده %s د: ده تعويض للتأخير مش أوفر تايم', v_late, v_after));
  end if;
  if v_after > 180 then
    return jsonb_build_object('action', 'ask', 'why', format('قعد بعد الشيفت %s د، أكتر من 3 ساعات', v_after));
  end if;

  v_warehouse := v_ev->>'comparison_group' = 'warehouse';
  v_group := case when v_warehouse then 'المخزن' else 'فئته' end;

  create temporary table if not exists pg_temp.ot_people (name text, fi timestamptz, lo timestamptz) on commit drop;
  truncate pg_temp.ot_people;
  insert into pg_temp.ot_people
  select p->>'name', (p->>'first_in')::timestamptz, (p->>'last_out')::timestamptz
  from jsonb_array_elements(coalesce(v_ev->'staffing'->'people', '[]'::jsonb)) p
  where not coalesce((p->>'is_current_employee')::boolean, false);
  insert into pg_temp.ot_people
  select s.name, a.first_in, a.last_out
  from public.attendance_daily_summary a
  join public.staff s on s.id = a.staff_id
  where a.attendance_date between v_ot.attendance_date - 1 and v_ot.attendance_date + 1
    and a.status <> 'approved' and a.staff_id <> v_ot.staff_id
    and a.first_in is not null and a.last_out is not null
    and a.first_in < v_end and a.last_out > v_start
    and case
      when v_warehouse then public.hr_is_warehouse_staff_v1(s.id)
      else not public.hr_is_warehouse_staff_v1(s.id)
        and public.hr_branch_key_v3(coalesce(a.branch, s.branch)) = public.hr_branch_key_v3(v_ev->>'branch')
        and public.hr_staff_role_group_v3(s.role, s.name) = v_ev->>'role_group'
    end;

  select fi, name into v_relief, v_relief_name from pg_temp.ot_people
  where fi >= v_start - interval '30 minutes' and lo > v_start and fi < v_end
  order by fi limit 1;
  v_handover_end := case when v_relief is null then v_start else greatest(v_relief, v_start) + interval '30 minutes' end;

  select count(*) filter (where not covered and t < v_handover_end), count(*) filter (where not covered and t >= v_handover_end)
  into v_ho, v_alone
  from (
    select t, exists (
      select 1 from pg_temp.ot_people p
      where t >= greatest(case when p.fi >= v_start - interval '30 minutes' then p.fi + interval '30 minutes' else p.fi end, v_start)
        and t < p.lo) covered
    from generate_series(v_start, v_end - interval '1 minute', interval '1 minute') t
  ) m;

  select string_agg(name || ' ' || n || ' د', '، ') into v_with
  from (
    select p.name, count(*) n
    from generate_series(v_start, v_end - interval '1 minute', interval '1 minute') t
    join pg_temp.ot_people p
      on t >= greatest(case when p.fi >= v_start - interval '30 minutes' then p.fi + interval '30 minutes' else p.fi end, v_start)
     and t < p.lo
    group by p.name
  ) w;

  if v_relief is not null then
    v_parts := v_parts || format('%s جه %s واستلم منه%s', v_relief_name,
      to_char(v_relief at time zone 'Africa/Cairo', 'HH24:MI'),
      case when v_ho > 0 then format(' (%s د انتظار وتسليم)', v_ho) else '' end);
  end if;
  if v_with is not null then
    v_parts := v_parts || format('كان معاه من %s %s', v_group, v_with);
  end if;

  v_paid := v_ho;
  if v_alone > 10 then
    if v_warehouse then
      if v_paid <= 20 then
        return jsonb_build_object('action', 'ask',
          'why', array_to_string(v_parts || format('فضل في المخزن %s د لوحده، ومفيش مبيعات نحكم بيها', v_alone), ' · '));
      end if;
      v_parts := v_parts || format('%s د لوحده في المخزن بعد التسليم مش متحسبين', v_alone);
    else
      v_branch := (v_ev->'sales'->'branch_overtime'->>'invoice_count')::int;
      v_own := case when coalesce((v_ev->'sales'->>'employee_attribution_available')::boolean, false)
        then coalesce((v_ev->'sales'->'employee_overtime'->>'invoice_count')::int, 0) end;
      if v_branch is null then
        return jsonb_build_object('action', 'ask', 'why', 'مبيعات الفرع في الوقت ده مش متاحة');
      elsif v_branch = 0 then
        v_parts := v_parts || 'الفرع مابعش حاجة في الوقت ده'::text;
      elsif v_own = 0 then
        v_parts := v_parts || 'الفرع باع بس ماعليهوش ولا فاتورة في الوقت ده'::text;
      else
        v_paid := v_paid + v_alone;
        v_parts := v_parts || format('لوحده من %s %s د والفرع شغال', v_group, v_alone);
      end if;
    end if;
  end if;
  if v_late > 20 then
    v_parts := v_parts || format('التأخير %s د بيتخصم لوحده', v_late);
  end if;
  if v_paid <= 20 then
    return jsonb_build_object('action', 'reject',
      'why', coalesce(nullif(array_to_string(v_parts, ' · '), ''), 'مفيش سبب يخليه يقعد') || '، ومحدش طلب منه يقعد');
  end if;
  if v_paid >= v_after - 10 then
    return jsonb_build_object('action', 'approve',
      'why', array_to_string(v_parts, ' · ') || format(' · يتحسب %s د', v_after));
  end if;
  return jsonb_build_object('action', 'approve', 'minutes', v_paid,
    'why', array_to_string(v_parts, ' · ') || format(' · يتحسب %s د من %s د', v_paid, v_after));
end;
$function$;
revoke all on function public.dr_wael_overtime_auto_choice_v1(uuid) from public, anon;

-- 4. The morning run.
create or replace function public.dr_wael_auto_decisions_v1(p_days_back int default 62)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account uuid;
  v_auth uuid;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_day record;
  v_decision text;
  v_done jsonb := '{}'::jsonb;
  v_failed int := 0;
  v_ot record;
  v_choice jsonb;
  v_note text;
begin
  select a.id, a.auth_user_id into v_account, v_auth
  from public.dr_wael_auto_decider_v1 d
  join public.staff_accounts a on a.id = d.staff_account_id
  where coalesce(a.active, false) and coalesce(a.can_login, false) and a.auth_user_id is not null
  order by d.created_at limit 1;
  if v_auth is null then
    return jsonb_build_object('ran', false, 'why', 'no_active_decider');
  end if;
  perform set_config('request.jwt.claim.sub', v_auth::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_auth, 'role', 'authenticated')::text, true);

  for v_day in
    with drifting as (
      select a.staff_id
      from public.attendance_daily_summary a
      where a.attendance_date >= v_today - 28 and a.first_in is not null and a.last_out is not null
        and a.scheduled_start_at is not null and a.scheduled_end_at is not null
        and abs(extract(epoch from (a.first_in - a.scheduled_start_at))) >= 30 * 60
        and abs(extract(epoch from (a.last_out - a.scheduled_end_at))) >= 30 * 60
        and sign(extract(epoch from (a.first_in - a.scheduled_start_at)))
          = sign(extract(epoch from (a.last_out - a.scheduled_end_at)))
      group by a.staff_id having count(*) >= 3
    )
    select a.staff_id, a.attendance_date, a.resolution_status, a.first_in, a.last_out,
      a.scheduled_start_at, a.scheduled_end_at,
      d.staff_id is not null as drifting
    from public.attendance_daily_summary a
    join public.staff s on s.id = a.staff_id
    left join drifting d on d.staff_id = a.staff_id
    where coalesce(s.active, false)
      and a.attendance_date between v_today - p_days_back and v_today - 1
      and a.status <> 'approved'
      and not exists (
        select 1 from public.staff_monthly_hour_rules hr
        where hr.staff_id = s.id and hr.is_active is true and hr.flexible_daily_hours is true)
    order by a.attendance_date, a.staff_id
  loop
    v_decision := case
      when v_day.resolution_status in ('off_day', 'no_schedule', 'approved_time_off', 'worked_on_off')
           and v_day.first_in is null and v_day.last_out is null then 'as_is'
      when v_day.resolution_status = 'worked_on_off'
           and public.dr_wael_punch_belongs_to_neighbor_v1(v_day.staff_id, v_day.attendance_date) then 'as_is'
      when v_day.resolution_status = 'absence_review' and v_day.first_in is null and v_day.last_out is null
           and v_day.attendance_date <= v_today - 2 then 'absent'
      when v_day.drifting then null
      when v_day.resolution_status = 'missing_checkout' and v_day.first_in is not null
           and v_day.scheduled_start_at is not null and v_day.scheduled_end_at is not null
           and abs(extract(epoch from (v_day.first_in - v_day.scheduled_start_at))) < 90 * 60 then 'to_shift_end'
      when v_day.resolution_status = 'missing_checkin' and v_day.last_out is not null
           and v_day.scheduled_start_at is not null and v_day.scheduled_end_at is not null
           and abs(extract(epoch from (v_day.last_out - v_day.scheduled_end_at))) < 120 * 60 then 'from_shift_start'
      when v_day.resolution_status in ('late', 'early_leave_review')
           and v_day.first_in is not null and v_day.last_out is not null
           and v_day.scheduled_start_at is not null and v_day.scheduled_end_at is not null
           and not (abs(extract(epoch from (v_day.first_in - v_day.scheduled_start_at))) >= 90 * 60
                and abs(extract(epoch from (v_day.last_out - v_day.scheduled_end_at))) >= 90 * 60) then 'as_is'
      else null
    end;
    continue when v_decision is null;
    begin
      perform public.dr_wael_quick_day_decision_v1(v_day.staff_id, v_day.attendance_date, v_decision);
      v_done := jsonb_set(v_done, array[v_decision], to_jsonb(coalesce((v_done->>v_decision)::int, 0) + 1));
    exception when others then
      v_failed := v_failed + 1;
      v_done := jsonb_set(v_done, array['day_error: ' || left(sqlerrm, 60)],
        to_jsonb(coalesce((v_done->>('day_error: ' || left(sqlerrm, 60)))::int, 0) + 1));
    end;
  end loop;

  for v_ot in
    select o.id from public.staff_overtime_approvals o
    join public.attendance_daily_summary a
      on a.staff_id = o.staff_id and a.attendance_date = o.attendance_date and a.status = 'approved'
    where o.status = 'pending' and o.attendance_date between v_today - p_days_back and v_today - 1
    order by o.attendance_date
  loop
    begin
      v_choice := public.dr_wael_overtime_auto_choice_v1(v_ot.id);
      v_note := 'قرار تلقائي: ' || coalesce(v_choice->>'why', '');
      if v_choice->>'action' = 'reject' then
        perform public.decide_overtime_approval_v3(v_ot.id, 'rejected', v_note);
      elsif v_choice->>'action' = 'approve' and v_choice ? 'minutes' then
        perform public.decide_overtime_approval_capped_v1(v_ot.id, (v_choice->>'minutes')::int, v_note);
      elsif v_choice->>'action' = 'approve' then
        perform public.decide_overtime_approval_v3(v_ot.id, 'approved', v_note);
      else
        v_done := jsonb_set(v_done, array['overtime_ask'], to_jsonb(coalesce((v_done->>'overtime_ask')::int, 0) + 1));
        continue;
      end if;
      v_note := 'overtime_' || (v_choice->>'action') || case when v_choice ? 'minutes' then '_part' else '' end;
      v_done := jsonb_set(v_done, array[v_note], to_jsonb(coalesce((v_done->>v_note)::int, 0) + 1));
    exception when others then
      v_failed := v_failed + 1;
      v_done := jsonb_set(v_done, array['overtime_error: ' || left(sqlerrm, 60)],
        to_jsonb(coalesce((v_done->>('overtime_error: ' || left(sqlerrm, 60)))::int, 0) + 1));
    end;
  end loop;

  insert into public.dr_wael_auto_decision_runs_v1(actor_id, result)
  values (v_account, v_done || jsonb_build_object('failed', v_failed));
  return jsonb_build_object('ran', true, 'done', v_done, 'failed', v_failed);
end;
$function$;
revoke all on function public.dr_wael_auto_decisions_v1(int) from public, anon, authenticated;

-- Every morning at 10:00 Cairo, after the night shifts closed.
select cron.schedule('dr-wael-auto-decisions-v1', '0 8 * * *', 'select public.dr_wael_auto_decisions_v1();');
