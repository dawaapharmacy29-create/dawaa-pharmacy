-- get_customer_service_at_risk_completion_v1: read the at-risk queue without the snapshot write.
--
-- Production smoke (2026-10-16): /daily-command (P1) called get_customer_service_at_risk_completion_v1 and got 405 on
-- every load: the function is STABLE, so PostgREST runs it in a read-only transaction, but it read the queue through
-- get_customer_service_at_risk_daily_v2, which first INSERTs a snapshot (log_at_risk_snapshot_v1) -> "cannot execute
-- INSERT in a read-only transaction". The per-branch at-risk progress therefore never loaded.
--
-- get_customer_service_at_risk_daily_v2 returns exactly
-- get_customer_service_at_risk_daily_core(p_date, dawaa_customer_service_queue_scope_v3(p_actor_id)) after logging.
-- The function below is the exact Production definition (2026-10-16) reading that core directly with the same scope
-- expression: identical rows and counts, no snapshot write (which never succeeded from this read path). The queue
-- itself (get_customer_service_at_risk_daily_v2) and its snapshot logging are unchanged.

do $guard$
begin
  if md5(btrim(regexp_replace(pg_get_functiondef(to_regprocedure('public.get_customer_service_at_risk_completion_v1(date,uuid)')), '\s+', ' ', 'g')))
       not in ('c45add15134109429e057459cc5024ec', '3c301856bba66791e5e15fcded739467') then
    raise exception 'get_customer_service_at_risk_completion_v1 differs from the reviewed definition; regenerate this migration';
  end if;
  if to_regprocedure('public.get_customer_service_at_risk_daily_core(date,text)') is null
     or to_regprocedure('public.dawaa_customer_service_queue_scope_v3(uuid)') is null then
    raise exception 'at-risk queue core or scope function is missing';
  end if;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.get_customer_service_at_risk_completion_v1(p_date date DEFAULT CURRENT_DATE, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(branch text, at_risk_total integer, at_risk_handled integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
  with q as (
    select * from public.get_customer_service_at_risk_daily_core(p_date, public.dawaa_customer_service_queue_scope_v3(p_actor_id))
  )
  select q.branch, count(*)::integer,
    count(*) filter (
      where exists (
        select 1 from public.daily_followups f
        where f.branch = q.branch and btrim(f.customer_code) = q.customer_code and f.date = p_date::text
      )
    )::integer
  from q
  group by q.branch;
$function$;

notify pgrst, 'reload schema';
