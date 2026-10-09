create or replace function public.dawaa_mark_attendance_dirty_from_log_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_old_staff uuid;
  v_old_date date;
  v_new_staff uuid;
  v_new_date date;
  v_reason text;
begin
  v_reason := case tg_op
    when 'INSERT' then 'attendance_log_insert'
    when 'UPDATE' then 'attendance_log_update'
    when 'DELETE' then 'attendance_log_delete'
    else 'attendance_log_changed'
  end;

  if tg_op in ('UPDATE','DELETE') then
    v_old_staff := old.staff_id;
    v_old_date := old.shift_date;

    if v_old_staff is not null and v_old_date is not null
       and exists (
         select 1
         from public.staff s
         where s.id=v_old_staff
           and coalesce(s.active,false)=true
           and s.branch in ('فرع الشامي','فرع شكري')
       ) then
      insert into public.attendance_materialization_dirty_queue_v1(
        staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,
        attempts,processed_at,last_action,last_error
      ) values (
        v_old_staff,v_old_date,v_reason,now(),now(),now(),0,null,null,null
      )
      on conflict (staff_id,attendance_date) do update set
        dirty_reason=excluded.dirty_reason,
        last_seen_at=now(),
        next_attempt_at=now(),
        attempts=0,
        processed_at=null,
        last_action=null,
        last_error=null;
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    v_new_staff := new.staff_id;
    v_new_date := new.shift_date;

    if v_new_staff is not null and v_new_date is not null
       and (tg_op='INSERT' or v_new_staff is distinct from v_old_staff or v_new_date is distinct from v_old_date
            or new.recorded_at is distinct from old.recorded_at
            or new.attendance_type is distinct from old.attendance_type
            or new.status is distinct from old.status
            or new.rejection_reason is distinct from old.rejection_reason)
       and exists (
         select 1
         from public.staff s
         where s.id=v_new_staff
           and coalesce(s.active,false)=true
           and s.branch in ('فرع الشامي','فرع شكري')
       ) then
      insert into public.attendance_materialization_dirty_queue_v1(
        staff_id,attendance_date,dirty_reason,first_seen_at,last_seen_at,next_attempt_at,
        attempts,processed_at,last_action,last_error
      ) values (
        v_new_staff,v_new_date,v_reason,now(),now(),now(),0,null,null,null
      )
      on conflict (staff_id,attendance_date) do update set
        dirty_reason=excluded.dirty_reason,
        last_seen_at=now(),
        next_attempt_at=now(),
        attempts=0,
        processed_at=null,
        last_action=null,
        last_error=null;
    end if;
  end if;

  if tg_op='DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

revoke all on function public.dawaa_mark_attendance_dirty_from_log_v1() from public, anon, authenticated;
grant execute on function public.dawaa_mark_attendance_dirty_from_log_v1() to service_role;

drop trigger if exists trg_dawaa_mark_attendance_dirty_v1 on public.staff_attendance_logs;
create trigger trg_dawaa_mark_attendance_dirty_v1
after insert or update or delete on public.staff_attendance_logs
for each row execute function public.dawaa_mark_attendance_dirty_from_log_v1();
