-- كريديت الالتزام والمرونة لكل موظف.
--
-- كل تغيير ميعاد من صفحة البصمات بقى بيتسجل مين طلبه:
--   management = بطلب مننا (له) · employee = من الموظف (عليه) · correction = تصحيح جدول (محايد)
-- العمود القديم بيفضل شغال: لو حد نداها من غير p_origin التغيير بيتسجل «من غير تحديد» ومابيتحسبش له ولا عليه.
--
-- ده عرض للإدارة بس: مفيش أي تغيير في المرتب ولا في تصنيف الدليفري ولا في الخصومات.

do $migration$
declare
  v_old_signature regprocedure :=
    'public.dr_wael_apply_shift_change_v1(uuid,time without time zone,time without time zone,text,date,date,text[],text)'::regprocedure;
  v_def text;
  v_next text;
  v_patch record;
begin
  v_def := pg_get_functiondef(v_old_signature);
  for v_patch in
    select * from (values
      ('p_note text DEFAULT NULL::text)',
       'p_note text DEFAULT NULL::text, p_origin text DEFAULT NULL::text)'),
      ('  v_covered boolean;',
       E'  v_covered boolean;\n  v_old record;\n  v_old_hours numeric;'),
      ('  if p_staff_id is null or p_start is null or p_end is null',
       E'  if p_origin is not null and p_origin not in (''management'', ''employee'', ''correction'') then\n'
       || E'    raise exception ''invalid_shift_origin'' using errcode = ''22023'';\n'
       || E'  end if;\n'
       || '  if p_staff_id is null or p_start is null or p_end is null'),
      ($p$  perform pg_advisory_xact_lock(hashtextextended('dr_wael_shift:' || p_staff_id::text, 0));$p$,
       $p$  perform pg_advisory_xact_lock(hashtextextended('dr_wael_shift:' || p_staff_id::text, 0));

  -- The shift it replaces, read before anything is written: the credit shows whether the hours went down.
  select * into v_old from public.attendance_schedule_for_date_v1(p_staff_id, p_from) limit 1;
  if found and not coalesce(v_old.is_off, false) and not coalesce(v_old.is_day_off, false)
     and v_old.shift_start is not null and v_old.shift_end is not null then
    v_old_hours := round((extract(epoch from (v_old.shift_end - v_old.shift_start)) / 3600.0
                          + case when v_old.shift_end <= v_old.shift_start then 24 else 0 end)::numeric, 2);
  end if;$p$),
      ($p$'skipped', v_skipped, 'note', v_note), v_actor);$p$,
       $p$'skipped', v_skipped, 'note', v_note, 'origin', p_origin,
    'old_start', case when v_old_hours is not null then v_old.shift_start end,
    'old_end', case when v_old_hours is not null then v_old.shift_end end,
    'old_hours', v_old_hours, 'new_hours', v_hours), v_actor);$p$)
    ) as t(old_text, new_text)
  loop
    v_next := replace(v_def, v_patch.old_text, v_patch.new_text);
    if v_next = v_def then
      raise exception 'patch anchor not found: %', v_patch.old_text;
    end if;
    v_def := v_next;
  end loop;

  drop function public.dr_wael_apply_shift_change_v1(uuid, time without time zone, time without time zone, text, date, date, text[], text);
  execute v_def;
end;
$migration$;

revoke all on function public.dr_wael_apply_shift_change_v1(uuid, time without time zone, time without time zone, text, date, date, text[], text, text) from public;
grant execute on function public.dr_wael_apply_shift_change_v1(uuid, time without time zone, time without time zone, text, date, date, text[], text, text) to anon, authenticated, service_role;

-- Set or correct who asked for a change already made, including the ones from before this question existed.
create or replace function public.dr_wael_set_shift_origin_v1(p_change_id uuid, p_origin text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
begin
  if p_change_id is null or p_origin is null or p_origin not in ('management', 'employee', 'correction') then
    raise exception 'invalid_shift_origin' using errcode = '22023';
  end if;
  update public.dr_wael_change_log_v1
  set payload = payload || jsonb_build_object('origin', p_origin, 'origin_set_at', now(), 'origin_set_by', v_actor)
  where id = p_change_id and kind = 'shift';
  if not found then
    raise exception 'shift_change_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('success', true, 'id', p_change_id, 'origin', p_origin);
end;
$function$;

revoke all on function public.dr_wael_set_shift_origin_v1(uuid, text) from public;
grant execute on function public.dr_wael_set_shift_origin_v1(uuid, text) to anon, authenticated, service_role;

-- One row per employee for a pay cycle: the punctuality numbers next to who asked for each shift change.
-- A change belongs to the cycle of the day it starts from. Setting the same change twice counts once (the last one).
create or replace function public.get_dr_wael_staff_credit_v1(p_month_cycle text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_branches text[] := array['فرع شكري', 'فرع الشامي', 'المخزن'];
  v_cycle text := p_month_cycle;
  v_start date;
  v_end date;
  v_committed int;
  v_regular int;
  v_rows jsonb;
  v_unclassified jsonb;
begin
  perform public.dr_wael_fingerprints_actor_v1();
  if v_cycle is null then
    v_cycle := to_char(case when extract(day from v_today) >= 26 then v_today + interval '1 month' else v_today end, 'YYYY-MM');
  elsif v_cycle !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_month_cycle' using errcode = '22023';
  end if;
  v_end := to_date(v_cycle || '-25', 'YYYY-MM-DD');
  v_start := (v_end - interval '1 month')::date + 1;

  select p.committed_credit_minutes_per_day, p.regular_credit_minutes_per_day
    into v_committed, v_regular
  from public.delivery_payroll_policy_versions p
  where p.active = true and p.effective_from <= v_end and (p.effective_to is null or p.effective_to >= v_end)
  order by p.effective_from desc, p.created_at desc
  limit 1;

  with latest as (
    select distinct on (c.staff_id, c.payload->>'mode', c.payload->>'from', c.payload->>'to', coalesce(c.payload->>'days', ''))
      c.id, c.staff_id, c.created_at, c.payload
    from public.dr_wael_change_log_v1 c
    where c.kind = 'shift' and c.staff_id is not null
    order by c.staff_id, c.payload->>'mode', c.payload->>'from', c.payload->>'to', coalesce(c.payload->>'days', ''),
             c.created_at desc
  ),
  shaped as (
    select l.staff_id, (l.payload->>'from')::date as from_date, l.payload->>'origin' as origin,
      nullif(l.payload->>'old_hours', '')::numeric as old_hours,
      nullif(l.payload->>'new_hours', '')::numeric as new_hours,
      jsonb_build_object(
        'id', l.id, 'staff_id', l.staff_id,
        'at', (l.created_at at time zone 'Africa/Cairo')::date,
        'mode', l.payload->>'mode', 'from', l.payload->>'from', 'to', l.payload->>'to',
        'start', l.payload->>'start', 'end', l.payload->>'end',
        'old_start', l.payload->>'old_start', 'old_end', l.payload->>'old_end',
        'old_hours', nullif(l.payload->>'old_hours', '')::numeric,
        'new_hours', nullif(l.payload->>'new_hours', '')::numeric,
        'origin', l.payload->>'origin', 'note', l.payload->>'note') as item,
      l.created_at
    from latest l
  ),
  st as (
    select s.id from public.staff s where s.is_active is true and s.branch = any(v_branches)
    union
    select a.staff_id from public.attendance_daily_summary a
    where a.attendance_date between v_start and v_end and a.branch = any(v_branches) and a.staff_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'staff_id', s.id, 'name', s.name, 'branch', s.branch,
      'attended_days', e.attended_days, 'late_minutes', e.late_minutes, 'early_minutes', e.early_minutes,
      'excused_minutes', e.excused_minutes, 'minutes', e.minutes, 'absent_days', e.absent_days,
      'missing_used', (select count(*) from public.attendance_missing_punch_incidents i
                       where i.staff_id = s.id and i.attendance_date between v_start and v_end),
      'management', ch.management, 'employee', ch.employee, 'correction', ch.correction,
      'unclassified', ch.unclassified, 'reduced', ch.reduced, 'changes', ch.items
    )), '[]'::jsonb)
    into v_rows
  from st
  join public.staff s on s.id = st.id
  cross join lateral (
    select
      count(*) filter (where d.attended)::int as attended_days,
      coalesce(sum(d.late_minutes) filter (where d.attended and not d.permission_exempt), 0)::int as late_minutes,
      coalesce(sum(d.early_leave_minutes) filter (where d.attended and not d.permission_exempt), 0)::int as early_minutes,
      coalesce(sum(d.late_minutes + d.early_leave_minutes) filter (where d.attended and d.permission_exempt), 0)::int as excused_minutes,
      coalesce(sum(d.discipline_minutes) filter (where d.attended), 0)::int as minutes,
      count(*) filter (where d.attendance_status = 'approved' and d.resolution_status = 'absence_review')::int as absent_days
    from public.dawaa_delivery_discipline_evidence_v1(s.id, v_cycle) d
  ) e
  cross join lateral (
    select
      count(*) filter (where x.origin = 'management')::int as management,
      count(*) filter (where x.origin = 'employee')::int as employee,
      count(*) filter (where x.origin = 'correction')::int as correction,
      count(*) filter (where x.origin is null)::int as unclassified,
      count(*) filter (where x.origin = 'employee' and x.old_hours > x.new_hours)::int as reduced,
      coalesce(jsonb_agg(x.item order by x.from_date desc, x.created_at desc), '[]'::jsonb) as items
    from shaped x
    where x.staff_id = s.id and x.from_date between v_start and v_end
  ) ch;

  -- Waiting for an answer whatever the cycle, newest first: the changes made before the question existed.
  with latest as (
    select distinct on (c.staff_id, c.payload->>'mode', c.payload->>'from', c.payload->>'to', coalesce(c.payload->>'days', ''))
      c.id, c.staff_id, c.created_at, c.payload
    from public.dr_wael_change_log_v1 c
    where c.kind = 'shift' and c.staff_id is not null
    order by c.staff_id, c.payload->>'mode', c.payload->>'from', c.payload->>'to', coalesce(c.payload->>'days', ''),
             c.created_at desc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id, 'staff_id', l.staff_id, 'name', s.name,
      'at', (l.created_at at time zone 'Africa/Cairo')::date,
      'mode', l.payload->>'mode', 'from', l.payload->>'from', 'to', l.payload->>'to',
      'start', l.payload->>'start', 'end', l.payload->>'end',
      'old_start', l.payload->>'old_start', 'old_end', l.payload->>'old_end',
      'old_hours', nullif(l.payload->>'old_hours', '')::numeric,
      'new_hours', nullif(l.payload->>'new_hours', '')::numeric,
      'origin', null, 'note', l.payload->>'note'
    ) order by l.created_at desc), '[]'::jsonb)
    into v_unclassified
  from latest l
  join public.staff s on s.id = l.staff_id
  where l.payload->>'origin' is null;

  return jsonb_build_object(
    'month_cycle', v_cycle, 'cycle_start', v_start, 'cycle_end', v_end, 'today', v_today,
    'committed_per_day', coalesce(v_committed, 5), 'regular_per_day', coalesce(v_regular, 30),
    'rows', v_rows, 'unclassified', v_unclassified);
end;
$function$;

revoke all on function public.get_dr_wael_staff_credit_v1(text) from public;
grant execute on function public.get_dr_wael_staff_credit_v1(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
