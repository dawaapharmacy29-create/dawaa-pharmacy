begin;

do $guard$
begin
  if to_regprocedure('public.dawaa_current_actor_can(text[])') is null then
    raise exception 'customer_review_permission_contract_missing';
  end if;
  if to_regprocedure('public.dawaa_current_customer_core_scope_v2(text[])') is null
     or to_regprocedure('public.dawaa_customer_request_branch_key(text)') is null then
    raise exception 'customer_core_branch_scope_contract_missing';
  end if;
  if to_regprocedure('public.review_customer_data_issue_v2(uuid,text,text,text)') is null then
    raise exception 'customer_data_review_rpc_missing';
  end if;
  if to_regclass('public.customer_incubation_cases') is null
     or to_regclass('public.customer_incubation_steps') is null then
    raise exception 'customer_incubation_tables_missing';
  end if;
  if to_regclass('public.dawaa_incubation_candidates_v1') is null then
    raise exception 'customer_incubation_candidates_view_missing';
  end if;
end;
$guard$;

-- Keep the existing RPC signature and UI contract, but enforce the canonical
-- edit_customer permission before the function reads or mutates review data.
do $review_auth$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.review_customer_data_issue_v2(uuid,text,text,text)'::regprocedure
  ) into v_definition;

  if position('customer_data_review_permission_denied' in lower(v_definition)) = 0 then
    v_definition := replace(
      v_definition,
      'declare',
      'declare v_actor_scope text;'
    );
    v_definition := replace(
      v_definition,
      'begin',
      E'\nbegin\n  if not public.dawaa_current_actor_can(array[''edit_customer'']) then\n    raise exception ''customer_data_review_permission_denied'' using errcode = ''42501'';\n  end if;\n  v_actor_scope := public.dawaa_current_customer_core_scope_v2(array[''edit_customer'']);\n  if v_actor_scope = ''NONE'' then\n    raise exception ''customer_data_review_permission_denied'' using errcode = ''42501'';\n  end if;\n  select coalesce(nullif(btrim(sa.staff_name), ''''), nullif(btrim(sa.name), ''''), sa.id::text)\n    into v_reviewer\n  from public.staff_accounts sa\n  where sa.id = public.dawaa_current_staff_account_id_strict()\n    and coalesce(sa.active, false) and coalesce(sa.can_login, false);\n  if v_reviewer is null then\n    raise exception ''customer_data_review_permission_denied'' using errcode = ''42501'';\n  end if;\n'
    );
    if position('customer_data_review_permission_denied' in lower(v_definition)) = 0 then
      raise exception 'could_not_install_customer_data_review_permission_guard';
    end if;
    execute v_definition;
  end if;

  select pg_get_functiondef(
    'public.review_customer_data_issue_v2(uuid,text,text,text)'::regprocedure
  ) into v_definition;
  if position('customer_data_review_branch_scope_denied' in lower(v_definition)) = 0 then
    v_definition := replace(
      v_definition,
      'if v_decision = ''reject'' then',
      E'\n  if v_review.customer_id is not null then\n    select * into v_customer\n    from public.customers\n    where id = v_review.customer_id\n    for update;\n    if not found then\n      raise exception ''Customer not found'';\n    end if;\n  elsif v_actor_scope <> ''ALL'' then\n    raise exception ''customer_data_review_branch_scope_denied'' using errcode = ''42501'';\n  end if;\n\n  if v_actor_scope <> ''ALL''\n     and public.dawaa_customer_request_branch_key(v_customer.branch)\n       is distinct from public.dawaa_customer_request_branch_key(v_actor_scope) then\n    raise exception ''customer_data_review_branch_scope_denied'' using errcode = ''42501'';\n  end if;\n\n  if v_decision = ''reject'' then'
    );
    if position('customer_data_review_branch_scope_denied' in lower(v_definition)) = 0 then
      raise exception 'could_not_install_customer_data_review_branch_guard';
    end if;
    execute v_definition;
  end if;
end;
$review_auth$;

alter function public.review_customer_data_issue_v2(uuid,text,text,text)
  set search_path to pg_catalog, auth;

revoke all on function public.review_customer_data_issue_v2(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.review_customer_data_issue_v2(uuid,text,text,text) to authenticated;

alter table public.customer_incubation_cases enable row level security;
alter table public.customer_incubation_steps enable row level security;

drop policy if exists customer_incubation_cases_branch_read_v1 on public.customer_incubation_cases;
create policy customer_incubation_cases_branch_read_v1
  on public.customer_incubation_cases
  for select to authenticated
  using (
    (select public.dawaa_current_customer_core_scope_v2(array['view_customer_incubation'])) = 'ALL'
    or (
      (select public.dawaa_current_customer_core_scope_v2(array['view_customer_incubation'])) <> 'NONE'
      and public.dawaa_customer_request_branch_key(branch)
        = public.dawaa_customer_request_branch_key(
          (select public.dawaa_current_customer_core_scope_v2(array['view_customer_incubation']))
        )
    )
  );

drop policy if exists customer_incubation_cases_branch_insert_v1 on public.customer_incubation_cases;
create policy customer_incubation_cases_branch_insert_v1
  on public.customer_incubation_cases
  for insert to authenticated
  with check (
    (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation'])) = 'ALL'
    or (
      (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation'])) <> 'NONE'
      and public.dawaa_customer_request_branch_key(branch)
        = public.dawaa_customer_request_branch_key(
          (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation']))
        )
    )
  );

drop policy if exists customer_incubation_cases_branch_update_v1 on public.customer_incubation_cases;
create policy customer_incubation_cases_branch_update_v1
  on public.customer_incubation_cases
  for update to authenticated
  using (
    (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation'])) = 'ALL'
    or (
      (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation'])) <> 'NONE'
      and public.dawaa_customer_request_branch_key(branch)
        = public.dawaa_customer_request_branch_key(
          (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation']))
        )
    )
  )
  with check (
    (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation'])) = 'ALL'
    or (
      (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation'])) <> 'NONE'
      and public.dawaa_customer_request_branch_key(branch)
        = public.dawaa_customer_request_branch_key(
          (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation']))
        )
    )
  );

drop policy if exists customer_incubation_steps_branch_read_v1 on public.customer_incubation_steps;
create policy customer_incubation_steps_branch_read_v1
  on public.customer_incubation_steps
  for select to authenticated
  using (
    exists (
      select 1
      from public.customer_incubation_cases c
      where c.id = customer_incubation_steps.case_id
        and (
          (select public.dawaa_current_customer_core_scope_v2(array['view_customer_incubation'])) = 'ALL'
          or (
            (select public.dawaa_current_customer_core_scope_v2(array['view_customer_incubation'])) <> 'NONE'
            and public.dawaa_customer_request_branch_key(c.branch)
              = public.dawaa_customer_request_branch_key(
                (select public.dawaa_current_customer_core_scope_v2(array['view_customer_incubation']))
              )
          )
        )
    )
  );

drop policy if exists customer_incubation_steps_branch_insert_v1 on public.customer_incubation_steps;
create policy customer_incubation_steps_branch_insert_v1
  on public.customer_incubation_steps
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.customer_incubation_cases c
      where c.id = customer_incubation_steps.case_id
        and (
          (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation'])) = 'ALL'
          or (
            (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation'])) <> 'NONE'
            and public.dawaa_customer_request_branch_key(c.branch)
              = public.dawaa_customer_request_branch_key(
                (select public.dawaa_current_customer_core_scope_v2(array['manage_customer_incubation']))
              )
          )
        )
    )
  );

revoke all on table public.customer_incubation_cases from public, anon, authenticated;
grant select, insert, update on table public.customer_incubation_cases to authenticated;
revoke all on table public.customer_incubation_steps from public, anon, authenticated;
grant select, insert on table public.customer_incubation_steps to authenticated;

-- The candidate list is an active UI read model and must execute with caller
-- privileges so the underlying customer-table policies remain in force.
alter view public.dawaa_incubation_candidates_v1 set (security_invoker = true);
revoke all on table public.dawaa_incubation_candidates_v1 from public, anon, authenticated;
grant select on table public.dawaa_incubation_candidates_v1 to authenticated;

do $assert$
declare
  v_definition text;
  v_policy_count integer;
  v_has_public_execute boolean;
  v_has_public_table_access boolean;
begin
  select pg_get_functiondef(
    'public.review_customer_data_issue_v2(uuid,text,text,text)'::regprocedure
  ) into v_definition;
  if position('customer_data_review_permission_denied' in lower(v_definition)) = 0
     or position('customer_data_review_permission_denied' in lower(v_definition))
        > position('select * into v_review' in lower(v_definition)) then
    raise exception 'customer_data_review_permission_guard_missing_or_late';
  end if;
  select exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.review_customer_data_issue_v2(uuid,text,text,text)'::regprocedure
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) into v_has_public_execute;
  if v_has_public_execute
     or has_function_privilege('anon', 'public.review_customer_data_issue_v2(uuid,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.review_customer_data_issue_v2(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'customer_data_review_rpc_execute_boundary_invalid';
  end if;
  if not exists (
    select 1
    from pg_proc p
    where p.oid = 'public.review_customer_data_issue_v2(uuid,text,text,text)'::regprocedure
      and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=pg_catalog, auth']
  ) then
    raise exception 'customer_data_review_rpc_search_path_invalid';
  end if;

  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.customer_incubation_cases'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.customer_incubation_steps'::regclass) then
    raise exception 'customer_incubation_rls_not_enabled';
  end if;
  select count(*) into v_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('customer_incubation_cases', 'customer_incubation_steps')
    and (
      coalesce(qual, '') like '%dawaa_current_customer_core_scope_v2%'
      or coalesce(with_check, '') like '%dawaa_current_customer_core_scope_v2%'
    );
  if v_policy_count < 5
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'customer_incubation_cases'
         and policyname = 'customer_incubation_cases_branch_read_v1'
         and coalesce(qual, '') like '%dawaa_current_customer_core_scope_v2%'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'customer_incubation_cases'
         and policyname = 'customer_incubation_cases_branch_insert_v1'
         and coalesce(with_check, '') like '%dawaa_current_customer_core_scope_v2%'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'customer_incubation_cases'
         and policyname = 'customer_incubation_cases_branch_update_v1'
         and coalesce(qual, '') like '%dawaa_current_customer_core_scope_v2%'
         and coalesce(with_check, '') like '%dawaa_current_customer_core_scope_v2%'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'customer_incubation_steps'
         and policyname = 'customer_incubation_steps_branch_read_v1'
         and coalesce(qual, '') like '%dawaa_current_customer_core_scope_v2%'
     )
     or not exists (
       select 1 from pg_policies
       where schemaname = 'public'
         and tablename = 'customer_incubation_steps'
         and policyname = 'customer_incubation_steps_branch_insert_v1'
         and coalesce(with_check, '') like '%dawaa_current_customer_core_scope_v2%'
     ) then
    raise exception 'customer_incubation_branch_policies_incomplete';
  end if;

  select exists (
    select 1
    from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    where c.oid in (
      'public.customer_incubation_cases'::regclass,
      'public.customer_incubation_steps'::regclass,
      'public.dawaa_incubation_candidates_v1'::regclass
    )
      and acl.grantee = 0
  ) into v_has_public_table_access;
  if v_has_public_table_access
     or has_table_privilege('anon', 'public.customer_incubation_cases', 'SELECT')
     or has_table_privilege('anon', 'public.customer_incubation_steps', 'SELECT')
     or has_table_privilege('anon', 'public.dawaa_incubation_candidates_v1', 'SELECT')
     or not has_table_privilege('authenticated', 'public.dawaa_incubation_candidates_v1', 'SELECT') then
    raise exception 'customer_incubation_table_or_view_grants_invalid';
  end if;
  if not has_table_privilege('authenticated', 'public.customer_incubation_cases', 'SELECT')
     or not has_table_privilege('authenticated', 'public.customer_incubation_cases', 'INSERT')
     or not has_table_privilege('authenticated', 'public.customer_incubation_cases', 'UPDATE')
     or not has_table_privilege('authenticated', 'public.customer_incubation_steps', 'SELECT')
     or not has_table_privilege('authenticated', 'public.customer_incubation_steps', 'INSERT')
     or has_table_privilege('authenticated', 'public.customer_incubation_cases', 'DELETE')
     or has_table_privilege('authenticated', 'public.customer_incubation_steps', 'UPDATE')
     or has_table_privilege('authenticated', 'public.customer_incubation_steps', 'DELETE') then
    raise exception 'customer_incubation_unneeded_mutation_privilege_granted';
  end if;
end;
$assert$;

commit;
