-- Security fix found via H.1B instruction #19 verification: Supabase's default privileges on the
-- public schema auto-grant EXECUTE on newly created functions to anon/authenticated/postgres in
-- addition to whatever this migration explicitly granted. `revoke all on function ... from public`
-- (used in the original RPC migrations) only removes the implicit PUBLIC-role grant — it does NOT
-- revoke separate, already-materialized grants to the anon/authenticated roles specifically. A
-- direct information_schema.routine_privileges check confirmed anon and authenticated both had
-- EXECUTE on all four sales_intelligence_write_* RPCs, which would let those roles bypass RLS
-- entirely via SECURITY DEFINER (RLS is designed around table-level policies, not against a
-- definer function executing arbitrary writes on behalf of a caller with no engine-table access).
-- This explicitly revokes EXECUTE from anon and authenticated on all four RPCs, leaving only
-- service_role (and postgres, the bootstrapping/superuser role, consistent with every other
-- engine table in this schema) able to call them.
revoke execute on function public.sales_intelligence_write_case_analysis(text, jsonb) from anon, authenticated;
revoke execute on function public.sales_intelligence_write_policy_evaluation(uuid, jsonb) from anon, authenticated;
revoke execute on function public.sales_intelligence_write_attribution(uuid, jsonb) from anon, authenticated;
revoke execute on function public.sales_intelligence_write_basket_invoice_match(uuid, jsonb) from anon, authenticated;
