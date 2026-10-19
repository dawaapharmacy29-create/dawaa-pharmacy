-- Owner-approved sales/target/doctor exclusion policy, 2026-10-19.
-- Exactly seven unique codes: 5,10,20,54,170,4902,12820.
-- Code 7 remains ordinary sales eligible for target/doctor metrics.
-- Retain all raw sales invoices and preserve separate internal-code financial reporting.
BEGIN;
CREATE OR REPLACE FUNCTION public.dawaa_is_sales_target_excluded_customer_v1(
 p_branch text, p_customer_code text
) RETURNS boolean LANGUAGE sql STABLE
SET search_path TO 'public','pg_catalog'
AS $fn$
 SELECT btrim(coalesce(p_customer_code,'')) = ANY (
 ARRAY['5','10','20','54','170','4902','12820']::text[]
 );
$fn$;
DO $$
DECLARE v text;
BEGIN
 SELECT pg_get_viewdef('public.dawaa_sales_invoices_dashboard_v1'::regclass,true) INTO v;
 IF position('''54''::text' IN v)>0 AND position('''20''::text' IN v)=0 THEN
   v:=replace(v,'''54''::text','''54''::text, ''20''::text');
   EXECUTE 'CREATE OR REPLACE VIEW public.dawaa_sales_invoices_dashboard_v1 AS '||v;
 ELSIF position('''20''::text' IN v)>0 AND position('''54''::text' IN v)>0 THEN
   NULL; -- Already migrated; idempotent.
 ELSE
   RAISE EXCEPTION 'Unexpected sales dashboard policy; review before changing';
 END IF;
END $$;
-- Preserve the deployed branch-target RPC while updating its two sales filters.
DO $
DECLARE v text;
BEGIN
 SELECT pg_get_functiondef(oid) INTO v FROM pg_proc
 WHERE proname='dawaa_branch_target_progress_for_cycle_v1'
 AND pronamespace='public'::regnamespace;
 IF v IS NULL THEN RAISE EXCEPTION 'branch target RPC missing'; END IF;
 IF position('''5'',''10'',''54'',''170'',''4902'',''12820''' IN v)>0 THEN
   v:=replace(v,'''5'',''10'',''54'',''170'',''4902'',''12820''','''5'',''10'',''20'',''54'',''170'',''4902'',''12820''');
   EXECUTE v;
 ELSIF position('''5'',''10'',''20'',''54'',''170'',''4902'',''12820''' IN v)=0 THEN
   RAISE EXCEPTION 'unexpected branch-target policy';
 END IF;
END $;
COMMIT;
