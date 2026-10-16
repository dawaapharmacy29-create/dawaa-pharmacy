-- whatsapp_customer_cases_v22: resolve the conversation-review actor scope once per statement.
--
-- Production smoke (2026-10-15): /sales-intelligence/qa reads whatsapp_customer_cases_v22 and
-- whatsapp_product_demand_unresolved_v22 (security_invoker views over the same table) and both returned 500
-- after ~13.3s (pg_stat_statements: 6 calls, mean 13307 ms, for 88 rows). The SELECT policy evaluated
-- dawaa_current_staff_account_id_strict() unwrapped and dawaa_can_read_conversation_review_row_v2(...) for
-- every case row.
--
-- Same rules, same row source: a case stays visible exactly when its root review source is visible to the actor
-- under dawaa_can_read_conversation_review_row_v2(actor, source.staff_id, NULL, source.branch, NULL). The actor
-- part now comes from public.dawaa_conversation_review_read_scope_v1() (20261015140000) through scalar
-- sub-selects (InitPlans). With reviewer and doctor NULL, the remaining row rules are: global role, the
-- source's staff_id equals the actor's staff_id, or a branch role whose canonical branch key matches.
-- The whatsapp_review_sources RLS that applies inside the EXISTS is unchanged.
-- Requires 20261015140000_rls_actor_scope_initplan_v1.

alter policy whatsapp_customer_cases_v22_select on public.whatsapp_customer_cases_v22
using (
  exists (
    select 1
    from public.whatsapp_review_sources src
    where src.id = whatsapp_customer_cases_v22.root_source_id
      and (
        (select conv_scope.read_mode from public.dawaa_conversation_review_read_scope_v1() conv_scope) = 'all'
        or (
          (select conv_scope.read_mode from public.dawaa_conversation_review_read_scope_v1() conv_scope) = 'scoped'
          and (
            src.staff_id::text = (select conv_scope.actor_staff_id from public.dawaa_conversation_review_read_scope_v1() conv_scope)
            or public.dawaa_customer_request_branch_key(src.branch)
               = (select conv_scope.branch_key from public.dawaa_conversation_review_read_scope_v1() conv_scope)
          )
        )
      )
  )
);

notify pgrst, 'reload schema';
