-- Superseded by the reviewed idempotent follow-up migrations:
--   20260720_customer_followup_find_or_create_open_case.sql
--   20260720_customer_followup_compat_rpc_forward.sql
--
-- Intentionally no bulk UPDATE, trigger disabling, history mutation, or automatic
-- duplicate hiding is performed here. Historical records must be reviewed through
-- the diagnostic view before any explicit data-cleaning migration is approved.

begin;

-- Keep the migration path stable while ensuring deployments are non-destructive.
select 1;

commit;
