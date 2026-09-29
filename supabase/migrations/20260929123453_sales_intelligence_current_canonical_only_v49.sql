-- Sales Intelligence V49 — canonical-only current projections.
-- Current views expose only current analyses that are linked to exactly one Customer Case V22
-- and whose originating WhatsApp review source is still active. Historical/unlinked/superseded
-- analyses remain intact in the versioned base tables for audit/replay.

create or replace view public.sales_intelligence_current_case_analyses
with (security_invoker = true) as
select ca.*
from public.sales_intelligence_case_analyses ca
join public.sales_intelligence_cases c on c.case_id = ca.case_id
join public.whatsapp_review_sources s on s.id = c.conversation_id
where ca.is_current = true
  and c.source_case_id_v22 is not null
  and coalesce(s.review_status,'') <> 'archived';

create or replace view public.sales_intelligence_current_attributions
with (security_invoker = true) as
select a.*
from public.sales_intelligence_attributions a
join public.sales_intelligence_case_analyses ca
  on ca.analysis_id = a.analysis_id and ca.is_current = true
join public.sales_intelligence_cases c on c.case_id = a.case_id
join public.whatsapp_review_sources s on s.id = c.conversation_id
where a.is_current_evaluation = true
  and c.source_case_id_v22 is not null
  and coalesce(s.review_status,'') <> 'archived';

create or replace view public.sales_intelligence_current_policy_evaluations
with (security_invoker = true) as
select pe.*
from public.sales_intelligence_policy_evaluations pe
join public.sales_intelligence_case_analyses ca
  on ca.analysis_id = pe.analysis_id and ca.is_current = true
join public.sales_intelligence_cases c on c.case_id = pe.case_id
join public.whatsapp_review_sources s on s.id = c.conversation_id
where pe.is_current = true
  and c.source_case_id_v22 is not null
  and coalesce(s.review_status,'') <> 'archived';

comment on view public.sales_intelligence_current_case_analyses is
  'Canonical current Sales Intelligence analyses only: current analysis + exactly linked Customer Case V22 + active review source. Historical/unlinked/superseded source analyses remain preserved in base tables.';

comment on view public.sales_intelligence_current_attributions is
  'Canonical current attribution evaluations only: current analysis/evaluation + linked Customer Case V22 + active review source. Historical rows remain preserved in base tables.';

comment on view public.sales_intelligence_current_policy_evaluations is
  'Canonical current policy evaluations only: current analysis/evaluation + linked Customer Case V22 + active review source. Historical rows remain preserved in base tables.';
