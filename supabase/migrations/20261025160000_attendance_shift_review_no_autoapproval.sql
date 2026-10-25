-- Keep a dated shift correction pending manager review, even where the canonical
-- materializer would otherwise auto-approve. Never relax the approval guard.
-- Review-only change to the previously deployed function.
create or replace function public.resolve_dated_shift_from_attendance_v1(
 p_staff_id uuid,p_date date,p_start time,p_end time,p_note text
) returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $fn$
declare
 v_staff public.staff%rowtype;
 v_schedule record;
 v_override_count integer;
 v_override_id uuid;
 v_hours numeric;
 v_record_id uuid;
 v_result jsonb;
begin
 if p_staff_id is null or p_date is null or p_start is null or p_end is null
    or p_start=p_end or length(trim(coalesce(p_note,'')))<5 then
   raise exception 'shift_correction_requires_date_times_and_reason' using errcode='22023';
 end if;
 if public.dawaa_session_account_id_v1() is null
    or public.dawaa_current_staff_account_id_strict() is distinct from public.dawaa_session_account_id_v1()
    or not coalesce(public.dawaa_time_off_can_decide_staff_v1(p_staff_id),false) then
   raise exception 'not_authorized_for_attendance_shift_correction' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_staff_id::text||':'||p_date::text,0));
 select * into v_staff from public.staff where id=p_staff_id;
 if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
 if exists(select 1 from public.attendance_daily_summary a
           where a.staff_id=p_staff_id and a.attendance_date=p_date and a.status='approved') then
   raise exception 'approved_attendance_cannot_be_rewritten' using errcode='55000';
 end if;
 if exists(select 1 from public.attendance_dated_shift_corrections_v1 a
           where a.staff_id=p_staff_id and a.attendance_date=p_date) then
   raise exception 'dated_shift_correction_already_exists_review_first' using errcode='55000';
 end if;
 if exists(select 1 from public.staff_time_off_requests r where r.staff_id=p_staff_id and r.status='approved'
    and r.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence')
    and p_date between r.start_date and r.end_date) then
   raise exception 'shift_correction_conflicts_with_approved_leave' using errcode='55000';
 end if;
 select * into v_schedule from public.attendance_schedule_for_date_v1(p_staff_id,p_date) limit 1;
 if v_schedule.schedule_id is null then
   raise exception 'dated_shift_correction_missing_schedule' using errcode='55000';
 end if;
 select count(*) into v_override_count from public.shift_schedules
 where staff_id=p_staff_id and coalesce(shift_date,date)=p_date;
 if v_override_count<>0 then
   raise exception 'dated_shift_correction_existing_override_needs_review' using errcode='55000';
 end if;
 v_hours:=round((extract(epoch from ((timestamp '2000-01-01'+p_end)
                  -(timestamp '2000-01-01'+p_start)
                  +case when p_end<=p_start then interval '1 day' else interval '0 day' end))/3600)::numeric,2);
 if v_hours>18 then raise exception 'shift_correction_exceeds_18_hours' using errcode='22023'; end if;
 insert into public.shift_schedules (
 staff_id,staff_name,employee_name,role,branch,day_name,shift_start,shift_end,
 start_time,end_time,hours,is_off,is_day_off,is_different,has_custom_time,
 shift_date,date,status,source,notes,effective_from,effective_to
 ) values (
 p_staff_id,v_staff.name,v_staff.name,v_staff.role,v_staff.branch,
 case extract(dow from p_date)::int when 0 then 'الأحد' when 1 then 'الاثنين'
 when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس'
 when 5 then 'الجمعة' else 'السبت' end,
 to_char(p_start,'HH24:MI'),to_char(p_end,'HH24:MI'),
 p_start,p_end,v_hours,false,false,true,true,
 p_date,p_date,'scheduled','attendance_dated_shift_correction_v1',trim(p_note),p_date,p_date
 ) returning id into v_override_id;
 insert into public.attendance_dated_shift_corrections_v1
 (staff_id,attendance_date,previous_schedule,shift_start,shift_end,override_id,actor_id,note)
 values (p_staff_id,p_date,to_jsonb(v_schedule),p_start,p_end,v_override_id,
 public.employee_operating_actor_id(),trim(p_note)) returning id into v_record_id;
 -- Place this specific day under explicit manager review BEFORE recomputing it.
 -- The canonical materializer may auto-approve a fully evidenced day; that is
 -- inappropriate for a schedule correction awaiting a manager's final decision.
 insert into public.attendance_inline_review_holds_v1(staff_id,attendance_date,actor_id,reason)
 values(p_staff_id,p_date,public.dawaa_session_account_id_v1(),'shift')
 on conflict(staff_id,attendance_date) do nothing;
 -- Use the canonical builder's review-only projection. This never writes
 -- approved status or payroll-eligible hours.
 v_result:=to_jsonb(public.dawaa_refresh_inline_attendance_review_v1(p_staff_id,p_date));
 return jsonb_build_object('success',true,'correction_id',v_record_id,
   'override_id',v_override_id,'date',p_date,'materialization',coalesce(v_result,'{}'::jsonb),
   'requires_review',true);
end;
$fn$;
notify pgrst,'reload schema';
