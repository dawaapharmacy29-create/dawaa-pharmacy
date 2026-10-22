CREATE OR REPLACE FUNCTION public.sales_intelligence_write_case_analysis(p_case_id text, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

ALTER FUNCTION public.sales_intelligence_write_case_analysis(text, jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sales_intelligence_write_case_analysis(text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_intelligence_write_case_analysis(text, jsonb) TO postgres, service_role;
