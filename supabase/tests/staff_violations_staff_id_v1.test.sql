-- Violations list the staff row id of the employee (the id the monthly evaluation scores).
do $$
declare
  v_staff text;
  v_n integer;
begin
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  perform public.record_staff_violation_v1('00000000-0000-4000-8000-000000000003', 'uniform', 'من غير البالطو');
  select staff_id into v_staff from public.list_staff_violations_v1(current_date - 30, current_date)
   where staff_account_id = '00000000-0000-4000-8000-000000000003';
  if v_staff is distinct from 'staff-row-003' then raise exception 'staff_id_missing: %', v_staff; end if;

  -- Scope is unchanged: the other branch's assistant sees nothing.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000004', true);
  select count(*) into v_n from public.list_staff_violations_v1(current_date - 30, current_date);
  if v_n <> 0 then raise exception 'scope_changed: %', v_n; end if;
end;
$$;
