-- STEP 9N-A — make automatic WhatsApp conversation reviews case/interaction-level.
--
-- Why:
-- A single whatsapp_review_sources row can legitimately produce more than one canonical
-- Sales Intelligence case/interaction. The old unique index allowed only one automatic review
-- per source, which would collapse multiple interactions into one score.
--
-- This migration is additive for data. It changes uniqueness semantics safely:
--   * legacy rows with no case id remain one-per-source;
--   * new case-aware rows are unique by (source, sales_intelligence_case_id).
-- No existing review row is rewritten or deleted.

alter table public.conversation_sales_reviews
  add column if not exists sales_intelligence_case_id text,
  add column if not exists automatic_evaluation_version text,
  add column if not exists automatic_evaluation_json jsonb,
  add column if not exists evidence_coverage_percent numeric,
  add column if not exists automatic_reliability_percent numeric,
  add column if not exists manual_clinical_review_required boolean;

drop index if exists public.conversation_sales_reviews_whatsapp_source_uk;

create unique index if not exists conversation_sales_reviews_whatsapp_source_legacy_uk
  on public.conversation_sales_reviews (whatsapp_review_source_id)
  where whatsapp_review_source_id is not null
    and sales_intelligence_case_id is null;

create unique index if not exists conversation_sales_reviews_whatsapp_case_uk
  on public.conversation_sales_reviews (whatsapp_review_source_id, sales_intelligence_case_id)
  where whatsapp_review_source_id is not null
    and sales_intelligence_case_id is not null;

comment on column public.conversation_sales_reviews.sales_intelligence_case_id is
  'Canonical Sales Intelligence case/interaction id. New automatic reviews are persisted per case, not merely per WhatsApp source.';

comment on column public.conversation_sales_reviews.automatic_evaluation_version is
  'Version of the final automatic 19-criterion conversation evaluation contract.';

comment on column public.conversation_sales_reviews.automatic_evaluation_json is
  'Full automatic evaluation snapshot: criterion states, reasons, evidence ids, confidence, coverage, and manual-clinical routing.';

comment on column public.conversation_sales_reviews.evidence_coverage_percent is
  'Percent of applicable automatic-score weight backed by sufficient evidence. Missing evidence is never converted to zero.';

comment on column public.conversation_sales_reviews.automatic_reliability_percent is
  'Combined confidence/coverage reliability indicator for the automatic conversation result.';

comment on column public.conversation_sales_reviews.manual_clinical_review_required is
  'True when consultation and/or dosage/usage content was detected and routed to manual clinical review outside the automatic score.';
