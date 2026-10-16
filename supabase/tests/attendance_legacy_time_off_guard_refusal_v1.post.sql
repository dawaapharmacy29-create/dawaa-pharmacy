-- After a refused run of 20261016140000 nothing was revoked: every legacy time-off API keeps its client grants.
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.attendance_request_time_off_v1(text,date,date,time without time zone,time without time zone,text)',
    'public.attendance_branch_review_time_off_v1(uuid,text,text)',
    'public.attendance_gm_review_time_off_v1(uuid,text,text)',
    'public.attendance_branch_time_off_queue_v1()',
    'public.attendance_gm_time_off_queue_v1()',
    'public.attendance_my_time_off_requests_v1()',
    'public.attendance_cancel_time_off_request_v1(uuid)'] loop
    if not has_function_privilege('anon', v_fn, 'execute') or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'refused migration still revoked %', v_fn;
    end if;
  end loop;
end;
$$;
