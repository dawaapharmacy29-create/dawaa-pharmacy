-- READ ONLY. Global integrity checks AFTER a separately approved historical repair.
-- Any nonzero integrity count prevents final readiness; active exceptions are reported separately.
BEGIN READ ONLY;
SELECT count(*) active_archived_cases FROM public.sales_intelligence_cases c JOIN public.whatsapp_review_sources s ON s.id=c.conversation_id WHERE c.is_active AND s.review_status='archived';
SELECT count(*) duplicate_current_cases FROM (SELECT case_id FROM public.sales_intelligence_case_analyses WHERE is_current GROUP BY case_id HAVING count(*)>1) x;
SELECT count(*) published_superseded FROM public.sales_intelligence_cases c JOIN public.sales_intelligence_case_analyses a ON a.analysis_id=c.published_analysis_id WHERE a.superseded_at IS NOT NULL;
SELECT count(*) published_current_mismatches FROM public.sales_intelligence_cases c WHERE c.published_analysis_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_intelligence_case_analyses a WHERE a.analysis_id=c.published_analysis_id AND a.case_id=c.case_id AND a.is_current AND a.superseded_at IS NULL);
SELECT count(*) duplicate_cases FROM (SELECT case_id FROM public.sales_intelligence_cases GROUP BY case_id HAVING count(*)>1) x;
SELECT c.case_id,c.conversation_id FROM public.sales_intelligence_cases c JOIN public.whatsapp_review_sources s ON s.id=c.conversation_id WHERE c.is_active AND s.review_status IS DISTINCT FROM 'archived' AND NOT EXISTS(SELECT 1 FROM public.sales_intelligence_current_case_analyses a WHERE a.case_id=c.case_id);
-- These exceptions must stay visible, be individually explained and never counted as sales.
-- Compare approved manifest before/after: every prior analysis_id still exists; prior cases still
-- exist; all changes to cases outside the approved source/case set must be ZERO. The repair
-- manifest is intentionally not authorized/generated as executable Production DML in Batch 4.
-- Required psql variables: baseline_cases (JSON array of full pre-repair case metadata),
-- baseline_analysis_ids (JSON string array), approved_source_ids (JSON string array).
WITH expected AS (SELECT value row FROM jsonb_array_elements(:'baseline_cases'::jsonb))
SELECT e.row->>'case_id' missing_case FROM expected e WHERE NOT EXISTS(SELECT 1 FROM public.sales_intelligence_cases c WHERE c.case_id=e.row->>'case_id');
WITH expected AS (SELECT value row FROM jsonb_array_elements(:'baseline_cases'::jsonb))
SELECT c.case_id unrelated_case_changed FROM expected e JOIN public.sales_intelligence_cases c ON c.case_id=e.row->>'case_id'
WHERE NOT (:'approved_source_ids'::jsonb ? (e.row->>'conversation_id')) AND to_jsonb(c) IS DISTINCT FROM e.row;
SELECT id missing_historical_analysis FROM jsonb_array_elements_text(:'baseline_analysis_ids'::jsonb) old(id)
WHERE NOT EXISTS(SELECT 1 FROM public.sales_intelligence_case_analyses a WHERE a.analysis_id::text=old.id);
-- All three result sets must be EMPTY. Semantic history fields are compared with the external
-- pre-repair snapshot too; only explicitly approved lifecycle flags may change.
COMMIT;
