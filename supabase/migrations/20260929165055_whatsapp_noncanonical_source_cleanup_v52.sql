-- V52: retire the 13 known non-operational WhatsApp sources without deleting history.
--
-- This is a data cleanup only. The canonical operational owner remains
-- public.whatsapp_operational_canonical_sources_v1 (V51).
--
-- Selection is rule-based, never hard-coded by source id:
--   old "fuller snapshot wins" canonical rows MINUS current operational owner.
-- On the live 2026-09-29 dataset this must resolve to exactly 13 sources and 47 actions.
-- A fresh database with zero matching rows is a no-op. Any partial/unexpected live shape fails closed.
--
-- Changes:
--   * 13 sources -> review_status='archived'
--   * preserve prior source status in analysis_json.sourceLifecycleV50
--   * 47 actions -> status='dismissed', work_status='cancelled'
--   * preserve prior action state in payload.retiredV50
--   * append 13 whatsapp_review_audit rows
--
-- Explicitly NOT changed:
--   raw_text, evidence facts, story events, journey sessions, SI cases/analyses/attributions,
--   response turns, automatic follow-ups, invoice truth, or canonical V22 ownership.

do $cleanup$
declare
  v_ids uuid[];
  v_source_count int;
  v_action_count int;
  v_marked_count int;
  v_audit_before int;
  v_audit_after int;
begin
  with src as (
    select s.*,
           lower(trim(coalesce(s.source_filename,''))) fn,
           lower(trim(coalesce(s.customer_code,''))) cc,
           regexp_replace(lower(trim(coalesce(s.customer_phone,''))), '\\D','','g') ph,
           lower(trim(coalesce(s.customer_name,''))) nm
    from public.whatsapp_review_sources s
  ),
  old_canonical as (
    select i.id
    from src i
    where not exists (
      select 1
      from src o
      where o.id <> i.id
        and o.fn <> ''
        and o.fn = i.fn
        and (
          (i.customer_id is not null and o.customer_id is not null and o.customer_id = i.customer_id)
          or (
            not (i.customer_id is not null and o.customer_id is not null)
            and i.cc <> '' and o.cc <> '' and o.cc = i.cc
          )
          or (
            not (i.customer_id is not null and o.customer_id is not null)
            and not (i.cc <> '' and o.cc <> '')
            and i.ph <> '' and o.ph <> '' and o.ph = i.ph
          )
          or (
            not (i.customer_id is not null and o.customer_id is not null)
            and not (i.cc <> '' and o.cc <> '')
            and not (i.ph <> '' and o.ph <> '')
            and i.nm <> '' and o.nm <> '' and o.nm = i.nm
          )
        )
        and o.conversation_started_at <= i.conversation_started_at
        and o.conversation_ended_at >= i.conversation_ended_at
        and (
          coalesce(o.message_count,0) > coalesce(i.message_count,0)
          or (
            coalesce(o.message_count,0) = coalesce(i.message_count,0)
            and coalesce(o.created_at,'epoch'::timestamptz) > coalesce(i.created_at,'epoch'::timestamptz)
          )
        )
    )
  )
  select array_agg(s.id order by s.id)
  into v_ids
  from public.whatsapp_review_sources s
  join old_canonical oc on oc.id = s.id
  left join public.whatsapp_operational_canonical_sources_v1 op on op.source_id = s.id
  where op.source_id is null;

  v_source_count := coalesce(cardinality(v_ids),0);

  -- Clean/fresh installs have no historical rows to retire.
  if v_source_count = 0 then
    return;
  end if;

  select count(*) into v_marked_count
  from public.whatsapp_review_sources s
  where s.id = any(v_ids)
    and s.analysis_json ? 'sourceLifecycleV50';

  -- Re-applying against the already-cleaned live dataset is a no-op.
  if v_source_count = 13 and v_marked_count = 13 then
    return;
  end if;

  if v_marked_count <> 0 then
    raise exception 'V52 partial cleanup marker state: % of % sources already marked', v_marked_count, v_source_count;
  end if;

  if v_source_count <> 13 then
    raise exception 'V52 expected 13 non-operational cleanup sources, found %', v_source_count;
  end if;

  select count(*) into v_action_count
  from public.whatsapp_conversation_actions
  where source_id = any(v_ids);

  if v_action_count <> 47 then
    raise exception 'V52 expected 47 actions for cleanup sources, found %', v_action_count;
  end if;

  if exists (
    select 1
    from public.whatsapp_review_sources
    where id = any(v_ids)
      and review_status = 'archived'
  ) then
    raise exception 'V52 found pre-archived cleanup source before marker write';
  end if;

  if exists (
    select 1
    from public.whatsapp_evidence_facts_v17
    where source_id = any(v_ids)
      and official_eligible is true
  ) then
    raise exception 'V52 refuses cleanup while an official-eligible fact remains on a target source';
  end if;

  if exists (
    select 1
    from public.whatsapp_conversation_actions
    where source_id = any(v_ids)
      and (status not in ('proposed','ready') or work_status <> 'unassigned')
  ) then
    raise exception 'V52 unexpected action workflow state on cleanup sources';
  end if;

  select count(*) into v_audit_before
  from public.whatsapp_review_audit;

  insert into public.whatsapp_review_audit(
    source_id,
    action,
    actor_id,
    actor_name,
    actor_role,
    before_state,
    after_state,
    note
  )
  select
    s.id,
    'noncanonical_source_retired_v50',
    null,
    'system',
    'system',
    jsonb_build_object(
      'review_status', s.review_status,
      'analysis_json', s.analysis_json
    ),
    jsonb_build_object(
      'review_status', 'archived',
      'sourceLifecycleV50', jsonb_build_object(
        'state','historical_non_operational',
        'reason','canonical_source_cleanup',
        'previousReviewStatus',s.review_status,
        'ownerView','whatsapp_operational_canonical_sources_v1'
      )
    ),
    'Historical/non-operational source retained; current readers use whatsapp_operational_canonical_sources_v1.'
  from public.whatsapp_review_sources s
  where s.id = any(v_ids);

  update public.whatsapp_review_sources s
  set review_status = 'archived',
      analysis_json = coalesce(s.analysis_json,'{}'::jsonb) || jsonb_build_object(
        'sourceLifecycleV50',
        jsonb_build_object(
          'state','historical_non_operational',
          'reason','canonical_source_cleanup',
          'previousReviewStatus',s.review_status,
          'retiredAt',clock_timestamp(),
          'ownerView','whatsapp_operational_canonical_sources_v1'
        )
      )
  where s.id = any(v_ids);

  update public.whatsapp_conversation_actions a
  set status = 'dismissed',
      work_status = 'cancelled',
      payload = coalesce(a.payload,'{}'::jsonb) || jsonb_build_object(
        'retiredV50',
        jsonb_build_object(
          'reason','source_became_historical_non_operational',
          'previousStatus',a.status,
          'previousWorkStatus',a.work_status,
          'retiredAt',clock_timestamp()
        )
      ),
      updated_at = now()
  where a.source_id = any(v_ids);

  if (select count(*) from public.whatsapp_review_sources where id=any(v_ids) and review_status='archived') <> 13 then
    raise exception 'V52 source archive postcondition failed';
  end if;

  if (
    select count(*)
    from public.whatsapp_conversation_actions
    where source_id=any(v_ids) and status='dismissed' and work_status='cancelled'
  ) <> 47 then
    raise exception 'V52 action retirement postcondition failed';
  end if;

  select count(*) into v_audit_after
  from public.whatsapp_review_audit;

  if v_audit_after - v_audit_before <> 13 then
    raise exception 'V52 expected 13 audit rows, wrote %', v_audit_after - v_audit_before;
  end if;
end
$cleanup$;
