-- 20261015140200_anon_session_internal_authorized_reads_v1 + 20261015140300_reconcile_staff_points_manager_summary_v4.

-- Grants: the session role can execute the three reads; the internal points truth stays non-anon.
do $$
begin
  if not has_function_privilege('anon', 'public.get_doctor_pillar_breakdown(uuid,text)', 'execute')
     or not has_function_privilege('anon', 'public.hr_canonical_architecture_health_v1()', 'execute')
     or not has_function_privilege('anon', 'public.get_staff_points_manager_summary_v4(text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.get_staff_points_manager_summary_v4(text,text)', 'execute') then
    raise exception 'session read grants missing';
  end if;
  if has_function_privilege('anon', 'public.dawaa_staff_points_truth_v2(uuid,text)', 'execute') then
    raise exception 'internal points truth must remain non-anon';
  end if;
  if (select provolatile from pg_proc where oid = 'public.get_staff_points_manager_summary_v4(text,text)'::regprocedure) <> 's'
     or not (select prosecdef from pg_proc where oid = 'public.get_staff_points_manager_summary_v4(text,text)'::regprocedure) then
    raise exception 'v4 must be STABLE SECURITY DEFINER';
  end if;
end;
$$;

-- anon without a verified session extracts nothing from any of the three reads.
do $$
declare v_count integer;
begin
  perform set_config('test.account_id', '', true);
  set local role anon;
  begin
    perform * from public.get_doctor_pillar_breakdown('50000000-0000-4000-8000-000000000001', null);
    raise exception 'pillar breakdown returned data without a session';
  exception when raise_exception then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  begin
    perform public.hr_canonical_architecture_health_v1();
    raise exception 'hr health returned data without a session';
  exception when insufficient_privilege then null;
  end;
  begin
    select count(*) into v_count from public.get_staff_points_manager_summary_v4('2026-10', null);
    raise exception 'v4 returned % rows without a session', v_count;
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$$;

-- Role and branch scope are enforced inside v4 and the pillar read.
do $$
declare v_branches text[]; v_count integer;
begin
  -- branch manager: pinned to own branch; asking for another branch is refused.
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000002', true);
  set local role anon;
  select array_agg(distinct branch) into v_branches from public.get_staff_points_manager_summary_v4('2026-10', null);
  if v_branches is distinct from array['فرع شكري'] then raise exception 'branch manager scope leaked: %', v_branches; end if;
  begin
    perform * from public.get_staff_points_manager_summary_v4('2026-10', 'فرع الشامي');
    raise exception 'branch manager read another branch';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_doctor_pillar_breakdown('50000000-0000-4000-8000-000000000002', null);
    raise exception 'branch manager read another branch pillar breakdown';
  exception when raise_exception then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  begin
    perform public.hr_canonical_architecture_health_v1();
    raise exception 'branch manager without manage_hr read hr health';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- branch manager without a branch is refused.
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000004', true);
  set local role anon;
  begin
    perform * from public.get_staff_points_manager_summary_v4('2026-10', null);
    raise exception 'branch manager without branch was not refused';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- pharmacist: not a manager.
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000003', true);
  set local role anon;
  begin
    perform * from public.get_staff_points_manager_summary_v4('2026-10', null);
    raise exception 'pharmacist read the manager summary';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- general manager: all active staff, every branch; hr health allowed.
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000001', true);
  set local role anon;
  select count(*) into v_count from public.get_staff_points_manager_summary_v4('2026-10', null);
  if v_count <> 2 then raise exception 'general manager expected 2 active staff, got %', v_count; end if;
  if (public.hr_canonical_architecture_health_v1() ->> 'status') is null then raise exception 'hr health unavailable to manage_hr'; end if;
  if not exists (select 1 from public.get_doctor_pillar_breakdown('50000000-0000-4000-8000-000000000002', null) where points = 8) then
    raise exception 'pillar breakdown unavailable to an authorized actor';
  end if;
  reset role;
end;
$$;

-- Invalid session, wrong role and own-branch cases (calls are executed directly; no planner elision).
do $$
declare v_count integer;
begin
  -- INVALID_SESSION: an unknown session account id resolves no actor.
  perform set_config('test.account_id', 'c0000000-0000-4000-8000-0000000000aa', true);
  set local role anon;
  begin
    perform * from public.get_doctor_pillar_breakdown('50000000-0000-4000-8000-000000000001', null);
    raise exception using errcode = 'P0901', message = 'pillar breakdown allowed an invalid session';
  exception when raise_exception then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  begin
    perform public.hr_canonical_architecture_health_v1();
    raise exception using errcode = 'P0901', message = 'hr health allowed an invalid session';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.get_staff_points_manager_summary_v4('2026-10', null);
    raise exception using errcode = 'P0901', message = 'v4 allowed an invalid session';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- WRONG_ROLE: a pharmacist cannot read another doctor's pillar breakdown.
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000003', true);
  set local role anon;
  begin
    perform * from public.get_doctor_pillar_breakdown('50000000-0000-4000-8000-000000000001', null);
    raise exception using errcode = 'P0901', message = 'pharmacist read a pillar breakdown';
  exception when raise_exception then
    if sqlerrm <> 'not_authorized' then raise; end if;
  end;
  begin
    perform public.hr_canonical_architecture_health_v1();
    raise exception using errcode = 'P0901', message = 'pharmacist read hr health';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- VALID: a branch manager reads pillar breakdown and v4 rows of their own branch only.
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000002', true);
  set local role anon;
  select count(*) into v_count from public.get_doctor_pillar_breakdown('50000000-0000-4000-8000-000000000001', null);
  if v_count <> 1 then raise exception 'branch manager could not read own-branch pillar breakdown'; end if;
  select count(*) into v_count from public.get_staff_points_manager_summary_v4('2026-10', 'فرع شكري');
  if v_count <> 1 then raise exception 'branch manager expected 1 own-branch v4 row, got %', v_count; end if;
  select count(*) into v_count from public.get_staff_points_manager_summary_v4('2026-10', null) where branch <> 'فرع شكري';
  if v_count <> 0 then raise exception 'branch manager received % rows outside own branch', v_count; end if;
  reset role;
end;
$$;
