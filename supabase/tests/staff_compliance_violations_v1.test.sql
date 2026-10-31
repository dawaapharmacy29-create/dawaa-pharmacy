-- Violations: branch scope, points, notes, withdraw, and who reads what.
do $$
declare
  v jsonb;
  v_id uuid;
  v_n integer;
begin
  -- An assistant cannot record; the Shokry manager cannot record for Al-Shami.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000003', true);
  begin
    perform public.record_staff_violation_v1('00000000-0000-4000-8000-000000000005', 'uniform', 'من غير زي');
    raise exception 'assistant_recorded';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.record_staff_violation_v1('00000000-0000-4000-8000-000000000004', 'uniform', 'من غير زي');
    raise exception 'other_branch_recorded';
  exception when insufficient_privilege then null;
  end;

  -- The staff picker lists the own branch only, without the manager.
  select count(*) into v_n from public.list_branch_staff_for_violations_v1(null);
  if v_n <> 2 then raise exception 'picker_wrong: %', v_n; end if;

  -- Notes, categories and days are checked; PConnect weighs 2 points.
  begin
    perform public.record_staff_violation_v1('00000000-0000-4000-8000-000000000003', 'uniform', '  ');
    raise exception 'no_note_recorded';
  exception when raise_exception then if sqlerrm <> 'note_required' then raise; end if;
  end;
  begin
    perform public.record_staff_violation_v1('00000000-0000-4000-8000-000000000003', 'late', 'x');
    raise exception 'bad_category_recorded';
  exception when raise_exception then if sqlerrm <> 'invalid_category' then raise; end if;
  end;
  begin
    perform public.record_staff_violation_v1('00000000-0000-4000-8000-000000000003', 'uniform', 'x', current_date + 2);
    raise exception 'future_day_recorded';
  exception when raise_exception then if sqlerrm <> 'invalid_day' then raise; end if;
  end;
  v := public.record_staff_violation_v1('00000000-0000-4000-8000-000000000003', 'pconnect', 'باع من حساب زميله');
  if (v->>'points')::int <> 2 then raise exception 'points_wrong: %', v; end if;
  v_id := (v->>'id')::uuid;
  perform public.record_staff_violation_v1('00000000-0000-4000-8000-000000000003', 'uniform', 'من غير البالطو');

  -- The employee sees only their own; the other branch's assistant sees nothing.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000003', true);
  select count(*) into v_n from public.list_staff_violations_v1(current_date - 30, current_date);
  if v_n <> 2 then raise exception 'own_not_visible: %', v_n; end if;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000004', true);
  select count(*) into v_n from public.list_staff_violations_v1(current_date - 30, current_date);
  if v_n <> 0 then raise exception 'other_visible: %', v_n; end if;
  begin
    perform public.withdraw_staff_violation_v1(v_id, 'غلط');
    raise exception 'assistant_withdrew';
  exception when insufficient_privilege then null;
  end;

  -- The recorder withdraws with a reason; the row stays, marked withdrawn.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.withdraw_staff_violation_v1(v_id, '');
    raise exception 'withdraw_without_reason';
  exception when raise_exception then if sqlerrm <> 'reason_required' then raise; end if;
  end;
  perform public.withdraw_staff_violation_v1(v_id, 'اتضح إنه حسابه');
  select count(*) into v_n from public.list_staff_violations_v1(current_date - 30, current_date) where not withdrawn;
  if v_n <> 1 then raise exception 'withdraw_wrong: %', v_n; end if;

  -- Top management reads every branch.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  select count(*) into v_n from public.list_staff_violations_v1(current_date - 30, current_date);
  if v_n <> 2 then raise exception 'top_management_wrong: %', v_n; end if;
end;
$$;

set role anon;
do $$
begin
  perform count(*) from public.staff_compliance_violations;
  raise exception 'table_readable';
exception when insufficient_privilege then null;
end;
$$;
reset role;
