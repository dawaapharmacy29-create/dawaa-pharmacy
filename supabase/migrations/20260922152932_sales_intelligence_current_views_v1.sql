-- Sales Intelligence Phase H.1A — Schema Foundation (7/7): current-result convenience views.
-- security_invoker = true is REQUIRED here: without it, a view runs with the VIEW OWNER's
-- permissions against the underlying tables (which could silently bypass the RLS policies just
-- created above, since the owner is typically exempt from its own tables' RLS). With it, the view
-- is evaluated using the QUERYING user's own permissions, so RLS is enforced exactly as if the
-- caller queried the base tables directly. No view here hides attribution confidence,
-- needsHumanReview, integrityEvaluationScope, or protocol-policy state (instruction #10) — every
-- column is selected through unchanged.
create or replace view public.sales_intelligence_current_case_analyses
with (security_invoker = true) as
select ca.*
from public.sales_intelligence_case_analyses ca
where ca.is_current = true;

create or replace view public.sales_intelligence_current_attributions
with (security_invoker = true) as
select a.*
from public.sales_intelligence_attributions a
join public.sales_intelligence_case_analyses ca
  on ca.analysis_id = a.analysis_id and ca.is_current = true
where a.is_current_evaluation = true;

create or replace view public.sales_intelligence_current_policy_evaluations
with (security_invoker = true) as
select pe.*
from public.sales_intelligence_policy_evaluations pe
join public.sales_intelligence_case_analyses ca
  on ca.analysis_id = pe.analysis_id and ca.is_current = true
where pe.is_current = true;

comment on view public.sales_intelligence_current_case_analyses is
  'Phase H.1A. WHERE is_current = true, security_invoker so RLS applies to the querying user. Historical storage stays fully versioned in the base table.';
comment on view public.sales_intelligence_current_attributions is
  'Phase H.1A. Joined to the current case analysis and the current attribution evaluation, security_invoker so RLS applies to the querying user.';
comment on view public.sales_intelligence_current_policy_evaluations is
  'Phase H.1A. Joined to the current case analysis and the current policy evaluation, security_invoker so RLS applies to the querying user.';
