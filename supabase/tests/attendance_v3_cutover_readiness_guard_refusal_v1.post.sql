-- After the refused 20261016090100: the existing function was left exactly as it was.
do $$
begin
  if position('''ready_for_v3_cutover'',true' in pg_get_functiondef('public.attendance_policy_v3_cutover_readiness_v1(date,date)'::regprocedure)) = 0 then
    raise exception 'refused migration still replaced attendance_policy_v3_cutover_readiness_v1';
  end if;
end;
$$;
