create or replace function public.dawaa_process_attendance_dirty_queue_v1(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_q public.attendance_materialization_dirty_queue_v1%rowtype;
  v_result jsonb;
  v_action text;
  v_processed integer:=0;
  v_waiting integer:=0;
  v_errors integer:=0;
  v_immutable integer:=0;
begin
  for v_q in
    select q.*
    from public.attendance_materialization_dirty_queue_v1 q
    where q.processed_at is null and q.next_attempt_at<=now()
    order by case when q.attempts=0 then 0 else 1 end,q.next_attempt_at,q.last_seen_at,q.attendance_date
    limit greatest(1,least(coalesce(p_limit,50),200))
    for update skip locked
  loop
    begin
      if public.dawaa_staff_flexible_attendance_v1(v_q.staff_id) then
        v_result:=public.dawaa_reconcile_flexible_attendance_dirty_day_v1(v_q.staff_id,v_q.attendance_date);
      else
        v_result:=public.dawaa_reconcile_attendance_dirty_day_v1(v_q.staff_id,v_q.attendance_date);
      end if;
      v_action:=coalesce(v_result->>'action','unknown');

      if v_action='waiting_not_finalizable' then
        update public.attendance_materialization_dirty_queue_v1
        set attempts=attempts+1,
            next_attempt_at=now()+interval '30 minutes',
            last_action=v_action,
            last_error=null
        where staff_id=v_q.staff_id and attendance_date=v_q.attendance_date;
        v_waiting:=v_waiting+1;
      else
        update public.attendance_materialization_dirty_queue_v1
        set attempts=attempts+1,
            processed_at=now(),
            next_attempt_at=now(),
            last_action=v_action,
            last_error=null
        where staff_id=v_q.staff_id and attendance_date=v_q.attendance_date;
        v_processed:=v_processed+1;
        if v_action in ('immutable_approved','cycle_locked') then v_immutable:=v_immutable+1; end if;
      end if;
    exception when others then
      update public.attendance_materialization_dirty_queue_v1
      set attempts=attempts+1,
          next_attempt_at=now()+interval '15 minutes',
          last_action='error',
          last_error=left(sqlstate||' '||sqlerrm,1000)
      where staff_id=v_q.staff_id and attendance_date=v_q.attendance_date;
      v_errors:=v_errors+1;
    end;
  end loop;

  return jsonb_build_object(
    'processed',v_processed,
    'waiting',v_waiting,
    'errors',v_errors,
    'immutable_or_locked',v_immutable,
    'limit',p_limit
  );
end;
$function$;

revoke all on function public.dawaa_process_attendance_dirty_queue_v1(integer) from public,anon,authenticated;
grant execute on function public.dawaa_process_attendance_dirty_queue_v1(integer) to service_role;