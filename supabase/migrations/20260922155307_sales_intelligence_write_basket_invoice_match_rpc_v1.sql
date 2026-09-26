-- Sales Intelligence Phase H.1B — atomic supersede+insert RPC for
-- sales_intelligence_basket_invoice_matches. Scoped to analysis_id — matches the table's own
-- partial-unique current constraint, which is on (analysis_id) where is_current_evaluation = true,
-- not (analysis_id, attribution_row_id). Idempotency: same analysis_id + attribution_row_id +
-- matching_input_hash + matching_engine_version => no new row.
--
-- This body already reflects the same defaults-coalescing and insert-as-false / retire-old /
-- flip-new-current ordering fixes as sales_intelligence_write_case_analysis (see that migration's
-- comment and design doc §26/§27).
create or replace function public.sales_intelligence_write_basket_invoice_match(
  p_analysis_id uuid,
  p_row jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.sales_intelligence_basket_invoice_matches;
  v_new public.sales_intelligence_basket_invoice_matches;
  v_new_id uuid := gen_random_uuid();
  v_found boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_basket_invoice_matches:' || p_analysis_id::text));

  select * into v_existing
  from public.sales_intelligence_basket_invoice_matches
  where analysis_id = p_analysis_id and is_current_evaluation = true
  for update;
  v_found := found;

  if v_found
     and v_existing.attribution_row_id = (p_row->>'attribution_row_id')::uuid
     and v_existing.matching_input_hash = (p_row->>'matching_input_hash')
     and v_existing.matching_engine_version = (p_row->>'matching_engine_version')
  then
    return jsonb_build_object('is_new', false) || to_jsonb(v_existing);
  end if;

  v_new := jsonb_populate_record(null::public.sales_intelligence_basket_invoice_matches, p_row);
  v_new.id := v_new_id;
  v_new.analysis_id := p_analysis_id;
  v_new.evaluation_version := coalesce(v_existing.evaluation_version, 0) + 1;
  v_new.is_current_evaluation := false;
  v_new.superseded_at := null;
  v_new.superseded_by_evaluation_version := null;
  v_new.evaluated_at := coalesce(v_new.evaluated_at, now());
  v_new.header_evidence_ready := coalesce(v_new.header_evidence_ready, false);
  v_new.item_evidence_ready := coalesce(v_new.item_evidence_ready, false);
  v_new.differences := coalesce(v_new.differences, '[]'::jsonb);
  v_new.needs_human_review := coalesce(v_new.needs_human_review, false);
  v_new.human_review_reasons := coalesce(v_new.human_review_reasons, '{}');

  insert into public.sales_intelligence_basket_invoice_matches select (v_new).*;

  if v_found then
    update public.sales_intelligence_basket_invoice_matches
    set is_current_evaluation = false, superseded_at = now(), superseded_by_evaluation_version = v_new.evaluation_version
    where id = v_existing.id;
  end if;

  update public.sales_intelligence_basket_invoice_matches
  set is_current_evaluation = true
  where id = v_new_id;
  v_new.is_current_evaluation := true;

  return jsonb_build_object('is_new', true) || to_jsonb(v_new);
end;
$$;

revoke all on function public.sales_intelligence_write_basket_invoice_match(uuid, jsonb) from public;
grant execute on function public.sales_intelligence_write_basket_invoice_match(uuid, jsonb) to service_role;

comment on function public.sales_intelligence_write_basket_invoice_match(uuid, jsonb) is
  'Phase H.1B. Atomic supersede+insert for sales_intelligence_basket_invoice_matches, serialized per analysis_id via pg_advisory_xact_lock. References the exact attribution row, never "whichever is current". service_role only. See docs/SALES_INTELLIGENCE_PERSISTENCE_DESIGN.md §26.';
