create or replace function public.dawaa_archive_superseded_whatsapp_source_v35(
  p_source_filename text,
  p_full_started_at timestamptz,
  p_full_ended_at timestamptz,
  p_full_message_count integer,
  p_replacement_source_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    return jsonb_build_object(
      'archived', 0,
      'deletedCases', 0,
      'skippedReason', 'replacement_sources_less_than_two'
    );
  end if;

  select count(*)
    into v_candidate_count
  from public.whatsapp_review_sources s
  where s.source_filename = p_source_filename
    and s.conversation_started_at = p_full_started_at
    and s.conversation_ended_at = p_full_ended_at
    and s.message_count = p_full_message_count
    and coalesce(s.review_status, '') <> 'archived'
    and not (s.id = any(p_replacement_source_ids));

  if v_candidate_count = 0 then
    return jsonb_build_object(
      'archived', 0,
      'deletedCases', 0,
      'skippedReason', 'no_legacy_monolithic_source'
    );
  end if;

  if v_candidate_count > 1 then
    return jsonb_build_object(
      'archived', 0,
      'deletedCases', 0,
      'skippedReason', 'multiple_legacy_candidates'
    );
  end if;

  select *
    into v_source
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
    return jsonb_build_object(
      'archived', 0,
      'deletedCases', 0,
      'skippedReason', 'legacy_source_has_human_confirmation'
    );
  end if;

  if exists (
    select 1
    from public.conversation_sales_reviews r
    where r.whatsapp_review_source_id = v_source.id
  ) then
    return jsonb_build_object(
      'archived', 0,
      'deletedCases', 0,
      'skippedReason', 'legacy_source_has_official_review'
    );
  end if;

  if exists (
    select 1
    from public.whatsapp_conversation_actions a
    where a.source_id = v_source.id
      and (
        a.assigned_to_id is not null
        or a.assigned_at is not null
        or (a.work_status is not null and a.work_status <> 'unassigned')
        or a.started_at is not null
        or a.completed_at is not null
        or a.outcome is not null
        or a.outcome_note is not null
        or coalesce(a.followup_attempts,0) > 0
        or a.last_followup_at is not null
        or a.recovered_invoice_id is not null
        or a.recovered_at is not null
      )
  ) then
    return jsonb_build_object(
      'archived', 0,
      'deletedCases', 0,
      'skippedReason', 'legacy_source_has_worked_action'
    );
  end if;

  select coalesce(array_agg(c.id), '{}'::uuid[])
    into v_case_ids
  from public.whatsapp_customer_cases_v22 c
  where c.root_source_id = v_source.id
     or v_source.id = any(c.source_ids);

  if exists (
    select 1
    from public.whatsapp_customer_cases_v22 c
    where c.id = any(v_case_ids)
      and (
        c.confirmed_outcome is not null
        or c.outcome_reviewed_by is not null
        or c.outcome_reviewed_at is not null
        or c.confirmed_lost_reason is not null
        or c.verified_invoice_id is not null
        or c.verified_revenue is not null
      )
  ) then
    return jsonb_build_object(
      'archived', 0,
      'deletedCases', 0,
      'skippedReason', 'legacy_case_has_human_or_verified_state'
    );
  end if;

  select coalesce(array_agg(j.id), '{}'::uuid[])
    into v_journey_ids
  from public.whatsapp_customer_journeys j
  where j.root_source_id = v_source.id;

  if exists (
    select 1
    from public.whatsapp_customer_journey_sessions js
    where js.journey_id = any(v_journey_ids)
      and js.source_id <> v_source.id
  ) then
    return jsonb_build_object(
      'archived', 0,
      'deletedCases', 0,
      'skippedReason', 'legacy_journey_shared_with_other_sources'
    );
  end if;

  delete from public.whatsapp_customer_cases_v22 c
  where c.id = any(v_case_ids);
  get diagnostics v_deleted_cases = row_count;

  delete from public.sales_intelligence_cases c
  where c.conversation_id = v_source.id;
  get diagnostics v_deleted_sales_cases = row_count;

  delete from public.whatsapp_conversation_actions a
  where a.source_id = v_source.id;
  get diagnostics v_deleted_actions = row_count;

  delete from public.whatsapp_evidence_facts_v17 e
  where e.source_id = v_source.id;
  get diagnostics v_deleted_evidence = row_count;

  delete from public.whatsapp_response_turns_v18 r
  where r.source_id = v_source.id;
  get diagnostics v_deleted_response_turns = row_count;

  delete from public.whatsapp_sales_opportunities_v17 o
  where o.root_source_id = v_source.id;
  get diagnostics v_deleted_opportunities = row_count;

  delete from public.whatsapp_customer_story_events e
  where e.source_id = v_source.id;
  get diagnostics v_deleted_story_events = row_count;

  delete from public.whatsapp_customer_journeys j
  where j.id = any(v_journey_ids);
  get diagnostics v_deleted_journeys = row_count;

  update public.whatsapp_review_sources s
  set review_status = 'archived',
      analysis_status = 'analyzed',
      analysis_json = coalesce(s.analysis_json, '{}'::jsonb) || jsonb_build_object(
        'supersededLegacySourceV35',
        jsonb_build_object(
          'archivedAt', now(),
          'replacementSourceIds', to_jsonb(p_replacement_source_ids),
          'reason', 'legacy_monolithic_source_replaced_by_case_scoped_sources'
        )
      ),
      updated_at = now()
  where s.id = v_source.id;

  return jsonb_build_object(
    'archived', 1,
    'archivedSourceId', v_source.id,
    'replacementSourceIds', to_jsonb(p_replacement_source_ids),
    'deletedCases', v_deleted_cases,
    'deletedDerived', jsonb_build_object(
      'sales_intelligence_cases', v_deleted_sales_cases,
      'whatsapp_conversation_actions', v_deleted_actions,
      'whatsapp_evidence_facts_v17', v_deleted_evidence,
      'whatsapp_response_turns_v18', v_deleted_response_turns,
      'whatsapp_sales_opportunities_v17', v_deleted_opportunities,
      'whatsapp_customer_story_events', v_deleted_story_events,
      'whatsapp_customer_journeys', v_deleted_journeys
    ),
    'skippedReason', null
  );
end;
$$;

revoke all on function public.dawaa_archive_superseded_whatsapp_source_v35(
  text,timestamptz,timestamptz,integer,uuid[]
) from public;

grant execute on function public.dawaa_archive_superseded_whatsapp_source_v35(
  text,timestamptz,timestamptz,integer,uuid[]
) to authenticated;
