-- Sales Intelligence Phase H.1B — atomic supersede+insert RPC for sales_intelligence_case_analyses.
-- Concurrency-safety mechanism required by instruction #7: two workers racing on the same case_id
-- must never both create a "current" analysis row. pg_advisory_xact_lock serializes concurrent
-- callers scoped to this exact case_id; calls for different case_ids never contend. Idempotency:
-- same case_id + semantic_source_hash + pipeline_version + all four engine versions => no new row,
-- return the existing current row with is_new=false. SECURITY DEFINER so it can perform the write
-- under the engine tables' service-role-write-only RLS from inside a definer context; EXECUTE is
-- granted to service_role only (revoked from PUBLIC/authenticated/anon below) — this does not widen
-- who may write engine output, it only changes how the already-service-role-only writer performs it.
--
-- This body already reflects two fixes found via smoke-testing during H.1B development (see
-- docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md §26 and §27 for the write-up; the live database
-- only retains the final CREATE OR REPLACE state, so the intermediate buggy revisions applied and
-- replaced during development are not represented as separate local files):
--   1) jsonb_populate_record leaves a column NULL when the caller's payload omits it — it does NOT
--      apply the table's own DEFAULT. Defaultable columns are explicitly coalesced below.
--   2) The new row is inserted as is_current=false FIRST, then the old row is retired (referencing
--      the now-existing new row via the self-referencing FK), then the new row is flipped to
--      is_current=true LAST. Any other order either violates the self-referencing FK (old row
--      pointing at a not-yet-inserted new row) or the partial unique index on
--      (case_id) WHERE is_current=true (two rows briefly both current).
create or replace function public.sales_intelligence_write_case_analysis(
  p_case_id text,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.sales_intelligence_case_analyses;
  v_new public.sales_intelligence_case_analyses;
  v_new_id uuid := gen_random_uuid();
  v_found boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:' || p_case_id));

  select * into v_existing
  from public.sales_intelligence_case_analyses
  where case_id = p_case_id and is_current = true
  for update;
  v_found := found;

  if v_found
     and v_existing.semantic_source_hash = (p_row->>'semantic_source_hash')
     and v_existing.pipeline_version = (p_row->>'pipeline_version')
     and v_existing.engine_version_case_segmentation = (p_row->>'engine_version_case_segmentation')
     and v_existing.engine_version_historical_closure = (p_row->>'engine_version_historical_closure')
     and v_existing.engine_version_commercial_confirmation = (p_row->>'engine_version_commercial_confirmation')
     and v_existing.engine_version_protocol_applicability = (p_row->>'engine_version_protocol_applicability')
  then
    return jsonb_build_object('is_new', false) || to_jsonb(v_existing);
  end if;

  v_new := jsonb_populate_record(null::public.sales_intelligence_case_analyses, p_row);
  v_new.analysis_id := v_new_id;
  v_new.case_id := p_case_id;
  v_new.analysis_version := coalesce(v_existing.analysis_version, 0) + 1;
  v_new.is_current := false;
  v_new.superseded_at := null;
  v_new.superseded_by_analysis_id := null;
  v_new.analyzed_at := coalesce(v_new.analyzed_at, now());
  v_new.needs_human_review := coalesce(v_new.needs_human_review, false);
  v_new.human_review_reasons := coalesce(v_new.human_review_reasons, '{}');
  v_new.failure_reasons := coalesce(v_new.failure_reasons, '{}');
  v_new.pipeline_warnings := coalesce(v_new.pipeline_warnings, '{}');
  v_new.evidence_snapshot := coalesce(v_new.evidence_snapshot, '{}'::jsonb);

  insert into public.sales_intelligence_case_analyses select (v_new).*;

  if v_found then
    update public.sales_intelligence_case_analyses
    set is_current = false, superseded_at = now(), superseded_by_analysis_id = v_new_id
    where analysis_id = v_existing.analysis_id;
  end if;

  update public.sales_intelligence_case_analyses
  set is_current = true
  where analysis_id = v_new_id;
  v_new.is_current := true;

  return jsonb_build_object('is_new', true) || to_jsonb(v_new);
end;
$$;

revoke all on function public.sales_intelligence_write_case_analysis(text, jsonb) from public;
grant execute on function public.sales_intelligence_write_case_analysis(text, jsonb) to service_role;

comment on function public.sales_intelligence_write_case_analysis(text, jsonb) is
  'Phase H.1B. Atomic supersede+insert for sales_intelligence_case_analyses, serialized per case_id via pg_advisory_xact_lock. service_role only. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md §26.';
