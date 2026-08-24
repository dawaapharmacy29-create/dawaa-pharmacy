-- The app authenticates staff through the custom x-dawaa-user-id session while
-- PostgREST still runs as anon. The import function already validates the active
-- staff account and allowed manager roles internally, so expose execute to anon.

revoke execute on function public.import_product_movement_evidence_v1(jsonb, text) from public;
grant execute on function public.import_product_movement_evidence_v1(jsonb, text) to anon, authenticated, service_role;
