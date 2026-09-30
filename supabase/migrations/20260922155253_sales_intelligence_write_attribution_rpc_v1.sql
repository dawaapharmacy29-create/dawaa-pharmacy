-- Sales Intelligence Phase H.1B — atomic supersede+insert RPC for sales_intelligence_attributions.
-- Scoped to analysis_id (attribution is analysis-version-owned but independently re-evaluable —
-- design doc H.0.1 §9-§11). Idempotency: same analysis_id + attribution_input_hash +
-- attribution_engine_version => no new row. NOTE this table's own "superseded_by" column is
-- superseded_by_evaluation_version (an integer, not a self-referencing uuid FK, unlike
-- case_analyses/policy_evaluations) — matched exactly as the live schema defines it.
--
-- This body already reflects the same defaults-coalescing and insert-as-false / retire-old /
-- flip-new-current ordering fixes as sales_intelligence_write_case_analysis (see that migration's
-- comment and design doc §26/§27) — the ordering fix is required here too even without a
-- self-referencing FK, because the partial unique index on (analysis_id) WHERE
-- is_current_evaluation=true still rejects two current rows existing at once mid-transaction.
create or replace function public.sales_intelligence_write_attribution(
  p_analysis_id uuid,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.sales_intelligence_attributions;
  v_new public.sales_intelligence_attributions;
  v_new_id uuid := gen_random_uuid();
  v_found boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_attributions:' || p_analysis_id::text));

  select * into v_existing
  from public.sales_intelligence_attributions
  where analysis_id = p_analysis_id and is_current_evaluation = true
  for update;
  v_found := found;

  if v_found
     and v_existing.attribution_input_hash = (p_row->>'attribution_input_hash')
     and v_existing.attribution_engine_version = (p_row->>'attribution_engine_version')
  then
    return jsonb_build_object('is_new', false) || to_jsonb(v_existing);
  end if;

  v_new := jsonb_populate_record(null::public.sales_intelligence_attributions, p_row);
  v_new.id := v_new_id;
  v_new.analysis_id := p_analysis_id;
  v_new.evaluation_version := coalesce(v_existing.evaluation_version, 0) + 1;
  v_new.is_current_evaluation := false;
  v_new.superseded_at := null;
  v_new.superseded_by_evaluation_version := null;
  v_new.evaluated_at := coalesce(v_new.evaluated_at, now());
  v_new.is_official_for_staff_evaluation := coalesce(v_new.is_official_for_staff_evaluation, false);
  v_new.competing_case_ids := coalesce(v_new.competing_case_ids, '{}');
  v_new.ambiguity_status := coalesce(v_new.ambiguity_status, 'none');
  v_new.identity_conflict := coalesce(v_new.identity_conflict, 'none');
  v_new.branch_conflict := coalesce(v_new.branch_conflict, false);
  v_new.candidate_count := coalesce(v_new.candidate_count, 0);
  v_new.primary_evidence := coalesce(v_new.primary_evidence, '[]'::jsonb);
  v_new.contradictions := coalesce(v_new.contradictions, '{}');
  v_new.rule_ids := coalesce(v_new.rule_ids, '{}');
  v_new.legacy_evidence_used := coalesce(v_new.legacy_evidence_used, false);

  insert into public.sales_intelligence_attributions select (v_new).*;

  if v_found then
    update public.sales_intelligence_attributions
    set is_current_evaluation = false, superseded_at = now(), superseded_by_evaluation_version = v_new.evaluation_version
    where id = v_existing.id;
  end if;

  update public.sales_intelligence_attributions
  set is_current_evaluation = true
  where id = v_new_id;
  v_new.is_current_evaluation := true;

  return jsonb_build_object('is_new', true) || to_jsonb(v_new);
end;
$$;

revoke all on function public.sales_intelligence_write_attribution(uuid, jsonb) from public;
grant execute on function public.sales_intelligence_write_attribution(uuid, jsonb) to service_role;

comment on function public.sales_intelligence_write_attribution(uuid, jsonb) is
  'Phase H.1B. Atomic supersede+insert for sales_intelligence_attributions, serialized per analysis_id via pg_advisory_xact_lock. Never bumps analysis_version. service_role only. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md §26.';
