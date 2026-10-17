-- SECURITY: remove the unauthenticated x-dawaa-user-id header from every RLS policy.
--
-- 15 Production policies compare staff_accounts.id with
--   COALESCE(request.headers ->> 'x-dawaa-user-id', auth.uid()::text)
-- i.e. a client-chosen identity. This migration replaces exactly that term with the verified caller
--   COALESCE((SELECT dawaa_current_staff_account_id_strict())::text, (SELECT auth.uid())::text)
-- and changes nothing else in the expressions (same role lists, same own-row predicates, same commands,
-- same roles, same permissive mode). ALTER POLICY is used, never DROP/CREATE, so a policy is never
-- missing during the migration and no additional permissive policy can remain alongside it.
--
-- Policies that reach the header only through dawaa_current_staff_id_v1 / dawaa_current_notification_*
-- / dawaa_has_active_app_session are fixed by 20261017090000 and are not touched here.
--
-- Forward-only, no business-row DML, fail closed on drift, idempotent (re-run finds nothing to change).

do $migration$
declare
  c_fragment constant text :=
    'COALESCE(((( SELECT current_setting(''request.headers''::text, true) AS current_setting))::jsonb ->> ''x-dawaa-user-id''::text), (( SELECT auth.uid() AS uid))::text)';
  c_replacement constant text :=
    'COALESCE((( SELECT dawaa_current_staff_account_id_strict() AS dawaa_current_staff_account_id_strict))::text, (( SELECT auth.uid() AS uid))::text)';
  c_expected constant text[] := array[
    'employee_compensation_profiles.employee_compensation_admin_delete_v2',
    'employee_compensation_profiles.employee_compensation_admin_insert_v2',
    'employee_compensation_profiles.employee_compensation_admin_update_v2',
    'employee_compensation_profiles.employee_compensation_read_v2',
    'employee_events.employee_events_insert_v1',
    'employee_events.employee_events_self_read_v1',
    'employee_monthly_statements.employee_statements_admin_delete_v2',
    'employee_monthly_statements.employee_statements_admin_insert_v2',
    'employee_monthly_statements.employee_statements_admin_update_v2',
    'employee_monthly_statements.employee_statements_read_v2',
    'manager_daily_checklist.manager_daily_checklist_self_v1',
    'manager_weekly_evaluations.manager_weekly_evaluations_admin_delete_v2',
    'manager_weekly_evaluations.manager_weekly_evaluations_admin_insert_v2',
    'manager_weekly_evaluations.manager_weekly_evaluations_admin_update_v2',
    'manager_weekly_evaluations.manager_weekly_evaluations_read_v2'
  ];
  r record;
  v_found text[];
  v_qual text;
  v_check text;
  v_new_qual text;
  v_new_check text;
  v_sql text;
begin
  select coalesce(array_agg(c.relname || '.' || po.polname order by 1), '{}')
    into v_found
  from pg_policy po
  join pg_class c on c.oid = po.polrelid
  where coalesce(pg_get_expr(po.polqual, po.polrelid), '') || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '')
        like '%x-dawaa-user-id%';

  if cardinality(v_found) = 0 then
    raise notice 'identity rls v1: no header-based policy left (already applied)';
    return;
  end if;

  -- Drift guard: the affected set must be exactly the reviewed one (a subset is a partial earlier run).
  if not (v_found <@ c_expected) then
    raise exception 'identity rls v1: unexpected header-based policies %; re-review before applying',
      (select array_agg(x) from unnest(v_found) x where x <> all (c_expected));
  end if;

  for r in
    select po.polname, po.polrelid, c.relname,
           pg_get_expr(po.polqual, po.polrelid) as qual,
           pg_get_expr(po.polwithcheck, po.polrelid) as wcheck
    from pg_policy po
    join pg_class c on c.oid = po.polrelid
    where c.relname || '.' || po.polname = any (v_found)
    order by c.relname, po.polname
  loop
    v_qual := r.qual;
    v_check := r.wcheck;
    v_new_qual := replace(v_qual, c_fragment, c_replacement);
    v_new_check := replace(v_check, c_fragment, c_replacement);

    -- Every header reference must be exactly the reviewed fragment; anything else is drift.
    if coalesce(v_new_qual, '') like '%x-dawaa-user-id%' or coalesce(v_new_check, '') like '%x-dawaa-user-id%'
       or coalesce(v_new_qual, '') like '%request.headers%' or coalesce(v_new_check, '') like '%request.headers%' then
      raise exception 'identity rls v1: %.% has a header reference outside the reviewed fragment', r.relname, r.polname;
    end if;

    v_sql := format('alter policy %I on public.%I', r.polname, r.relname);
    if v_qual is not null then
      v_sql := v_sql || format(' using (%s)', v_new_qual);
    end if;
    if v_check is not null then
      v_sql := v_sql || format(' with check (%s)', v_new_check);
    end if;
    execute v_sql;
  end loop;
end
$migration$;

-- Post-conditions: no policy anywhere in the database reads the header or raw request headers.
do $post$
declare
  v_left text;
begin
  select string_agg(po.polrelid::regclass::text || '.' || po.polname, ', ') into v_left
  from pg_policy po
  where coalesce(pg_get_expr(po.polqual, po.polrelid), '') || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '')
        ~ '(x-dawaa-user-id|request\.headers)';
  if v_left is not null then
    raise exception 'identity rls v1: policies still read request headers: %', v_left;
  end if;
end
$post$;
