-- بيكمل 20261108090000:
-- 1) تغيير الشيفت «من الموظف» ليوم أو فترة ما يمسحش الساعات اللي قللها من دقايق تصنيف الدليفري.
--    اليوم بيتحسب بالأكبر: تأخير وانصراف على الشيفت الجديد، أو الناقص عن ساعات الشيفت القديم.
--    التغيير «باستمرار» بيبقى جدوله الجديد ومش بيتحسب عليه كل يوم، و«بطلب مننا» و«تصحيح جدول» مش بيتحسبوا.
--    أثره على التغييرات الجديدة بس، لأن التغييرات القديمة مش محفوظ معاها ساعات الشيفت القديم.
-- 2) تغيير الشيفت من شاشة مراجعة اليوم ومن صفحة الفريق بقى بيتسجل في سجل صفحة البصمات، من غير تحديد مين طلبه.
-- 3) قايمة طلبات الواتساب كانت بترجع 401 لأن الموقع بيشتغل كـ anon؛ الدالة بتتحقق من جلسة الموظف بنفسها.

create or replace function public.dawaa_employee_shift_shortfall_minutes_v1(
  p_staff_id uuid, p_date date, p_first_in timestamptz, p_last_out timestamptz)
returns integer
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_week text[] := array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  v_payload jsonb;
  v_old numeric;
begin
  if p_first_in is null or p_last_out is null or p_last_out <= p_first_in then
    return 0;
  end if;
  -- The last change covering the day decides: a later request from management replaces it.
  select c.payload into v_payload
  from public.dr_wael_change_log_v1 c
  where c.kind = 'shift' and c.staff_id = p_staff_id
    and (c.payload->>'from')::date <= p_date
    and (c.payload->>'mode' = 'permanent' or coalesce((c.payload->>'to')::date, (c.payload->>'from')::date) >= p_date)
    and (jsonb_typeof(c.payload->'days') is distinct from 'array'
         or c.payload->'days' ? v_week[extract(dow from p_date)::int + 1])
  order by c.created_at desc
  limit 1;
  if v_payload is null or v_payload->>'origin' is distinct from 'employee'
     or v_payload->>'mode' not in ('day', 'period') then
    return 0;
  end if;
  v_old := nullif(v_payload->>'old_hours', '')::numeric;
  if v_old is null then
    return 0;
  end if;
  return greatest(round(v_old * 60 - extract(epoch from (p_last_out - p_first_in)) / 60.0), 0)::integer;
end;
$function$;

revoke all on function public.dawaa_employee_shift_shortfall_minutes_v1(uuid, date, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.dawaa_staff_week_signature_v1(p_staff_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_object_agg(d.day_name, d.shift), '{}'::jsonb)
  from (
    select distinct on (trim(ss.day_name)) trim(ss.day_name) as day_name,
      case when coalesce(ss.is_off, false) or coalesce(ss.is_day_off, false) or ss.shift_start is null or ss.shift_end is null
           then 'off' else left(ss.shift_start, 5) || '-' || left(ss.shift_end, 5) end as shift
    from public.shift_schedules ss
    where ss.staff_id = p_staff_id and ss.shift_date is null and ss.date is null and ss.effective_to is null
    order by trim(ss.day_name), ss.effective_from desc nulls last, coalesce(ss.updated_at, ss.created_at) desc nulls last
  ) d;
$function$;

revoke all on function public.dawaa_staff_week_signature_v1(uuid) from public, anon, authenticated;

-- The shift most days of a week signature run on, as HH:MI-HH:MI; null when the whole week is off.
create or replace function public.dawaa_week_main_shift_v1(p_signature jsonb)
returns text
language sql
immutable
set search_path to 'public', 'pg_catalog'
as $function$
  select e.value
  from jsonb_each_text(coalesce(p_signature, '{}'::jsonb)) e
  where e.value <> 'off'
  group by e.value
  order by count(*) desc, e.value
  limit 1;
$function$;

revoke all on function public.dawaa_week_main_shift_v1(jsonb) from public, anon, authenticated;

do $migration$
declare
  v_def text;
  v_next text;
  v_patch record;
  v_target record;
begin
  for v_target in
    select * from (values
      ('public.dawaa_delivery_discipline_evidence_v1(uuid,text)',
       'else greatest(coalesce(a.late_minutes,0),0)+greatest(coalesce(a.early_leave_minutes,0),0)',
       E'else greatest(\n        greatest(coalesce(a.late_minutes,0),0)+greatest(coalesce(a.early_leave_minutes,0),0),\n        public.dawaa_employee_shift_shortfall_minutes_v1(p_staff_id,a.attendance_date,a.first_in,a.last_out))'),
      -- The shortfall can make discipline minutes bigger than late + early: that is not a negative excuse.
      ('public.dawaa_delivery_payroll_classification_v1(uuid,text)',
       'coalesce(sum((e.late_minutes+e.early_leave_minutes)-e.discipline_minutes) filter(where e.attended),0)::integer',
       'coalesce(sum(greatest((e.late_minutes+e.early_leave_minutes)-e.discipline_minutes,0)) filter(where e.attended),0)::integer'),
      ('public.dawaa_delivery_payroll_classification_v1(uuid,text)',
       'classification_minutes = late arrival + early departure after approved permission exemptions;',
       'classification_minutes = late arrival + early departure after approved permission exemptions, or the hours cut by a dated shift change the employee asked for when that is bigger;'),
      ('public.get_dr_wael_credit_ledger_v1(text)',
       'where e.attended and e.late_minutes + e.early_leave_minutes > 0)',
       'where e.attended and (e.late_minutes + e.early_leave_minutes > 0 or e.discipline_minutes > 0))'),
      ('public.resolve_dated_shift_from_attendance_v1(uuid,date,time without time zone,time without time zone,text)',
       ' -- Place this specific day under explicit manager review BEFORE recomputing it.',
       E' -- Shown in the fingerprints page until someone answers who asked for it.\n'
       || E' insert into public.dr_wael_change_log_v1(kind,staff_id,payload,actor_id)\n'
       || E' values(''shift'',p_staff_id,jsonb_build_object(''mode'',''day'',''start'',p_start,''end'',p_end,''from'',p_date,''to'',p_date,\n'
       || E'   ''days'',null,''written'',1,''rebuilt'',0,''kept'',0,''skipped'',''[]''::jsonb,''note'',trim(p_note),''origin'',null,\n'
       || E'   ''source'',''attendance_review'',\n'
       || E'   ''old_start'',case when coalesce(v_schedule.is_off,false) or coalesce(v_schedule.is_day_off,false) then null else v_schedule.shift_start end,\n'
       || E'   ''old_end'',case when coalesce(v_schedule.is_off,false) or coalesce(v_schedule.is_day_off,false) then null else v_schedule.shift_end end,\n'
       || E'   ''old_hours'',case when coalesce(v_schedule.is_off,false) or coalesce(v_schedule.is_day_off,false) or v_schedule.shift_start is null or v_schedule.shift_end is null then null\n'
       || E'     else round((extract(epoch from (v_schedule.shift_end-v_schedule.shift_start))/3600.0+case when v_schedule.shift_end<=v_schedule.shift_start then 24 else 0 end)::numeric,2) end,\n'
       || E'   ''new_hours'',v_hours),public.dawaa_session_account_id_v1());\n'
       || ' -- Place this specific day under explicit manager review BEFORE recomputing it.'),
      ('public.replace_staff_shift_schedule_version_v1(uuid,jsonb,date,text)',
       '  v_count integer:=0;',
       E'  v_count integer:=0;\n  v_before jsonb;\n  v_after jsonb;\n  v_old_main text;\n  v_new_main text;'),
      ('public.replace_staff_shift_schedule_version_v1(uuid,jsonb,date,text)',
       '  for v_row in select value from jsonb_array_elements(p_rows)',
       E'  v_before:=public.dawaa_staff_week_signature_v1(p_staff_id);\n\n  for v_row in select value from jsonb_array_elements(p_rows)'),
      ('public.replace_staff_shift_schedule_version_v1(uuid,jsonb,date,text)',
       E'  return jsonb_build_object(\n    ''success'',true,''staff_id'',p_staff_id,''staff_name'',v_staff.name,',
       E'  -- This form saves the whole week on every employee edit: only a real change reaches the fingerprints page.\n'
       || E'  v_after:=public.dawaa_staff_week_signature_v1(p_staff_id);\n'
       || E'  v_new_main:=public.dawaa_week_main_shift_v1(v_after);\n'
       || E'  v_old_main:=public.dawaa_week_main_shift_v1(v_before);\n'
       || E'  if v_before <> ''{}''::jsonb and v_after is distinct from v_before and v_new_main is not null then\n'
       || E'    insert into public.dr_wael_change_log_v1(kind,staff_id,payload,actor_id)\n'
       || E'    values(''shift'',p_staff_id,jsonb_build_object(''mode'',''permanent'',\n'
       || E'      ''start'',split_part(v_new_main,''-'',1),''end'',split_part(v_new_main,''-'',2),\n'
       || E'      ''from'',p_effective_from,''to'',null,''days'',null,''written'',v_count,''rebuilt'',0,''kept'',0,''skipped'',''[]''::jsonb,\n'
       || E'      ''note'',coalesce(nullif(trim(p_note),''''),''تحديث جدول الموظف''),''origin'',null,''source'',''team_schedule'',\n'
       || E'      ''old_start'',split_part(v_old_main,''-'',1),''old_end'',split_part(v_old_main,''-'',2)),v_actor.id);\n'
       || E'  end if;\n\n'
       || E'  return jsonb_build_object(\n    ''success'',true,''staff_id'',p_staff_id,''staff_name'',v_staff.name,')
    ) as t(target, old_text, new_text)
  loop
    v_def := pg_get_functiondef(v_target.target::regprocedure);
    v_next := replace(v_def, v_target.old_text, v_target.new_text);
    if v_next = v_def then
      raise exception 'patch anchor not found in %: %', v_target.target, v_target.old_text;
    end if;
    execute v_next;
  end loop;
end;
$migration$;

-- The dated corrections already made in the running pay cycle: waiting for an answer, counted for nobody.
insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id, created_at)
select 'shift', c.staff_id,
  jsonb_build_object('mode', 'day', 'start', c.shift_start, 'end', c.shift_end, 'from', c.attendance_date,
    'to', c.attendance_date, 'days', null, 'written', 1, 'rebuilt', 0, 'kept', 0, 'skipped', '[]'::jsonb,
    'note', c.note, 'origin', null, 'source', 'attendance_review',
    'old_start', c.previous_schedule->>'shift_start', 'old_end', c.previous_schedule->>'shift_end',
    'old_hours', case when (c.previous_schedule->>'shift_start') is null or (c.previous_schedule->>'shift_end') is null then null
      else round((extract(epoch from ((c.previous_schedule->>'shift_end')::time - (c.previous_schedule->>'shift_start')::time)) / 3600.0
        + case when (c.previous_schedule->>'shift_end')::time <= (c.previous_schedule->>'shift_start')::time then 24 else 0 end)::numeric, 2) end,
    'new_hours', round((extract(epoch from (c.shift_end - c.shift_start)) / 3600.0
        + case when c.shift_end <= c.shift_start then 24 else 0 end)::numeric, 2)),
  c.actor_id, c.created_at
from public.attendance_dated_shift_corrections_v1 c
where c.attendance_date >= date '2026-10-26'
  and not exists (
    select 1 from public.dr_wael_change_log_v1 l
    where l.kind = 'shift' and l.staff_id = c.staff_id
      and l.payload->>'mode' = 'day' and l.payload->>'from' = c.attendance_date::text);

grant execute on function public.whatsapp_auto_followup_list_v2(text, text) to anon;

notify pgrst, 'reload schema';
