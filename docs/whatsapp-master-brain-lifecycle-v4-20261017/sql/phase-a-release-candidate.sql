-- CANDIDATE ONLY: fresh precheck, paused ingest/refresh/archive writers, explicit approval required.
-- One atomic install transaction. Do not activate the runtime before postcheck.
BEGIN;

-- phase-a-candidate.sql
-- CANDIDATE ONLY. Never applied to Production in Batch 4.
DO $$ BEGIN
IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.sales_intelligence_reconcile_case_set_v1(uuid,text[])'::regprocedure) IS DISTINCT FROM '9fd2f5976e2419ca7154d203b29da5fc'
OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.sales_intelligence_write_case_analysis(text,jsonb)'::regprocedure) IS DISTINCT FROM 'c6c53c94a20cfdbf2946371398790d98' THEN RAISE EXCEPTION 'baseline drift'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.sales_intelligence_stage_case_analysis_v1(p_case_id text, p_row jsonb)
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
  where case_id = p_case_id and superseded_at is null
    and semantic_source_hash = (p_row->>'semantic_source_hash')
    and pipeline_version = (p_row->>'pipeline_version')
    and engine_version_case_segmentation = (p_row->>'engine_version_case_segmentation')
    and engine_version_historical_closure = (p_row->>'engine_version_historical_closure')
    and engine_version_commercial_confirmation = (p_row->>'engine_version_commercial_confirmation')
    and engine_version_protocol_applicability = (p_row->>'engine_version_protocol_applicability')
  order by is_current desc, analyzed_at desc, analysis_id
  limit 1 for update;
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
  v_new.analysis_version := coalesce((select max(analysis_version) from public.sales_intelligence_case_analyses where case_id = p_case_id), 0) + 1;
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

  -- Stage only. Reconciliation alone supersedes/promotes current analyses and pointers.

  return jsonb_build_object('is_new', true) || to_jsonb(v_new);
end;
$function$;

ALTER FUNCTION public.sales_intelligence_stage_case_analysis_v1(text,jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sales_intelligence_stage_case_analysis_v1(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_intelligence_stage_case_analysis_v1(text,jsonb) TO postgres, service_role;
CREATE OR REPLACE FUNCTION public.sales_intelligence_reconcile_case_set_v2(p_conversation_id uuid, p_active_case_ids text[], p_analysis_ids jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_active_case_ids text[] := coalesce(p_active_case_ids, '{}'::text[]);
  v_invalid_case_ids text[] := '{}'::text[];
  v_unpublishable_case_ids text[] := '{}'::text[];
  v_local_retired_case_ids text[] := '{}'::text[];
  v_cross_retired_case_ids text[] := '{}'::text[];
  v_retired_case_ids text[] := '{}'::text[];
  v_reactivated_case_ids text[] := '{}'::text[];
  v_superseded_source_ids uuid[] := '{}'::uuid[];
  v_lock_source_ids uuid[] := '{}'::uuid[];
  v_published_analysis_ids jsonb := '{}'::jsonb;
  v_current_source record;
  v_current_owner_count integer := 0;
  v_source_id uuid;
  v_case record;
  v_v22_id uuid;
  v_proof_sales_case_id text;
begin
  if p_conversation_id is null then
    return jsonb_build_object('ok', false, 'status', 'conversation_id_required');
  end if;

  select
    s.id,
    s.source_filename,
    s.raw_text,
    s.conversation_started_at,
    s.conversation_ended_at,
    s.review_status
    into v_current_source
  from public.whatsapp_review_sources s
  where s.id = p_conversation_id;

  if found then
    select count(distinct wc.id)::integer
      into v_current_owner_count
    from public.whatsapp_customer_cases_v22 wc
    where wc.root_source_id = p_conversation_id
       or p_conversation_id = any(coalesce(wc.source_ids, '{}'::uuid[]));

    if v_current_owner_count = 1
       and coalesce(v_current_source.review_status, '') <> 'archived'
       and nullif(v_current_source.source_filename, '') is not null
       and nullif(v_current_source.raw_text, '') is not null
       and v_current_source.conversation_started_at is not null
       and v_current_source.conversation_ended_at is not null then
      select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
        into v_superseded_source_ids
      from public.whatsapp_review_sources s
      where s.id <> p_conversation_id
        and coalesce(s.review_status, '') <> 'archived'
        and s.source_filename = v_current_source.source_filename
        and s.conversation_started_at is not null
        and s.conversation_ended_at is not null
        and s.conversation_started_at <= v_current_source.conversation_started_at
        and s.conversation_ended_at >= v_current_source.conversation_ended_at
        and nullif(s.raw_text, '') is not null
        and position(v_current_source.raw_text in s.raw_text) > 0;
    end if;
  end if;

  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[])
    into v_lock_source_ids
  from (
    select distinct unnest(array_prepend(p_conversation_id, v_superseded_source_ids)) as id
  ) x;

  foreach v_source_id in array v_lock_source_ids loop
    perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:' || v_source_id::text));
  end loop;

  -- Serialize source state with archival; never reactivate an archived source.
  select s.review_status into v_current_source
  from public.whatsapp_review_sources s where s.id = p_conversation_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'status', 'source_not_found');
  end if;
  if v_current_source.review_status = 'archived' then
    v_active_case_ids := '{}'::text[];
    v_superseded_source_ids := '{}'::uuid[];
  end if;
  if cardinality(v_active_case_ids) <> (select count(distinct x) from unnest(v_active_case_ids) x)
     or exists(select 1 from unnest(v_active_case_ids) x where x is null) then
    return jsonb_build_object('ok', false, 'status', 'invalid_active_case_set');
  end if;

  select coalesce(array_agg(x.case_id order by x.case_id), '{}'::text[])
    into v_invalid_case_ids
  from unnest(v_active_case_ids) as x(case_id)
  where not exists (
    select 1
    from public.sales_intelligence_cases c
    where c.case_id = x.case_id
      and c.conversation_id = p_conversation_id
  );

  if cardinality(v_invalid_case_ids) > 0 then
    return jsonb_build_object(
      'ok', false,
      'status', 'active_case_not_owned_by_conversation',
      'conversationId', p_conversation_id,
      'invalidCaseIds', to_jsonb(v_invalid_case_ids)
    );
  end if;

  -- Lock cases in stable order, sharing analysis-writer locks.
  for v_case in select c.case_id from public.sales_intelligence_cases c
    where c.conversation_id = p_conversation_id order by c.case_id
  loop
    perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:' || v_case.case_id));
  end loop;
  select coalesce(array_agg(x.case_id order by x.case_id), '{}'::text[])
    into v_unpublishable_case_ids
  from unnest(v_active_case_ids) as x(case_id)
  where (
    select count(*)
    from public.sales_intelligence_case_analyses ca
    where ca.case_id = x.case_id
      and ca.analysis_id::text = p_analysis_ids->>x.case_id
      and ca.superseded_at is null
      and not exists (select 1 from public.sales_intelligence_case_analyses newer
        where newer.case_id = ca.case_id and newer.is_current
          and newer.analysis_version > ca.analysis_version)
  ) <> 1;

  if cardinality(v_unpublishable_case_ids) > 0 then
    return jsonb_build_object(
      'ok', false,
      'status', 'active_case_current_analysis_not_unique',
      'conversationId', p_conversation_id,
      'unpublishableCaseIds', to_jsonb(v_unpublishable_case_ids)
    );
  end if;

  -- Validation completed for the entire source before any lifecycle write.
  update public.sales_intelligence_case_analyses ca
  set is_current = false, superseded_at = now(),
      superseded_by_analysis_id = (p_analysis_ids->>ca.case_id)::uuid
  where ca.case_id = any(v_active_case_ids) and ca.is_current
    and ca.analysis_id::text <> p_analysis_ids->>ca.case_id;
  update public.sales_intelligence_case_analyses ca
  set is_current = true
  where ca.case_id = any(v_active_case_ids)
    and ca.analysis_id::text = p_analysis_ids->>ca.case_id
    and ca.superseded_at is null;

  select coalesce(array_agg(c.case_id order by c.case_id), '{}'::text[])
    into v_reactivated_case_ids
  from public.sales_intelligence_cases c
  where c.conversation_id = p_conversation_id
    and c.case_id = any(v_active_case_ids)
    and c.is_active = false;

  update public.sales_intelligence_cases c
     set is_active = true,
         published_analysis_id = ca.analysis_id,
         retired_at = null,
         retire_reason = null
    from public.sales_intelligence_case_analyses ca
   where c.conversation_id = p_conversation_id
     and c.case_id = any(v_active_case_ids)
     and ca.case_id = c.case_id
     and ca.is_current = true;

  select coalesce(jsonb_object_agg(c.case_id, c.published_analysis_id::text), '{}'::jsonb)
    into v_published_analysis_ids
  from public.sales_intelligence_cases c
  where c.conversation_id = p_conversation_id
    and c.case_id = any(v_active_case_ids)
    and c.is_active = true;

  with retired as (
    update public.sales_intelligence_cases c
       set is_active = false,
           retired_at = coalesce(c.retired_at, now()),
           published_analysis_id = null,
           retire_reason = case when v_current_source.review_status = 'archived' then 'archived_source' else 'latest_segmentation_case_set' end
     where c.conversation_id = p_conversation_id
       and (c.is_active = true OR (v_current_source.review_status = 'archived' AND (
         c.published_analysis_id is not null OR c.retired_at is null
         OR c.retire_reason is distinct from 'archived_source'
         OR exists(select 1 from public.sales_intelligence_case_analyses a where a.case_id=c.case_id and a.is_current))))
       and not (c.case_id = any(v_active_case_ids))
    returning c.case_id
  )
  select coalesce(array_agg(case_id order by case_id), '{}'::text[])
    into v_local_retired_case_ids
  from retired;

  if cardinality(v_superseded_source_ids) > 0 then
    with retired as (
      update public.sales_intelligence_cases c
         set is_active = false,
             retired_at = now(),
             published_analysis_id = null,
             retire_reason = 'superseded_by_finer_canonical_source'
       where c.conversation_id = any(v_superseded_source_ids)
         and c.is_active = true
      returning c.case_id
    )
    select coalesce(array_agg(case_id order by case_id), '{}'::text[])
      into v_cross_retired_case_ids
    from retired;
  end if;

  select coalesce(array_agg(distinct x.case_id order by x.case_id), '{}'::text[])
    into v_retired_case_ids
  from unnest(v_local_retired_case_ids || v_cross_retired_case_ids) as x(case_id);

  if cardinality(v_retired_case_ids) > 0 then
    update public.sales_intelligence_case_analyses
    set is_current = false, superseded_at = now(), superseded_by_analysis_id = null
    where case_id = any(v_retired_case_ids) and is_current = true;
    update public.conversation_sales_reviews r
       set is_current = false,
           superseded_at = now(),
           superseded_reason = 'sales_intelligence_case_retired',
           updated_at = now()
     where r.evaluation_kind = 'automatic'
       and r.sales_intelligence_case_id = any(v_retired_case_ids)
       and r.is_current = true;
  end if;

  for v_case in
    select c.case_id, c.source_case_id_v22, c.retire_reason
    from public.sales_intelligence_cases c
    where c.case_id = any(v_retired_case_ids)
      and nullif(trim(coalesce(c.source_case_id_v22, '')), '') is not null
  loop
    begin
      v_v22_id := v_case.source_case_id_v22::uuid;
    exception when invalid_text_representation then
      v_v22_id := null;
    end;

    if v_v22_id is null then
      continue;
    end if;

    select wc.case_json #>> '{canonicalSaleProof,salesCaseId}'
      into v_proof_sales_case_id
    from public.whatsapp_customer_cases_v22 wc
    where wc.id = v_v22_id;

    if v_proof_sales_case_id = v_case.case_id then
      perform public.dawaa_revoke_whatsapp_canonical_sale_proof_v46(
        v_v22_id,
        'sales_intelligence_case_retired',
        jsonb_build_object(
          'salesCaseId', v_case.case_id,
          'conversationId', p_conversation_id,
          'retiredAt', now(),
          'reason', coalesce(v_case.retire_reason, 'sales_intelligence_case_retired')
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'status', 'reconciled',
    'conversationId', p_conversation_id,
    'activeCaseIds', to_jsonb(v_active_case_ids),
    'publishedAnalysisIds', v_published_analysis_ids,
    'retiredCaseIds', to_jsonb(v_retired_case_ids),
    'reactivatedCaseIds', to_jsonb(v_reactivated_case_ids),
    'supersededSourceIds', to_jsonb(v_superseded_source_ids)
  );
end;
$function$;

ALTER FUNCTION public.sales_intelligence_reconcile_case_set_v2(uuid,text[],jsonb) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sales_intelligence_reconcile_case_set_v2(uuid,text[],jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sales_intelligence_reconcile_case_set_v2(uuid,text[],jsonb) TO postgres, service_role;



-- archive-writer-candidate.sql
-- CANDIDATE ONLY. Exact Production v35 minus SI case deletion.
DO $$ BEGIN
IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.dawaa_archive_superseded_whatsapp_source_v35(text,timestamptz,timestamptz,integer,uuid[])'::regprocedure) IS DISTINCT FROM 'fd7b5e40f631e4633049147cb2933ee7' THEN RAISE EXCEPTION 'archive writer drift'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.dawaa_archive_superseded_whatsapp_source_v35(p_source_filename text, p_full_started_at timestamp with time zone, p_full_ended_at timestamp with time zone, p_full_message_count integer, p_replacement_source_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor uuid;
  v_source public.whatsapp_review_sources%rowtype;
  v_candidate_count integer := 0;
  v_case_ids uuid[] := '{}';
  v_journey_ids uuid[] := '{}';
  v_deleted_cases integer := 0;
  v_deleted_sales_cases integer := 0;
  v_deleted_actions integer := 0;
  v_deleted_evidence integer := 0;
  v_deleted_response_turns integer := 0;
  v_deleted_opportunities integer := 0;
  v_deleted_story_events integer := 0;
  v_deleted_journeys integer := 0;
begin
  v_actor := public.dawaa_current_staff_account_id_strict();
  if v_actor is null
     or not public.dawaa_current_actor_can(array['edit_reviews','approve_reviews']) then
    raise exception using errcode='42501', message='review_edit_or_approve_permission_required';
  end if;

  if coalesce(array_length(p_replacement_source_ids, 1), 0) < 2 then
    return jsonb_build_object('archived',0,'deletedCases',0,'skippedReason','replacement_sources_less_than_two');
  end if;

  select count(*) into v_candidate_count
  from public.whatsapp_review_sources s
  where s.source_filename = p_source_filename
    and s.conversation_started_at = p_full_started_at
    and s.conversation_ended_at = p_full_ended_at
    and s.message_count = p_full_message_count
    and coalesce(s.review_status, '') <> 'archived'
    and not (s.id = any(p_replacement_source_ids));

  if v_candidate_count = 0 then
    return jsonb_build_object('archived',0,'deletedCases',0,'skippedReason','no_legacy_monolithic_source');
  end if;

  if v_candidate_count > 1 then
    return jsonb_build_object('archived',0,'deletedCases',0,'skippedReason','multiple_legacy_candidates');
  end if;

  select * into v_source
  from public.whatsapp_review_sources s
  where s.source_filename = p_source_filename
    and s.conversation_started_at = p_full_started_at
    and s.conversation_ended_at = p_full_ended_at
    and s.message_count = p_full_message_count
    and coalesce(s.review_status, '') <> 'archived'
    and not (s.id = any(p_replacement_source_ids))
  limit 1
  for update;

  if coalesce(v_source.reviewer_confirmed, false)
     or coalesce(v_source.invoice_link_confirmed, false)
     or v_source.invoice_link_confirmed_invoice_id is not null then
    return jsonb_build_object('archived',0,'deletedCases',0,'skippedReason','legacy_source_has_human_confirmation');
  end if;

  if exists (select 1 from public.conversation_sales_reviews r where r.whatsapp_review_source_id = v_source.id) then
    return jsonb_build_object('archived',0,'deletedCases',0,'skippedReason','legacy_source_has_official_review');
  end if;

  if exists (
    select 1 from public.whatsapp_conversation_actions a
    where a.source_id = v_source.id
      and (
        a.assigned_to_id is not null or a.assigned_at is not null
        or (a.work_status is not null and a.work_status <> 'unassigned')
        or a.started_at is not null or a.completed_at is not null
        or a.outcome is not null or a.outcome_note is not null
        or coalesce(a.followup_attempts,0) > 0 or a.last_followup_at is not null
        or a.recovered_invoice_id is not null or a.recovered_at is not null
      )
  ) then
    return jsonb_build_object('archived',0,'deletedCases',0,'skippedReason','legacy_source_has_worked_action');
  end if;

  select coalesce(array_agg(c.id), '{}'::uuid[]) into v_case_ids
  from public.whatsapp_customer_cases_v22 c
  where c.root_source_id = v_source.id or v_source.id = any(c.source_ids);

  if exists (
    select 1 from public.whatsapp_customer_cases_v22 c
    where c.id = any(v_case_ids)
      and (
        c.confirmed_outcome is not null or c.outcome_reviewed_by is not null
        or c.outcome_reviewed_at is not null or c.confirmed_lost_reason is not null
        or c.verified_invoice_id is not null or c.verified_revenue is not null
      )
  ) then
    return jsonb_build_object('archived',0,'deletedCases',0,'skippedReason','legacy_case_has_human_or_verified_state');
  end if;

  select coalesce(array_agg(j.id), '{}'::uuid[]) into v_journey_ids
  from public.whatsapp_customer_journeys j
  where j.root_source_id = v_source.id;

  if exists (
    select 1 from public.whatsapp_customer_journey_sessions js
    where js.journey_id = any(v_journey_ids) and js.source_id <> v_source.id
  ) then
    return jsonb_build_object('archived',0,'deletedCases',0,'skippedReason','legacy_journey_shared_with_other_sources');
  end if;

  delete from public.whatsapp_customer_cases_v22 c where c.id = any(v_case_ids);
  get diagnostics v_deleted_cases = row_count;

  -- Preserve SI cases/analysis history. The source archival trigger calls canonical reconcile.
  v_deleted_sales_cases := 0;

  delete from public.whatsapp_conversation_actions a where a.source_id = v_source.id;
  get diagnostics v_deleted_actions = row_count;

  delete from public.whatsapp_evidence_facts_v17 e where e.source_id = v_source.id;
  get diagnostics v_deleted_evidence = row_count;

  delete from public.whatsapp_response_turns_v18 r where r.source_id = v_source.id;
  get diagnostics v_deleted_response_turns = row_count;

  delete from public.whatsapp_sales_opportunities_v17 o where o.root_source_id = v_source.id;
  get diagnostics v_deleted_opportunities = row_count;

  delete from public.whatsapp_customer_story_events e where e.source_id = v_source.id;
  get diagnostics v_deleted_story_events = row_count;

  delete from public.whatsapp_customer_journeys j where j.id = any(v_journey_ids);
  get diagnostics v_deleted_journeys = row_count;

  update public.whatsapp_review_sources s
  set review_status='archived',
      analysis_status='analyzed',
      analysis_json=coalesce(s.analysis_json,'{}'::jsonb) || jsonb_build_object(
        'supersededLegacySourceV35',
        jsonb_build_object(
          'archivedAt',now(),
          'replacementSourceIds',to_jsonb(p_replacement_source_ids),
          'reason','legacy_monolithic_source_replaced_by_case_scoped_sources'
        )
      ),
      updated_at=now()
  where s.id=v_source.id;

  return jsonb_build_object(
    'archived',1,
    'archivedSourceId',v_source.id,
    'replacementSourceIds',to_jsonb(p_replacement_source_ids),
    'deletedCases',v_deleted_cases,
    'deletedDerived',jsonb_build_object(
      'sales_intelligence_cases',v_deleted_sales_cases,
      'whatsapp_conversation_actions',v_deleted_actions,
      'whatsapp_evidence_facts_v17',v_deleted_evidence,
      'whatsapp_response_turns_v18',v_deleted_response_turns,
      'whatsapp_sales_opportunities_v17',v_deleted_opportunities,
      'whatsapp_customer_story_events',v_deleted_story_events,
      'whatsapp_customer_journeys',v_deleted_journeys
    ),
    'skippedReason',null
  );
end;
$function$;
ALTER FUNCTION public.dawaa_archive_superseded_whatsapp_source_v35(text,timestamptz,timestamptz,integer,uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.dawaa_archive_superseded_whatsapp_source_v35(text,timestamptz,timestamptz,integer,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.dawaa_archive_superseded_whatsapp_source_v35(text,timestamptz,timestamptz,integer,uuid[]) TO postgres,anon,authenticated,service_role;


-- archive-candidate.sql
-- CANDIDATE ONLY: future archival events, not historical repair.
CREATE OR REPLACE FUNCTION public.sales_intelligence_on_source_archived_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public, pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  result := public.sales_intelligence_reconcile_case_set_v2(NEW.id, '{}'::text[], '{}'::jsonb);
  IF result->>'ok' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'archival lifecycle reconciliation failed: %', result->>'status';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.sales_intelligence_on_source_archived_v1() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sales_intelligence_on_source_archived_v1() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sales_intelligence_source_archived_v1
AFTER UPDATE OF review_status ON public.whatsapp_review_sources
FOR EACH ROW WHEN (NEW.review_status = 'archived' AND OLD.review_status IS DISTINCT FROM NEW.review_status)
EXECUTE FUNCTION public.sales_intelligence_on_source_archived_v1();

COMMIT;
