-- Sales Intelligence Phase H.1A — follow-up: cover the two self-referencing "superseded_by_*" FKs
-- with indexes, per the Supabase performance advisor's unindexed_foreign_keys finding raised
-- immediately after the core schema migrations (H.1A report item 12).
create index if not exists sales_intelligence_case_analyses_superseded_by_idx
  on public.sales_intelligence_case_analyses(superseded_by_analysis_id);

create index if not exists sales_intelligence_policy_evaluations_superseded_by_idx
  on public.sales_intelligence_policy_evaluations(superseded_by_policy_evaluation_id);
