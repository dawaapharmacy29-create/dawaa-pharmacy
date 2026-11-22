-- Owner decision 2026-11-23: standing night shifts.
--   د اسلام فاروق: 19:00 → 05:00 from 21/11 (back at work that day; he had no schedule).
--   اسلام السبع:   19:00 → 03:00 from 21/11 (his schedule still said 09:00 → 19:00, so every evening check-in
--                  was read as the check-out of a day shift). His Friday off is kept.
-- Same steps as «اعتبره شيفت» permanent (dr_wael_apply_shift_change_v1), which needs an app session: the open
-- weekday rows are closed the day before, new rows start on the date, and the days since are read again unless a
-- manager already approved them.
do $$
declare
  v_week text[] := array['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_change record;
  v_staff public.staff%rowtype;
  v_row record;
  v_day text;
  v_date date;
  v_hours numeric;
  v_note text;
begin
  for v_change in
    select * from (values
      ('3b2f682d-be41-4374-a0b8-25411ee6e8d3'::uuid, time '19:00', time '05:00', date '2026-11-21'),
      ('8109f1b4-0b6b-4b70-b823-ff6abf1bcf8b'::uuid, time '19:00', time '03:00', date '2026-11-21')
    ) c(staff_id, s, e, from_date)
  loop
    select * into v_staff from public.staff where id = v_change.staff_id and is_active is true;
    if not found then
      raise exception 'staff % not active', v_change.staff_id;
    end if;
    v_hours := round((extract(epoch from (v_change.e - v_change.s)) / 3600.0
                      + case when v_change.e <= v_change.s then 24 else 0 end)::numeric, 2);
    v_note := 'قرار المالك 23/11: شيفت ثابت ' || to_char(v_change.s, 'HH24:MI') || ' → ' || to_char(v_change.e, 'HH24:MI');

    foreach v_day in array v_week loop
      select ss.* into v_row from public.shift_schedules ss
      where ss.staff_id = v_change.staff_id and ss.shift_date is null and ss.date is null and trim(ss.day_name) = v_day
        and ss.effective_from <= v_change.from_date and (ss.effective_to is null or ss.effective_to >= v_change.from_date)
      order by ss.effective_from desc, coalesce(ss.updated_at, ss.created_at) desc nulls last
      limit 1;
      if found and (coalesce(v_row.is_off, false) or coalesce(v_row.is_day_off, false)) then
        continue;  -- the day off stays
      end if;

      delete from public.shift_schedules
      where staff_id = v_change.staff_id and shift_date is null and date is null and trim(day_name) = v_day
        and effective_from > v_change.from_date;

      update public.shift_schedules
      set effective_to = v_change.from_date - 1,
          notes = concat_ws(' | ', nullif(notes, ''), 'أُغلق بميعاد جديد — ' || v_note)
      where staff_id = v_change.staff_id and shift_date is null and date is null and trim(day_name) = v_day
        and effective_from < v_change.from_date and (effective_to is null or effective_to >= v_change.from_date);

      insert into public.shift_schedules(
        staff_id, staff_name, employee_name, role, branch, day_name, shift_start, shift_end, start_time, end_time,
        hours, is_off, is_day_off, is_different, has_custom_time, notes, source, status, effective_from, effective_to)
      values (
        v_change.staff_id, v_staff.name, v_staff.name, v_staff.role, v_staff.branch, v_day,
        to_char(v_change.s, 'HH24:MI'), to_char(v_change.e, 'HH24:MI'), v_change.s, v_change.e,
        v_hours, false, false, true, true, v_note, 'dr_wael_smart_shift_v1', 'scheduled', v_change.from_date, null);
    end loop;

    for v_date in select g::date from generate_series(v_change.from_date - 1, v_today, interval '1 day') g loop
      if exists (select 1 from public.attendance_daily_summary a
                 where a.staff_id = v_change.staff_id and a.attendance_date = v_date
                   and a.status = 'approved' and coalesce(a.approved_by, '') not like 'system:%') then
        continue;
      end if;
      if not exists (select 1 from public.attendance_daily_summary a where a.staff_id = v_change.staff_id and a.attendance_date = v_date)
         and not exists (select 1 from public.staff_attendance_logs l where l.staff_id = v_change.staff_id and l.shift_date = v_date) then
        continue;
      end if;
      update public.attendance_daily_summary
      set status = 'pending_review', updated_at = now()
      where staff_id = v_change.staff_id and attendance_date = v_date and status = 'approved' and approved_by like 'system:%';
      perform public.dr_wael_resync_day_punches_internal_v1(v_change.staff_id, v_date);
      perform public.dawaa_materialize_attendance_day_internal_v3(v_change.staff_id, v_date);
    end loop;

    insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
    values ('shift', v_change.staff_id, jsonb_build_object('mode', 'permanent', 'start', v_change.s, 'end', v_change.e,
      'from', v_change.from_date, 'note', v_note, 'origin', 'correction', 'new_hours', v_hours), null);
  end loop;
end $$;

-- اسلام السبع 21/11: the quick decision added a check-in at 09:00 (start of the old day shift) with a missing-punch
-- record. He worked that night 19:43 → 22/11 03:19. The 09:00 punch is turned down, the record is voided like the
-- other six (backup table) and his records are numbered again; the day is read on the night shift.
with wrong as (
  select i.id from public.attendance_missing_punch_incidents i
  where i.staff_id = '8109f1b4-0b6b-4b70-b823-ff6abf1bcf8b' and i.attendance_date = date '2026-11-21'
    and i.missing_type = 'check_in' and i.deduction_transaction_id is null
),
saved as (
  insert into public.attendance_missing_punch_incidents_voided_v1
  select i.*, now(), 'قرار المالك 23/11: اتسجل على جدول النهار القديم، وهو اشتغل الليلة 19:43 → 03:19'
  from public.attendance_missing_punch_incidents i where i.id in (select id from wrong)
  returning id
)
delete from public.attendance_missing_punch_incidents i where i.id in (select id from saved);

update public.staff_attendance_logs
set status = 'rejected'
where staff_id = '8109f1b4-0b6b-4b70-b823-ff6abf1bcf8b' and shift_date = date '2026-11-21'
  and attendance_type = 'check_in' and recorded_at = timestamptz '2026-11-21 09:00:00+02' and status = 'accepted';

with renum as (
  select i.id, row_number() over (partition by i.staff_id, i.month_cycle order by i.attendance_date, i.created_at) as n
  from public.attendance_missing_punch_incidents i where i.staff_id = '8109f1b4-0b6b-4b70-b823-ff6abf1bcf8b'
)
update public.attendance_missing_punch_incidents i
set occurrence_no = r.n, penalty_eligible = r.n > i.allowance_limit, updated_at = now()
from renum r where r.id = i.id and i.deduction_transaction_id is null;

select public.dr_wael_resync_day_punches_internal_v1('8109f1b4-0b6b-4b70-b823-ff6abf1bcf8b', date '2026-11-21');
select public.dawaa_materialize_attendance_day_internal_v3('8109f1b4-0b6b-4b70-b823-ff6abf1bcf8b', date '2026-11-21');
