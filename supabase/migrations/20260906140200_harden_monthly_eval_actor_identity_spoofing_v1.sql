-- CRITICAL finding: monthly_eval_actor(p_actor_id) is the shared identity-resolution
-- helper for 9 functions in the monthly-evaluation / branch-target / CS-doctor-
-- evaluation family (can_view_monthly_performance_360_safe,
-- list_staff_for_monthly_performance_360_safe, get_staff_monthly_evaluation_safe,
-- save_branch_sales_target_safe, save_staff_monthly_evaluation_safe,
-- list_doctors_for_customer_service_evaluation_safe,
-- get_doctor_customer_service_evaluation_safe,
-- save_doctor_customer_service_evaluation_safe,
-- list_staff_for_monthly_evaluation_safe). Every one of them took a client-supplied
-- p_actor_id and blindly looked up that staff_accounts row -- it never checked that
-- p_actor_id was actually the calling session. Since these are all SECURITY DEFINER
-- (bypass RLS) and several are WRITE actions, any authenticated account could pass
-- another employee's staff_accounts.id as p_actor_id to impersonate them: a doctor
-- could pose as a branch manager to submit fraudulent monthly evaluations for other
-- staff, forge a branch sales target, or read/write another doctor's confidential
-- customer-service evaluation -- all while the existing self-evaluation and branch-
-- scope guards inside those functions looked correct on paper, because those guards
-- compared against the *spoofed* actor, not the real one.
--
-- Fix at the single shared choke point: monthly_eval_actor now ignores the p_actor_id
-- argument entirely and always resolves identity from the authenticated session via
-- dawaa_current_staff_account_id_strict() (the same session-resolution primitive used
-- everywhere else in this codebase). The function signature is unchanged, so none of
-- the 9 dependent functions or their frontend callers need to change -- every one of
-- them is hardened by this single fix.
--
-- APPLIED DIRECTLY TO PRODUCTION on 2026-09-06 via Supabase MCP. This file mirrors
-- that change into version control -- it does not need to be re-applied.

create or replace function public.monthly_eval_actor(p_actor_id uuid)
returns table(account_id uuid, staff_id uuid, role text, branch text, name text)
language sql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select a.id,
         case when a.staff_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then a.staff_id::uuid else null end,
         lower(coalesce(a.role,'')), coalesce(a.branch,''), coalesce(a.name,a.staff_name,a.username)
  from public.staff_accounts a
  where a.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(a.active,false)=true and coalesce(a.can_login,false)=true
  limit 1
$function$;
