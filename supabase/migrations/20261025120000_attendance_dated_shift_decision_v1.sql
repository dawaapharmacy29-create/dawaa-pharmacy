-- One-day shift correction from Attendance Resolution Center.
-- No edits to recurring weekly schedules; no automatic approval or payroll writes.
create table if not exists public.attendance_dated_shift_corrections_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  attendance_date date not null,
  previous_schedule jsonb not null,
  shift_start time not null,
  shift_end time not null,
  override_id uuid not null references public.shift_schedules(id),
  actor_id text,
  note text not null,
  created_at timestamptz not null default now(),
  unique (staff_id, attendance_date)
);
alter table public.attendance_dated_shift_corrections_v1 enable row level security;
revoke all on public.attendance_dated_shift_corrections_v1 from public,anon,authenticated;
grant all on public.attendance_dated_shift_corrections_v1 to service_role;

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
 if not public.dawaa_time_off_can_decide_staff_v1(p_staff_id) then
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
 -- Recompute through the canonical guard. Do not approve unproven days here.
 v_result:=public.dawaa_materialize_attendance_day_internal_v2(p_staff_id,p_date);
 return jsonb_build_object('success',true,'correction_id',v_record_id,
   'override_id',v_override_id,'date',p_date,'materialization',coalesce(v_result,'{}'::jsonb),
   'requires_review',true);
end;
$fn$;
revoke execute on function public.resolve_dated_shift_from_attendance_v1(uuid,date,time,time,text) from public,anon;
grant execute on function public.resolve_dated_shift_from_attendance_v1(uuid,date,time,time,text) to authenticated,service_role;
notify pgrst,'reload schema';
