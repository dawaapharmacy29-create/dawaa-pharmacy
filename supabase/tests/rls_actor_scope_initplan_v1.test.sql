-- 20261015140000_rls_actor_scope_initplan_v1: identical row visibility for every actor, initplan plans.
do $$
declare
  v_actor text;
  v_actors text[] := array[
    '',
    'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003',
    'a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000006',
    'a0000000-0000-4000-8000-000000000007', 'a0000000-0000-4000-8000-000000000008', 'a0000000-0000-4000-8000-000000000009',
    'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000011', 'a0000000-0000-4000-8000-000000000012',
    'a0000000-0000-4000-8000-0000000000ff'
  ];
  v_new int[];
  v_old int[];
  v_nonempty integer := 0;
  v_table text;
begin
  foreach v_actor in array v_actors loop
    perform set_config('test.account_id', v_actor, true);
    foreach v_table in array array['employee_transactions','staff_attendance_logs','conversation_sales_reviews','activity_log'] loop
      execute format('set local role anon');
      execute format('select coalesce(array_agg(id order by id), ''{}'') from public.%I', v_table) into v_new;
      execute format('select public.test_oracle_%s()', v_table) into v_old;
      execute 'reset role';
      if v_new is distinct from v_old then
        raise exception 'RLS semantics changed for % / actor [%]: policy % vs previous helper %', v_table, v_actor, v_new, v_old;
      end if;
      if cardinality(v_new) > 0 then v_nonempty := v_nonempty + 1; end if;
    end loop;
  end loop;
  -- Guard against a vacuous pass: the matrix must exercise visible and hidden rows.
  if v_nonempty < 15 then
    raise exception 'scenario matrix too weak: only % non-empty actor/table results', v_nonempty;
  end if;
end;
$$;

-- Sanity anchors on the matrix itself.
do $$
declare v int[];
begin
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000001', true);
  set local role anon;
  select array_agg(id order by id) into v from public.employee_transactions;
  reset role;
  if v is distinct from array[1,2,3,4,5,6,7] then raise exception 'admin employee_transactions scope: %', v; end if;

  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000002', true);
  set local role anon;
  select array_agg(id order by id) into v from public.employee_transactions;
  reset role;
  if v is distinct from array[1,5] then raise exception 'pharmacist own scope: %', v; end if;

  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000004', true);
  set local role anon;
  select array_agg(id order by id) into v from public.employee_transactions;
  reset role;
  if v is distinct from array[1,2,4] then raise exception 'branch manager trimmed branch scope: %', v; end if;

  perform set_config('test.account_id', '', true);
  set local role anon;
  select array_agg(id order by id) into v from public.employee_transactions;
  reset role;
  if v is not null then raise exception 'anon without session read employee_transactions: %', v; end if;
end;
$$;

-- The actor scope is planned once per statement, and the per-row helpers are gone from the policies.
do $$
declare
  v_plan text := '';
  v_line text;
  v_table text;
begin
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000004', true);
  foreach v_table in array array['employee_transactions','staff_attendance_logs','conversation_sales_reviews','activity_log'] loop
    v_plan := '';
    set local role anon;
    for v_line in execute format('explain (costs off) select * from public.%I', v_table) loop
      v_plan := v_plan || v_line || E'\n';
    end loop;
    reset role;
    if v_plan !~ 'InitPlan' then
      raise exception '% policy is not planned as an InitPlan:%', v_table, E'\n' || v_plan;
    end if;
    if v_plan ~ 'dawaa_can_read_(employee_transaction|staff_attendance_log|conversation_review_row_v2)\(' then
      raise exception '% policy still calls a per-row helper:%', v_table, E'\n' || v_plan;
    end if;
  end loop;
end;
$$;

-- Scope functions: STABLE, SECURITY DEFINER, pinned search_path, executable by the session roles only.
do $$
declare v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.dawaa_employee_transaction_read_scope_v1()'::regprocedure,
    'public.dawaa_staff_attendance_log_read_scope_v1()'::regprocedure,
    'public.dawaa_conversation_review_read_scope_v1()'::regprocedure
  ] loop
    if (select provolatile from pg_proc where oid = v_fn) <> 's' then raise exception '% must be STABLE', v_fn; end if;
    if not (select prosecdef from pg_proc where oid = v_fn) then raise exception '% must be SECURITY DEFINER', v_fn; end if;
    if (select proconfig from pg_proc where oid = v_fn) is null then raise exception '% must pin search_path', v_fn; end if;
    if not has_function_privilege('anon', v_fn, 'execute') or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception '% must be executable by the session roles', v_fn;
    end if;
  end loop;
end;
$$;

-- Writes are untouched: no new INSERT/UPDATE/DELETE privilege for anon.
do $$
begin
  if has_table_privilege('anon', 'public.employee_transactions', 'insert')
     or has_table_privilege('anon', 'public.staff_attendance_logs', 'update')
     or has_table_privilege('anon', 'public.activity_log', 'delete') then
    raise exception 'RLS scope migration widened write privileges';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Extended actor/branch matrix: active branches_manager and general_manager, customer_service_manager,
-- evening supervisor with a padded branch, a role-less account, a non-uuid staff id, a branch manager
-- without a branch, an account with active = null, and cross-branch rows.
-- ---------------------------------------------------------------------------------------------------
insert into public.staff_accounts (id, staff_id, role, branch, active, can_login) values
  ('b0000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000021', 'branches_manager', null, true, true),
  ('b0000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-000000000022', ' General_Manager ', 'فرع الشامي', true, true),
  ('b0000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-000000000023', 'customer_service_manager', 'فرع الشامي', true, true),
  ('b0000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-000000000024', 'shift_supervisor_evening', 'فرع الشامي ', true, true),
  ('b0000000-0000-4000-8000-000000000005', '50000000-0000-4000-8000-000000000025', null, 'فرع شكري', true, true),
  ('b0000000-0000-4000-8000-000000000006', 'not-a-uuid', 'pharmacist', 'فرع شكري', true, true),
  ('b0000000-0000-4000-8000-000000000007', '50000000-0000-4000-8000-000000000027', 'branch_manager', null, true, true),
  ('b0000000-0000-4000-8000-000000000008', '50000000-0000-4000-8000-000000000028', 'branch_manager', 'فرع شكري', null, true),
  ('b0000000-0000-4000-8000-000000000009', '50000000-0000-4000-8000-000000000003', 'pharmacist', 'فرع الشامي', true, true);
insert into public.account_permissions (account_id, permissions)
select id, '{"view_points": true, "view_reviews": true, "view_activity_log": true}'::jsonb
from public.staff_accounts where id::text like 'b0000000%';
insert into public.employee_transactions (id, staff_id, branch) values
  (8, '50000000-0000-4000-8000-000000000003', 'فرع الشامي '), (9, '50000000-0000-4000-8000-000000000023', '');
insert into public.staff_attendance_logs (id, staff_id, branch_name) values
  (8, '50000000-0000-4000-8000-000000000024', ' فرع الشامي'), (9, 'b0000000-0000-4000-8000-000000000005', null);
insert into public.conversation_sales_reviews (id, is_current, staff_id, doctor_id, branch, reviewer_id) values
  (8, true, null, '50000000-0000-4000-8000-000000000003', null, null),
  (9, true, null, null, 'elshamy', 'b0000000-0000-4000-8000-000000000003');

-- Reusable assertions (session-local helpers): every account, no session and an unknown session id.
create function pg_temp.assert_rls_equivalence() returns integer language plpgsql as $$
declare v_actor text; v_new int[]; v_old int[]; v_table text; v_checked integer := 0;
begin
  for v_actor in
    select '' union all select 'c0000000-0000-4000-8000-0000000000aa' union all select id::text from public.staff_accounts
  loop
    perform set_config('test.account_id', v_actor, true);
    foreach v_table in array array['employee_transactions','staff_attendance_logs','conversation_sales_reviews','activity_log'] loop
      set local role anon;
      execute format('select coalesce(array_agg(id order by id), ''{}'') from public.%I', v_table) into v_new;
      reset role;
      execute format('select public.test_oracle_%s()', v_table) into v_old;
      if v_new is distinct from v_old then
        raise exception 'RLS semantics changed for % / actor [%]: policy % vs previous helper %', v_table, v_actor, v_new, v_old;
      end if;
      v_checked := v_checked + 1;
    end loop;
  end loop;
  return v_checked;
end;
$$;

create function pg_temp.assert_rls_initplans() returns void language plpgsql as $$
declare v_plan text; v_line text; v_table text;
begin
  perform set_config('test.account_id', 'a0000000-0000-4000-8000-000000000004', true);
  foreach v_table in array array['employee_transactions','staff_attendance_logs','conversation_sales_reviews','activity_log'] loop
    v_plan := '';
    set local role anon;
    for v_line in execute format('explain (costs off) select * from public.%I', v_table) loop
      v_plan := v_plan || v_line || E'\n';
    end loop;
    reset role;
    if v_plan !~ 'InitPlan' then
      raise exception '% policy is not planned as an InitPlan', v_table;
    end if;
    if v_plan ~ 'dawaa_can_read_(employee_transaction|staff_attendance_log|conversation_review_row_v2)\(' then
      raise exception '% policy still calls a per-row helper', v_table;
    end if;
  end loop;
end;
$$;

do $$
declare v_checked integer;
begin
  v_checked := pg_temp.assert_rls_equivalence();
  if v_checked <> 23 * 4 then
    raise exception 'extended matrix expected 92 actor/table comparisons, ran %', v_checked;
  end if;
  perform pg_temp.assert_rls_initplans();
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- Mutation tests: each mutation runs in a subtransaction that is rolled back; the assertions above must
-- detect it. A mutation that is not detected fails the suite.
-- ---------------------------------------------------------------------------------------------------
do $$
begin
  -- M1-a: looser visibility (branch scope compared by canonical branch key instead of the trimmed branch).
  begin
    alter policy employee_transactions_select_scoped_actor on public.employee_transactions
    using (
      (select s.read_mode from public.dawaa_employee_transaction_read_scope_v1() s) = 'all'
      or ((select s.read_mode from public.dawaa_employee_transaction_read_scope_v1() s) = 'branch'
          and public.dawaa_customer_request_branch_key(branch)
            = public.dawaa_customer_request_branch_key((select s.own_branch from public.dawaa_employee_transaction_read_scope_v1() s)))
    );
    perform pg_temp.assert_rls_equivalence();
    raise exception using errcode = 'P0901', message = 'mutation M1-a (looser visibility) was not detected';
  exception
    when sqlstate 'P0901' then raise;
    when others then
      if sqlerrm !~ '^RLS semantics changed for employee_transactions' then raise; end if;
  end;

  -- M1-b: stricter visibility (own-subject and branch rows dropped on attendance logs).
  begin
    alter policy staff_attendance_logs_select_scoped on public.staff_attendance_logs
    using ((select s.read_mode from public.dawaa_staff_attendance_log_read_scope_v1() s) = 'all');
    perform pg_temp.assert_rls_equivalence();
    raise exception using errcode = 'P0901', message = 'mutation M1-b (stricter visibility) was not detected';
  exception
    when sqlstate 'P0901' then raise;
    when others then
      if sqlerrm !~ '^RLS semantics changed for staff_attendance_logs' then raise; end if;
  end;

  -- M1-c: InitPlan optimization removed (policy reverted to the per-row helper; semantics identical).
  begin
    alter policy staff_attendance_logs_select_scoped on public.staff_attendance_logs
    using (public.dawaa_can_read_staff_attendance_log(staff_id, branch_name));
    perform pg_temp.assert_rls_equivalence();
    perform pg_temp.assert_rls_initplans();
    raise exception using errcode = 'P0901', message = 'mutation M1-c (InitPlan removed) was not detected';
  exception
    when sqlstate 'P0901' then raise;
    when others then
      if sqlerrm !~ '^staff_attendance_logs policy (is not planned as an InitPlan|still calls a per-row helper)' then raise; end if;
  end;

  -- M1-d: InitPlan removed on activity_log (actor check no longer wrapped in a scalar sub-select).
  begin
    alter policy activity_log_select_authorized on public.activity_log
    using (public.dawaa_current_actor_can(array['view_activity_log','view_activity_logs']));
    perform pg_temp.assert_rls_initplans();
    raise exception using errcode = 'P0901', message = 'mutation M1-d (activity_log InitPlan removed) was not detected';
  exception
    when sqlstate 'P0901' then raise;
    when others then
      if sqlerrm !~ '^activity_log policy is not planned as an InitPlan' then raise; end if;
  end;
end;
$$;

-- The rolled-back mutations left the migrated policies intact.
do $$
begin
  perform pg_temp.assert_rls_equivalence();
  perform pg_temp.assert_rls_initplans();
end;
$$;
