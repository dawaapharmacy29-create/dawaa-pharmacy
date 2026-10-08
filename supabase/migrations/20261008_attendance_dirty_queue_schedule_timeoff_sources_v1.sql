create or replace function public.dawaa_mark_attendance_dirty_v1(p_staff_id uuid,p_attendance_date date,p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if p_staff_id is null or p_attendance_date is null then return; end if;
  if not exists(
    select 1 from public.staff s
    where s.id=p_staff_id and coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
  ) then return; end if;

  insert into public.attendance_materialization_dirty_queue_v1(
    staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,
    attempts,processed_at,last_action,last_error
  ) values(
    p_staff_id,p_attendance_date,coalesce(nullif(trim(p_reason),''),'attendance_source_changed'),now(),now(),now(),0,null,null,null
  )
  on conflict(staff_id,attendance_date) do update set
    dirty_reason=excluded.dirty_reason,
    last_seen_at=now(),
    next_attempt_at=now(),
    attempts=0,
    processed_at=null,
    last_action=null,
    last_error=null;
end;
$function$;

revoke all on function public.dawaa_mark_attendance_dirty_v1(uuid,date,text) from public,anon,authenticated;
grant execute on function public.dawaa_mark_attendance_dirty_v1(uuid,date,text) to service_role;

create or replace function public.dawaa_mark_attendance_dirty_from_schedule_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_start date;
  v_end date;
  v_staff uuid;
  v_specific date;
  v_from date;
  v_to date;
  v_dow int;
  v_day text;
  v_d date;
  v_reason text;
  v_pass int;
begin
  select cycle_start,cycle_end into v_start,v_end from public.dawaa_pay_cycle_bounds_v1(null);
  v_reason:=case tg_op when 'INSERT' then 'shift_schedule_insert' when 'UPDATE' then 'shift_schedule_update' else 'shift_schedule_delete' end;

  for v_pass in 1..2 loop
    if (tg_op='INSERT' and v_pass=1) or (tg_op='DELETE' and v_pass=2) then continue; end if;

    if v_pass=1 then
      v_staff:=old.staff_id;
      v_specific:=coalesce(old.shift_date,old.date);
      v_from:=old.effective_from;
      v_to:=old.effective_to;
      v_day:=old.day_name;
      v_dow:=case when coalesce(old.day_of_week,'')~'^\d+$' then old.day_of_week::int else case trim(coalesce(old.day_name,'')) when 'الأحد' then 0 when 'الاثنين' then 1 when 'الثلاثاء' then 2 when 'الأربعاء' then 3 when 'الخميس' then 4 when 'الجمعة' then 5 when 'السبت' then 6 else null end end;
    else
      v_staff:=new.staff_id;
      v_specific:=coalesce(new.shift_date,new.date);
      v_from:=new.effective_from;
      v_to:=new.effective_to;
      v_day:=new.day_name;
      v_dow:=case when coalesce(new.day_of_week,'')~'^\d+$' then new.day_of_week::int else case trim(coalesce(new.day_name,'')) when 'الأحد' then 0 when 'الاثنين' then 1 when 'الثلاثاء' then 2 when 'الأربعاء' then 3 when 'الخميس' then 4 when 'الجمعة' then 5 when 'السبت' then 6 else null end end;
    end if;

    if v_staff is null then continue; end if;
    if v_specific is not null then
      if v_specific between v_start and v_end then perform public.dawaa_mark_attendance_dirty_v1(v_staff,v_specific,v_reason); end if;
      continue;
    end if;

    if v_dow is null then continue; end if;
    v_from:=greatest(coalesce(v_from,v_start),v_start);
    v_to:=least(coalesce(v_to,v_end),v_end);
    if v_to<v_from then continue; end if;

    for v_d in select generate_series(v_from::timestamp,v_to::timestamp,interval '1 day')::date loop
      if extract(dow from v_d)::int=v_dow then
        perform public.dawaa_mark_attendance_dirty_v1(v_staff,v_d,v_reason);
      end if;
    end loop;
  end loop;

  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.dawaa_mark_attendance_dirty_from_schedule_v1() from public,anon,authenticated;
grant execute on function public.dawaa_mark_attendance_dirty_from_schedule_v1() to service_role;

drop trigger if exists trg_dawaa_mark_attendance_dirty_schedule_v1 on public.shift_schedules;
create trigger trg_dawaa_mark_attendance_dirty_schedule_v1
after insert or delete or update of staff_id,shift_date,date,day_of_week,day_name,shift_start,shift_end,start_time,end_time,is_off,is_day_off,status,effective_from,effective_to,has_custom_time
on public.shift_schedules
for each row execute function public.dawaa_mark_attendance_dirty_from_schedule_v1();

create or replace function public.dawaa_mark_attendance_dirty_from_timeoff_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff uuid;
  v_from date;
  v_to date;
  v_d date;
  v_reason text;
  v_pass int;
begin
  v_reason:=case tg_op when 'INSERT' then 'timeoff_insert' when 'UPDATE' then 'timeoff_update' else 'timeoff_delete' end;
  for v_pass in 1..2 loop
    if (tg_op='INSERT' and v_pass=1) or (tg_op='DELETE' and v_pass=2) then continue; end if;
    if v_pass=1 then
      v_staff:=old.staff_id; v_from:=old.start_date; v_to:=old.end_date;
    else
      v_staff:=new.staff_id; v_from:=new.start_date; v_to:=new.end_date;
    end if;
    if v_staff is null or v_from is null or v_to is null then continue; end if;
    v_to:=least(v_to,v_from+44);
    if v_to<v_from then continue; end if;
    for v_d in select generate_series(v_from::timestamp,v_to::timestamp,interval '1 day')::date loop
      perform public.dawaa_mark_attendance_dirty_v1(v_staff,v_d,v_reason);
    end loop;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

revoke all on function public.dawaa_mark_attendance_dirty_from_timeoff_v1() from public,anon,authenticated;
grant execute on function public.dawaa_mark_attendance_dirty_from_timeoff_v1() to service_role;

drop trigger if exists trg_dawaa_mark_attendance_dirty_timeoff_v1 on public.staff_time_off_requests;
create trigger trg_dawaa_mark_attendance_dirty_timeoff_v1
after insert or delete or update of staff_id,status,start_date,end_date,start_time,end_time,duration_minutes,request_kind,decided_at,cancelled_at
on public.staff_time_off_requests
for each row execute function public.dawaa_mark_attendance_dirty_from_timeoff_v1();