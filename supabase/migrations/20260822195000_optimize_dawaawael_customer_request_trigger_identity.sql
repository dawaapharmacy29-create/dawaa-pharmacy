create index if not exists idx_customers_sync_trigger_effective_identity_v1
on public.customers ((btrim(coalesce(effective_customer_code, customer_code, code, ''))))
include (id, effective_branch, corrected_branch, branch, branch_name)
where btrim(coalesce(effective_customer_code, customer_code, code, '')) <> '';
