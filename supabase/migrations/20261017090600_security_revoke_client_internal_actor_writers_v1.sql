-- SECURITY: internal actor-trusting writers are not client RPCs.
--
-- Each function below authorizes from a client-supplied actor (p_actor_id or payload created_by) or not at all,
-- writes business rows, and is executable by anon/authenticated in Production. None has a browser caller on
-- main; the only callers are SECURITY DEFINER wrappers that already resolve the verified session actor
-- (calculate/submit/review_customer_loyalty_approval, insert_customer_points_ledger, upsert_customer_loyalty_setting).
--   * calculate/submit/review loyalty *_internal_v1, insert_customer_points_ledger_internal_v1,
--     upsert_customer_loyalty_setting_internal_v1: 20260825233000_harden_customer_points_domain_v1 revoked these,
--     but a later DROP/CREATE re-applied the schema default privileges (EXECUTE to anon/authenticated).
--   * set_branch_daily_task_status: no authorization at all.
--   * save_branch_sales_target_v2: authorizes only from p_actor_id; the app uses set_branch_sales_target.
-- Revoking client EXECUTE does not affect the wrappers (definer privileges) or service_role/cron.
-- Bodies are not changed. Forward-only, no business-row DML, idempotent.

do $migration$
declare
  r record;
  v_oid oid;
  v_invoker_callers text;
begin
  for r in
    select * from (values
      ('public.calculate_customer_loyalty_cycle_internal_v1(uuid,date,date,numeric,text,text)'),
      ('public.submit_customer_loyalty_approval_internal_v1(uuid,date,date,numeric,text,text,text)'),
      ('public.review_customer_loyalty_approval_internal_v1(uuid,text,text,text)'),
      ('public.insert_customer_points_ledger_internal_v1(jsonb)'),
      ('public.upsert_customer_loyalty_setting_internal_v1(jsonb)'),
      ('public.set_branch_daily_task_status(uuid,text,uuid,text,text,text)'),
      ('public.save_branch_sales_target_v2(uuid,text,numeric)')
    ) as t(signature)
  loop
    v_oid := to_regprocedure(r.signature);
    if v_oid is null then
      raise exception 'revoke internal writers: % is missing', r.signature;
    end if;

    -- Fail closed if any SECURITY INVOKER function or RLS policy calls it: those would run with the client's
    -- privileges and break after the revoke.
    select string_agg(p.oid::regprocedure::text, ', ') into v_invoker_callers
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not p.prosecdef
      and p.oid <> v_oid
      and p.prosrc ~ ('\m' || (select proname from pg_proc where oid = v_oid) || '\M');
    if v_invoker_callers is not null then
      raise exception 'revoke internal writers: % is called by SECURITY INVOKER %', r.signature, v_invoker_callers;
    end if;
    if exists (
      select 1 from pg_policy po
      where coalesce(pg_get_expr(po.polqual, po.polrelid), '') || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '')
            ~ ('\m' || (select proname from pg_proc where oid = v_oid) || '\M')
    ) then
      raise exception 'revoke internal writers: % is referenced by an RLS policy', r.signature;
    end if;

    execute format('revoke all on function %s from public, anon, authenticated', v_oid::regprocedure);
    execute format('grant execute on function %s to service_role', v_oid::regprocedure);
  end loop;
end
$migration$;

do $post$
declare
  v_open text;
begin
  select string_agg(p.oid::regprocedure::text, ', ') into v_open
  from pg_proc p
  where p.oid in (
    to_regprocedure('public.calculate_customer_loyalty_cycle_internal_v1(uuid,date,date,numeric,text,text)'),
    to_regprocedure('public.submit_customer_loyalty_approval_internal_v1(uuid,date,date,numeric,text,text,text)'),
    to_regprocedure('public.review_customer_loyalty_approval_internal_v1(uuid,text,text,text)'),
    to_regprocedure('public.insert_customer_points_ledger_internal_v1(jsonb)'),
    to_regprocedure('public.upsert_customer_loyalty_setting_internal_v1(jsonb)'),
    to_regprocedure('public.set_branch_daily_task_status(uuid,text,uuid,text,text,text)'),
    to_regprocedure('public.save_branch_sales_target_v2(uuid,text,numeric)'))
    and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_open is not null then
    raise exception 'revoke internal writers: still client-executable: %', v_open;
  end if;
end
$post$;
