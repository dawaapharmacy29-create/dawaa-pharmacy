create schema test;
create function test.assert(p_value boolean, p_message text) returns void
language plpgsql
as $$
begin
  if p_value is not true then raise exception 'assertion failed: %', p_message; end if;
end
$$;
grant usage on schema test to anon, authenticated;
grant execute on function test.assert(boolean, text) to anon, authenticated;
create function test.customer_branch(p_customer_id uuid) returns text
language sql stable security definer set search_path = public, pg_catalog
as $$
  select branch from public.customers where id = p_customer_id
$$;
create function test.incubation_customer_name(p_case_id uuid) returns text
language sql stable security definer set search_path = public, pg_catalog
as $$
  select customer_name from public.customer_incubation_cases where id = p_case_id
$$;
create function test.incubation_step_count() returns bigint
language sql stable security definer set search_path = public, pg_catalog
as $$
  select count(*) from public.customer_incubation_steps
$$;

create function public.dawaa_best_customer_branch(text) returns text language sql as $$ select null::text $$;
create function public.approve_customer_branch_repair_v14(text,text) returns boolean language sql as $$ select true $$;
create function public.ignore_customer_branch_repair_v14(text,text,text) returns boolean language sql as $$ select true $$;
create function public.update_customer_phone_v14_6(text,text,text) returns boolean language sql as $$ select true $$;
create function public.dawaa_run_customer_operations_autofix(text) returns integer language sql as $$ select 1 $$;
grant execute on function public.dawaa_best_customer_branch(text) to public;
grant execute on function public.approve_customer_branch_repair_v14(text,text) to public;
grant execute on function public.ignore_customer_branch_repair_v14(text,text,text) to public;
grant execute on function public.update_customer_phone_v14_6(text,text,text) to public;
grant execute on function public.dawaa_run_customer_operations_autofix(text) to public;

\ir ../migrations/20261009190000_harden_customer_repair_rpc_privileges_v1.sql
\ir ../migrations/20261009193000_harden_customer_review_and_incubation_scope_v1.sql

select test.assert(
  not has_function_privilege('anon', 'public.dawaa_run_customer_operations_autofix(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.dawaa_run_customer_operations_autofix(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.approve_customer_branch_repair_v14(text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.ignore_customer_branch_repair_v14(text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.update_customer_phone_v14_6(text,text,text)', 'execute')
  and not exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid in (
      'public.dawaa_run_customer_operations_autofix(text)'::regprocedure,
      'public.approve_customer_branch_repair_v14(text,text)'::regprocedure,
      'public.ignore_customer_branch_repair_v14(text,text,text)'::regprocedure,
      'public.update_customer_phone_v14_6(text,text,text)'::regprocedure
    )
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ),
  'bulk and direct repair functions are not executable by browser roles or inherited PUBLIC'
);
select test.assert(
  (select coalesce(proconfig, '{}'::text[]) @> array['search_path=pg_catalog, auth']
    from pg_proc
    where oid = 'public.review_customer_data_issue_v2(uuid,text,text,text)'::regprocedure),
  'data-review SECURITY DEFINER RPC has a trusted, restricted search_path'
);

set role anon;
select test.assert(
  not has_function_privilege(current_user, 'public.dawaa_run_customer_operations_autofix(text)', 'execute')
  and not has_function_privilege(current_user, 'public.approve_customer_branch_repair_v14(text,text)', 'execute')
  and not has_function_privilege(current_user, 'public.update_customer_phone_v14_6(text,text,text)', 'execute'),
  'anon cannot invoke bulk or direct customer repair'
);
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '', false);
do $$
begin
  begin
    perform public.review_customer_data_issue_v2(
      '30000000-0000-4000-8000-000000000001', 'approve', 'forged reviewer', null
    );
    raise exception 'unauthenticated review unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end
$$;
select test.assert(
  (select count(*) = 2 from public.customer_data_review_queue where status = 'pending')
  and test.customer_branch('20000000-0000-4000-8000-000000000001') = 'فرع شكري'
  and (select count(*) = 0 from public.customer_data_change_log),
  'unauthenticated review rejection has no partial writes'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
do $$
begin
  begin
    perform public.review_customer_data_issue_v2(
      '30000000-0000-4000-8000-000000000001', 'approve', 'forged reviewer', null
    );
    raise exception 'ordinary authenticated review unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end
$$;
select test.assert(
  (select count(*) = 2 from public.customer_data_review_queue where status = 'pending')
  and test.customer_branch('20000000-0000-4000-8000-000000000001') = 'فرع شكري'
  and (select count(*) = 0 from public.customer_data_change_log),
  'ordinary authenticated review rejection has no partial writes'
);
select test.assert(
  (select count(*) = 0 from public.customer_incubation_cases)
  and (select count(*) = 0 from public.customer_incubation_steps),
  'ordinary authenticated users without incubation permission see no cases or steps'
);
do $$
begin
  begin
    insert into public.customer_incubation_cases(id, branch, customer_name)
    values ('40000000-0000-4000-8000-000000000003', 'فرع شكري', 'Unauthorized');
    raise exception 'unauthorized case insert unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
  begin
    insert into public.customer_incubation_steps(id, case_id, step_note)
    values ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000001', 'Unauthorized');
    raise exception 'unauthorized step insert unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end
$$;
update public.customer_incubation_cases
set customer_name = 'Unauthorized update'
where id = '40000000-0000-4000-8000-000000000001';
select test.assert(
  test.incubation_customer_name('40000000-0000-4000-8000-000000000001') = 'Customer A'
  and test.incubation_step_count() = 2,
  'ordinary authenticated users cannot insert or update in-scope incubation data without permission'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', false);
do $$
begin
  begin
    perform public.review_customer_data_issue_v2(
      '30000000-0000-4000-8000-000000000001', 'approve', 'forged reviewer', null
    );
    raise exception 'wrong-branch review unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end
$$;
select test.assert(
  (select count(*) = 2 from public.customer_data_review_queue where status = 'pending')
  and test.customer_branch('20000000-0000-4000-8000-000000000001') = 'فرع شكري'
  and (select count(*) = 0 from public.customer_data_change_log),
  'wrong-branch review rejection has no partial writes'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', false);
select test.assert(
  (public.review_customer_data_issue_v2(
    '30000000-0000-4000-8000-000000000001', 'approve', 'forged reviewer', 'approved'
  ) ->> 'ok')::boolean,
  'authorized reviewer can approve an in-scope branch correction'
);
select test.assert(
  (select status = 'resolved' and reviewed_by = 'Reviewer A'
    from public.customer_data_review_queue where id = '30000000-0000-4000-8000-000000000001')
  and test.customer_branch('20000000-0000-4000-8000-000000000001') = 'فرع الشامي'
  and (select changed_by = 'Reviewer A' from public.customer_data_change_log),
  'reviewer identity is server-derived and approval writes audit and customer data: '
    || (select jsonb_build_object(
      'review', (select jsonb_build_object('status', status, 'reviewed_by', reviewed_by)
        from public.customer_data_review_queue where id = '30000000-0000-4000-8000-000000000001'),
      'branch', test.customer_branch('20000000-0000-4000-8000-000000000001'),
      'audit', (select jsonb_agg(changed_by) from public.customer_data_change_log)
    ))::text
);

select test.assert(
  (select count(*) = 1 from public.customer_incubation_cases)
  and (select count(*) = 1 from public.customer_incubation_steps)
  and (select count(*) = 0 from public.dawaa_incubation_candidates_v1),
  'incubation case and step reads are branch-scoped and candidates view honors customer RLS after correction: '
    || (select jsonb_build_object(
      'scope', public.dawaa_current_customer_core_scope_v2(array['view_customer_incubation']),
      'cases', (select count(*) from public.customer_incubation_cases),
      'steps', (select count(*) from public.customer_incubation_steps),
      'candidates', (select count(*) from public.dawaa_incubation_candidates_v1)
    ))::text
);
do $$
begin
  begin
    insert into public.customer_incubation_cases(id, branch, customer_name)
    values ('40000000-0000-4000-8000-000000000003', 'فرع الشامي', 'Out of scope');
    raise exception 'out-of-scope case insert unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end
$$;
do $$
begin
  begin
    insert into public.customer_incubation_steps(id, case_id, step_note)
    values ('50000000-0000-4000-8000-000000000003', '40000000-0000-4000-8000-000000000002', 'Out of scope');
    raise exception 'out-of-scope step insert unexpectedly succeeded';
  exception when sqlstate '42501' then null;
  end;
end
$$;
update public.customer_incubation_cases
set customer_name = 'Unauthorized update'
where id = '40000000-0000-4000-8000-000000000002';
select test.assert(
  test.incubation_customer_name('40000000-0000-4000-8000-000000000002') = 'Customer B'
  and (select count(*) = 1 from public.customer_incubation_steps),
  'out-of-scope case update is filtered and out-of-scope step remains invisible'
);

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', false);
insert into public.customer_incubation_cases(id, branch, customer_name)
values ('40000000-0000-4000-8000-000000000004', 'فرع الشامي', 'Admin-created');
select test.assert(
  (select count(*) = 3 from public.customer_incubation_cases),
  'authorized general manager can operate across branches'
);
reset role;
