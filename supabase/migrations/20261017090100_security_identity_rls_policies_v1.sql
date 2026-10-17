-- SECURITY: remove the unauthenticated x-dawaa-user-id header from every reviewed RLS policy.
--
-- The 15 reviewed Production policies compare staff_accounts.id with
--   COALESCE(request.headers ->> 'x-dawaa-user-id', auth.uid()::text)
-- i.e. a client-chosen identity. This migration replaces exactly that term with the verified caller
--   COALESCE((SELECT dawaa_current_staff_account_id_strict())::text, (SELECT auth.uid())::text)
-- and changes nothing else in the policy metadata or expressions.
--
-- Safety properties:
--   * exact pre/post catalog hashes for every reviewed policy (command, permissive mode, roles,
--     table RLS/FORCE flags, USING and WITH CHECK);
--   * all 15 policies must be wholly PRE or wholly POST -- a partial earlier run aborts;
--   * any additional policy anywhere that reads x-dawaa-user-id/raw request.headers aborts;
--   * ALTER POLICY is used, never DROP/CREATE;
--   * no business-row DML; fail closed on drift; idempotent on the exact reviewed post-state.
--
-- Policies that reach identity only through dawaa_current_staff_id_v1 / dawaa_current_notification_*
-- / dawaa_has_active_app_session are fixed by 20261017090000 and are not touched here.

do $migration$
declare
  c_fragment constant text :=
    'COALESCE(((( SELECT current_setting(''request.headers''::text, true) AS current_setting))::jsonb ->> ''x-dawaa-user-id''::text), (( SELECT auth.uid() AS uid))::text)';
  c_replacement constant text :=
    'COALESCE((( SELECT dawaa_current_staff_account_id_strict() AS dawaa_current_staff_account_id_strict))::text, (( SELECT auth.uid() AS uid))::text)';
  r record;
  v_actual_md5 text;
  v_qual text;
  v_check text;
  v_new_qual text;
  v_new_check text;
  v_sql text;
  v_pre_count integer := 0;
  v_post_count integer := 0;
  v_unexpected text;
begin
  -- No policy outside the reviewed 15 may read raw request headers. This catches inventory drift first.
  with expected(table_name, policy_name) as (values
    ('employee_compensation_profiles','employee_compensation_admin_delete_v2'),
    ('employee_compensation_profiles','employee_compensation_admin_insert_v2'),
    ('employee_compensation_profiles','employee_compensation_admin_update_v2'),
    ('employee_compensation_profiles','employee_compensation_read_v2'),
    ('employee_events','employee_events_insert_v1'),
    ('employee_events','employee_events_self_read_v1'),
    ('employee_monthly_statements','employee_statements_admin_delete_v2'),
    ('employee_monthly_statements','employee_statements_admin_insert_v2'),
    ('employee_monthly_statements','employee_statements_admin_update_v2'),
    ('employee_monthly_statements','employee_statements_read_v2'),
    ('manager_daily_checklist','manager_daily_checklist_self_v1'),
    ('manager_weekly_evaluations','manager_weekly_evaluations_admin_delete_v2'),
    ('manager_weekly_evaluations','manager_weekly_evaluations_admin_insert_v2'),
    ('manager_weekly_evaluations','manager_weekly_evaluations_admin_update_v2'),
    ('manager_weekly_evaluations','manager_weekly_evaluations_read_v2')
  )
  select string_agg(n.nspname || '.' || c.relname || '.' || po.polname, ', ' order by 1)
    into v_unexpected
  from pg_policy po
  join pg_class c on c.oid = po.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where coalesce(pg_get_expr(po.polqual, po.polrelid), '') || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '')
        ~ '(x-dawaa-user-id|request\.headers)'
    and not exists (
      select 1 from expected e
      where n.nspname = 'public' and e.table_name = c.relname and e.policy_name = po.polname
    );
  if v_unexpected is not null then
    raise exception 'identity rls v1: unreviewed policies read request headers: %', v_unexpected;
  end if;

  -- Every reviewed policy must match exactly either its captured Production PRE state or the exact POST state.
  -- Hash input = command | permissive | sorted roles | RLS enabled | FORCE RLS | USING | WITH CHECK.
  for r in
    select * from (values
      ('employee_compensation_profiles','employee_compensation_admin_delete_v2', 'cbbed9f5cdf0f428652b19342e1d4952','fdc1dfa15d182b0fe844e54841939e16'),
      ('employee_compensation_profiles','employee_compensation_admin_insert_v2', '65f671c7d5eefdf58245bd9cf0b40fd0','786214685399ea8574244f2edeb11fdf'),
      ('employee_compensation_profiles','employee_compensation_admin_update_v2', '0d93f569cc9e0e803a85b7756b0e2010','13f48e20c6c346e10066bb22146741e8'),
      ('employee_compensation_profiles','employee_compensation_read_v2', 'b3a9cce3e512254c765606919deae186','291d976705e8cde64de039b39eeb9d8d'),
      ('employee_events','employee_events_insert_v1', '69d0a31a80c245c0d1a0aae201bc00db','c8041591c52ab474887a7e0e81ab0c72'),
      ('employee_events','employee_events_self_read_v1', '47b0bc39e3a4cb4b77b986c7089f2e60','991e6c00102dd4071c8645900e5d165c'),
      ('employee_monthly_statements','employee_statements_admin_delete_v2', 'cbbed9f5cdf0f428652b19342e1d4952','fdc1dfa15d182b0fe844e54841939e16'),
      ('employee_monthly_statements','employee_statements_admin_insert_v2', '65f671c7d5eefdf58245bd9cf0b40fd0','786214685399ea8574244f2edeb11fdf'),
      ('employee_monthly_statements','employee_statements_admin_update_v2', '0d93f569cc9e0e803a85b7756b0e2010','13f48e20c6c346e10066bb22146741e8'),
      ('employee_monthly_statements','employee_statements_read_v2', 'b3a9cce3e512254c765606919deae186','291d976705e8cde64de039b39eeb9d8d'),
      ('manager_daily_checklist','manager_daily_checklist_self_v1', '634362739171f06c8712a76ff6aa30d0','e584716b643969a1c6f7053c00b24bb0'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_admin_delete_v2', 'd04c2e500f914f5841ea7a8498db06d0','297e9f4234787c872edaa82a3649f12d'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_admin_insert_v2', '9b2c1ff4a56ea1d5166fb8f12bb8d8f3','439997434a7f3c3b37dd5aa6781565a8'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_admin_update_v2', '98b992f8a5b592f22266787900384b86','4e3cb4f0612143406a875b27132ed925'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_read_v2', '831896fb3bfb322d1d0d517bc3f873b8','32c870c4b7e47e7370ea4d6f1bbbf977')
    ) as t(table_name, policy_name, pre_md5, post_md5)
  loop
    select pg_get_expr(po.polqual, po.polrelid),
           pg_get_expr(po.polwithcheck, po.polrelid),
           md5(concat_ws('|',
             po.polcmd,
             po.polpermissive::text,
             coalesce((select string_agg(rr.rolname, ',' order by rr.rolname)
                       from unnest(po.polroles) pr(role_oid)
                       join pg_roles rr on rr.oid = pr.role_oid), ''),
             c.relrowsecurity::text,
             c.relforcerowsecurity::text,
             coalesce(pg_get_expr(po.polqual, po.polrelid), '<NULL>'),
             coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '<NULL>')
           ))
      into v_qual, v_check, v_actual_md5
    from pg_policy po
    join pg_class c on c.oid = po.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = r.table_name and po.polname = r.policy_name;

    if not found then
      raise exception 'identity rls v1: reviewed policy %.% is missing', r.table_name, r.policy_name;
    end if;

    if v_actual_md5 = r.pre_md5 then
      v_pre_count := v_pre_count + 1;
    elsif v_actual_md5 = r.post_md5 then
      v_post_count := v_post_count + 1;
    else
      raise exception 'identity rls v1: %.% drifted from both reviewed PRE and POST metadata (md5 %)',
        r.table_name, r.policy_name, v_actual_md5;
    end if;
  end loop;

  if v_pre_count = 0 and v_post_count = 15 then
    raise notice 'identity rls v1: exact reviewed post-state already present';
    return;
  end if;
  if v_pre_count <> 15 or v_post_count <> 0 then
    raise exception 'identity rls v1: partial/mixed state detected (pre %, post %); re-review before applying',
      v_pre_count, v_post_count;
  end if;

  -- All 15 are exact PRE: apply only the reviewed fragment replacement.
  for r in
    select * from (values
      ('employee_compensation_profiles','employee_compensation_admin_delete_v2'),
      ('employee_compensation_profiles','employee_compensation_admin_insert_v2'),
      ('employee_compensation_profiles','employee_compensation_admin_update_v2'),
      ('employee_compensation_profiles','employee_compensation_read_v2'),
      ('employee_events','employee_events_insert_v1'),
      ('employee_events','employee_events_self_read_v1'),
      ('employee_monthly_statements','employee_statements_admin_delete_v2'),
      ('employee_monthly_statements','employee_statements_admin_insert_v2'),
      ('employee_monthly_statements','employee_statements_admin_update_v2'),
      ('employee_monthly_statements','employee_statements_read_v2'),
      ('manager_daily_checklist','manager_daily_checklist_self_v1'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_admin_delete_v2'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_admin_insert_v2'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_admin_update_v2'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_read_v2')
    ) as t(table_name, policy_name)
  loop
    select pg_get_expr(po.polqual, po.polrelid), pg_get_expr(po.polwithcheck, po.polrelid)
      into v_qual, v_check
    from pg_policy po
    join pg_class c on c.oid = po.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = r.table_name and po.polname = r.policy_name;

    v_new_qual := case when v_qual is null then null else replace(v_qual, c_fragment, c_replacement) end;
    v_new_check := case when v_check is null then null else replace(v_check, c_fragment, c_replacement) end;

    if (v_qual is not null and v_new_qual = v_qual) and (v_check is null or v_new_check = v_check) then
      raise exception 'identity rls v1: reviewed fragment not found in %.%', r.table_name, r.policy_name;
    end if;
    if (v_check is not null and v_new_check = v_check) and (v_qual is null or v_new_qual = v_qual) then
      raise exception 'identity rls v1: reviewed fragment not found in %.%', r.table_name, r.policy_name;
    end if;
    if coalesce(v_new_qual, '') ~ '(x-dawaa-user-id|request\.headers)'
       or coalesce(v_new_check, '') ~ '(x-dawaa-user-id|request\.headers)' then
      raise exception 'identity rls v1: %.% contains an unreviewed header reference', r.table_name, r.policy_name;
    end if;

    v_sql := format('alter policy %I on public.%I', r.policy_name, r.table_name);
    if v_qual is not null then
      v_sql := v_sql || format(' using (%s)', v_new_qual);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_new_check);
    end if;
    execute v_sql;
  end loop;

  -- Exact POST verification after parsing ALTER POLICY, including roles/permissive/RLS/FORCE metadata.
  for r in
    select * from (values
      ('employee_compensation_profiles','employee_compensation_admin_delete_v2','fdc1dfa15d182b0fe844e54841939e16'),
      ('employee_compensation_profiles','employee_compensation_admin_insert_v2','786214685399ea8574244f2edeb11fdf'),
      ('employee_compensation_profiles','employee_compensation_admin_update_v2','13f48e20c6c346e10066bb22146741e8'),
      ('employee_compensation_profiles','employee_compensation_read_v2','291d976705e8cde64de039b39eeb9d8d'),
      ('employee_events','employee_events_insert_v1','c8041591c52ab474887a7e0e81ab0c72'),
      ('employee_events','employee_events_self_read_v1','991e6c00102dd4071c8645900e5d165c'),
      ('employee_monthly_statements','employee_statements_admin_delete_v2','fdc1dfa15d182b0fe844e54841939e16'),
      ('employee_monthly_statements','employee_statements_admin_insert_v2','786214685399ea8574244f2edeb11fdf'),
      ('employee_monthly_statements','employee_statements_admin_update_v2','13f48e20c6c346e10066bb22146741e8'),
      ('employee_monthly_statements','employee_statements_read_v2','291d976705e8cde64de039b39eeb9d8d'),
      ('manager_daily_checklist','manager_daily_checklist_self_v1','e584716b643969a1c6f7053c00b24bb0'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_admin_delete_v2','297e9f4234787c872edaa82a3649f12d'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_admin_insert_v2','439997434a7f3c3b37dd5aa6781565a8'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_admin_update_v2','4e3cb4f0612143406a875b27132ed925'),
      ('manager_weekly_evaluations','manager_weekly_evaluations_read_v2','32c870c4b7e47e7370ea4d6f1bbbf977')
    ) as t(table_name, policy_name, post_md5)
  loop
    select md5(concat_ws('|',
             po.polcmd,
             po.polpermissive::text,
             coalesce((select string_agg(rr.rolname, ',' order by rr.rolname)
                       from unnest(po.polroles) pr(role_oid)
                       join pg_roles rr on rr.oid = pr.role_oid), ''),
             c.relrowsecurity::text,
             c.relforcerowsecurity::text,
             coalesce(pg_get_expr(po.polqual, po.polrelid), '<NULL>'),
             coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '<NULL>')
           ))
      into v_actual_md5
    from pg_policy po
    join pg_class c on c.oid = po.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = r.table_name and po.polname = r.policy_name;

    if v_actual_md5 is distinct from r.post_md5 then
      raise exception 'identity rls v1: post-state drift for %.% (md5 %, expected %)',
        r.table_name, r.policy_name, v_actual_md5, r.post_md5;
    end if;
  end loop;

  select string_agg(po.polrelid::regclass::text || '.' || po.polname, ', ' order by 1)
    into v_unexpected
  from pg_policy po
  where coalesce(pg_get_expr(po.polqual, po.polrelid), '') || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '')
        ~ '(x-dawaa-user-id|request\.headers)';
  if v_unexpected is not null then
    raise exception 'identity rls v1: policies still read request headers after apply: %', v_unexpected;
  end if;
end
$migration$;
