-- Sales Intelligence Phase H.1B — atomic supersede+insert RPC for sales_intelligence_policy_evaluations.
-- Scoped to analysis_id (an evaluation is always for one immutable analysis). Idempotency: same
-- analysis_id + policy_input_hash + policy_config_id => no new row (no separate "policy evaluation
-- engine version" column exists on this table — policy_input_hash already covers the exact inputs
-- per its own definition: analysis.protocolApplicability + caseEndedAt + policyConfigId — so no
-- additional dedup dimension is needed or invented). A policy change never creates a new semantic
-- analysis; it only ever creates a new row here for the SAME analysis_id.
--
-- This body already reflects the same insert-as-false / retire-old / flip-new-current ordering fix
-- as sales_intelligence_write_case_analysis (see that migration's comment and design doc §26/§27) —
-- required because superseded_by_policy_evaluation_id is a self-referencing FK and is_current has a
-- partial unique index.
create or replace function public.sales_intelligence_write_policy_evaluation(
  p_analysis_id uuid,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.sales_intelligence_policy_evaluations;
  v_new public.sales_intelligence_policy_evaluations;
  v_new_id uuid := gen_random_uuid();
  v_found boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_policy_evaluations:' || p_analysis_id::text));

  select * into v_existing
  from public.sales_intelligence_policy_evaluations
  where analysis_id = p_analysis_id and is_current = true
  for update;
  v_found := found;

  if v_found
     and v_existing.policy_input_hash = (p_row->>'policy_input_hash')
     and v_existing.policy_config_id = (p_row->>'policy_config_id')::uuid
  then
    return jsonb_build_object('is_new', false) || to_jsonb(v_existing);
  end if;

  v_new := jsonb_populate_record(null::public.sales_intelligence_policy_evaluations, p_row);
  v_new.policy_evaluation_id := v_new_id;
  v_new.analysis_id := p_analysis_id;
  v_new.evaluation_version := coalesce(v_existing.evaluation_version, 0) + 1;
  v_new.is_current := false;
  v_new.superseded_at := null;
  v_new.superseded_by_policy_evaluation_id := null;
  v_new.evaluated_at := coalesce(v_new.evaluated_at, now());

  insert into public.sales_intelligence_policy_evaluations select (v_new).*;

  if v_found then
    update public.sales_intelligence_policy_evaluations
    set is_current = false, superseded_at = now(), superseded_by_policy_evaluation_id = v_new_id
    where policy_evaluation_id = v_existing.policy_evaluation_id;
  end if;

  update public.sales_intelligence_policy_evaluations
  set is_current = true
  where policy_evaluation_id = v_new_id;
  v_new.is_current := true;

  return jsonb_build_object('is_new', true) || to_jsonb(v_new);
end;
$$;

revoke all on function public.sales_intelligence_write_policy_evaluation(uuid, jsonb) from public;
grant execute on function public.sales_intelligence_write_policy_evaluation(uuid, jsonb) to service_role;

comment on function public.sales_intelligence_write_policy_evaluation(uuid, jsonb) is
  'Phase H.1B. Atomic supersede+insert for sales_intelligence_policy_evaluations, serialized per analysis_id via pg_advisory_xact_lock. Never creates a new semantic analysis. service_role only. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md §26.';
