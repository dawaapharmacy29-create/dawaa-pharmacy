-- LIVE identity contract (read-only). Returns one row per violation; zero rows = contract holds.
-- Run against any database (isolated rehearsal clone, staging, or Production with a read-only session).
-- It checks the catalog as it IS, not migration files, so drift, Production-only edits and default
-- privileges that silently re-grant EXECUTE are all caught.
--
--   R1  no function in public reads the client-chosen x-dawaa-user-id header
--   R2  no RLS policy (any schema) reads x-dawaa-user-id or raw request.headers
--   R3  every client-executable SECURITY DEFINER function with a p_actor_id argument binds it to the verified
--       caller (dawaa_bind_actor_v1), or resolves identity only from the verified session and validates any
--       claimed actor (reviewed resolvers), or never uses p_actor_id at all
--   R4  reviewed internal actor-trusting writers are not client-executable
--   R5  the canonical identity primitives exist and are session-derived
with fn as (
  select p.oid, p.oid::regprocedure::text as sig, p.proname, p.prosrc, p.prosecdef,
         has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') as client_exec
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
)
select 'R1' as rule, sig as object, 'function reads x-dawaa-user-id' as violation
from fn where prosrc like '%x-dawaa-user-id%'
union all
select 'R2', po.polrelid::regclass::text || '.' || po.polname, 'policy reads request headers'
from pg_policy po
where coalesce(pg_get_expr(po.polqual, po.polrelid), '') || coalesce(pg_get_expr(po.polwithcheck, po.polrelid), '')
      ~ '(x-dawaa-user-id|request\.headers)'
union all
select 'R3', f.sig, 'client-executable SECURITY DEFINER function trusts p_actor_id'
from fn f
join pg_proc p on p.oid = f.oid
where f.client_exec and f.prosecdef
  and 'p_actor_id' = any (p.proargnames)
  -- uses p_actor_id somewhere in its body (an unused compatibility argument is harmless)
  and f.prosrc ~ '\mp_actor_id\M'
  and f.prosrc not like '%dawaa_bind_actor_v1(p_actor_id)%'
  -- reviewed verified-session resolvers: identity comes from the session; a claimed actor is validated, never trusted
  and f.prosrc !~ 'monthly_eval_actor\(p_actor_id\)'
  and f.prosrc !~ 'dawaa_current_followup_actor_v2\(p_actor_id'
  -- reviewed pure delegations: p_actor_id is only forwarded to functions that are themselves bound
  and f.sig not in (
    'app_role_allowed(text,text[])',                                      -- forwards to app_staff_role (bound)
    'dawaa_assert_customer_intelligence_branch_v2(text,uuid)',            -- forwards to dawaa_can_access_customer_intelligence_branch_v2 (bound)
    'get_customer_points_daily20_v2(date,uuid)', 'get_customer_service_at_risk_completion_v1(date,uuid)',
    'get_customer_service_at_risk_daily_v2(date,uuid)', 'get_customer_service_daily_queue_completion_v1(date,uuid)',
    'get_customer_service_daily_vip7_v2(date,uuid)', 'get_customer_service_first_purchase_save_v2(date,uuid)',
    'get_customer_service_plus500_v2(date,uuid)', 'get_customer_service_recent_top50_v2(integer,uuid)',
    'get_customer_service_three_cycle_intelligence_v1(date,uuid)', 'mark_customer_points_contacted_v2(text,text,text,uuid)',
                                                                          -- forward to dawaa_customer_service_queue_scope_v3 (bound)
    'get_customer_service_cycle_cohorts(text,date,integer,uuid)', 'get_customer_service_watchlist_performance(text,date,integer,uuid)',
                                                                          -- forward to the customer-intelligence gatekeepers (bound)
    'fetch_customer_welcome_message_logs(text,text,text,text,text,text,text,text,date,date)',
                                                                          -- forwards to app_role_allowed / app_actor_is_team_dawaa (bound)
    'set_branch_sales_target(text,numeric,uuid)'                          -- forwards to dawaa_can_manage_branch_targets (bound)
  )
union all
select 'R4', sig, 'internal actor-trusting writer is client-executable'
from fn
where client_exec and sig in (
  'calculate_customer_loyalty_cycle_internal_v1(uuid,date,date,numeric,text,text)',
  'submit_customer_loyalty_approval_internal_v1(uuid,date,date,numeric,text,text,text)',
  'review_customer_loyalty_approval_internal_v1(uuid,text,text,text)',
  'insert_customer_points_ledger_internal_v1(jsonb)',
  'upsert_customer_loyalty_setting_internal_v1(jsonb)',
  'set_branch_daily_task_status(uuid,text,uuid,text,text,text)',
  'save_branch_sales_target_v2(uuid,text,numeric)'
)
union all
select 'R5', x.sig, x.problem
from (values
  ('dawaa_session_account_id_v1()', 'x-dawaa-session-token'),
  ('dawaa_current_staff_account_id_strict()', 'dawaa_request_staff_identifier'),
  ('dawaa_request_staff_identifier()', 'dawaa_session_account_id_v1'),
  ('dawaa_bind_actor_v1(uuid)', 'dawaa_current_staff_account_id_strict'),
  ('dawaa_bind_actor_v1(text)', 'dawaa_current_staff_account_id_strict'),
  ('dawaa_request_context_is_client_v1()', 'request.jwt.claims')
) as req(sig, must_contain)
cross join lateral (
  select req.sig,
         case when to_regprocedure('public.' || req.sig) is null then 'canonical identity primitive missing'
              else 'canonical identity primitive is not session-derived' end as problem
  where to_regprocedure('public.' || req.sig) is null
     or (select prosrc from pg_proc where oid = to_regprocedure('public.' || req.sig)) not like '%' || req.must_contain || '%'
) x
order by 1, 2;
