-- Sales Intelligence case lifecycle v2: retire coarse superseded sources atomically.
--
-- Root cause fixed here:
-- a WhatsApp export can be re-segmented from one coarse review source into multiple finer sources.
-- The Canonical Source Gate already rejects the coarse source when a finer V22-owned source is
-- contained inside it, but lifecycle publication historically reconciled only one conversation_id.
-- That allowed old coarse Sales Intelligence cases to remain active beside the newer canonical set.
--
-- This keeps the existing public RPC contract and moves the cleanup into the lifecycle owner itself:
-- publishing a canonical fine source also retires active SI cases that belong to coarse sources which
-- the same canonical-source rule proves are superseded by that fine source. The retirement, automatic
-- review supersession, and canonical-sale-proof revoke happen in the same DB transaction.

create or replace function public.sales_intelligence_reconcile_case_set_v1(
  p_conversation_id uuid,
  p_active_case_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
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

  -- Resolve the current review source first. Cross-source retirement is intentionally disabled when
  -- the source cannot be proven canonical; the normal per-conversation lifecycle still works.
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

    -- Exact inverse of Canonical Source Gate containedSiblingIds(coarse):
    -- same export, fine window inside coarse window, and fine raw text contained by coarse raw text.
    -- Exactly one V22 owner is required so a missing/ambiguous source can never retire another source.
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

  -- Serialize every source this publication can mutate. Sorting the lock ids gives all callers the
  -- same lock order and avoids cross-source deadlocks when multiple fine sources share one coarse row.
  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[])
    into v_lock_source_ids
  from (
    select distinct unnest(array_prepend(p_conversation_id, v_superseded_source_ids)) as id
  ) x;

  foreach v_source_id in array v_lock_source_ids loop
    perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:' || v_source_id::text));
  end loop;

  -- Fail closed if a caller tries to publish a case owned by another conversation or a case that
  -- was not persisted successfully yet.
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

  -- Every published case must have EXACTLY ONE raw current analysis at publication time.
  select coalesce(array_agg(x.case_id order by x.case_id), '{}'::text[])
    into v_unpublishable_case_ids
  from unnest(v_active_case_ids) as x(case_id)
  where (
    select count(*)
    from public.sales_intelligence_case_analyses ca
    where ca.case_id = x.case_id
      and ca.is_current = true
  ) <> 1;

  if cardinality(v_unpublishable_case_ids) > 0 then
    return jsonb_build_object(
      'ok', false,
      'status', 'active_case_current_analysis_not_unique',
      'conversationId', p_conversation_id,
      'unpublishableCaseIds', to_jsonb(v_unpublishable_case_ids)
    );
  end if;

  select coalesce(array_agg(c.case_id order by c.case_id), '{}'::text[])
    into v_reactivated_case_ids
  from public.sales_intelligence_cases c
  where c.conversation_id = p_conversation_id
    and c.case_id = any(v_active_case_ids)
    and c.is_active = false;

  -- Publish the exact current source case set and analysis snapshot.
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

  -- Normal same-source segmentation lifecycle.
  with retired as (
    update public.sales_intelligence_cases c
       set is_active = false,
           retired_at = now(),
           retire_reason = 'latest_segmentation_case_set'
     where c.conversation_id = p_conversation_id
       and c.is_active = true
       and not (c.case_id = any(v_active_case_ids))
    returning c.case_id
  )
  select coalesce(array_agg(case_id order by case_id), '{}'::text[])
    into v_local_retired_case_ids
  from retired;

  -- Cross-source lifecycle: a finer canonical source makes any containing coarse review source
  -- non-canonical under the already-established Canonical Source Gate rule. Keep history, but remove
  -- those coarse cases from current truth in the SAME transaction as fine-source publication.
  if cardinality(v_superseded_source_ids) > 0 then
    with retired as (
      update public.sales_intelligence_cases c
         set is_active = false,
             retired_at = now(),
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

  -- Automatic reviews follow case lifecycle. Historical rows remain auditable but disappear from
  -- current client surfaces. Manual reviews are never silently superseded here.
  if cardinality(v_retired_case_ids) > 0 then
    update public.conversation_sales_reviews r
       set is_current = false,
           superseded_at = now(),
           superseded_reason = 'sales_intelligence_case_retired',
           updated_at = now()
     where r.evaluation_kind = 'automatic'
       and r.sales_intelligence_case_id = any(v_retired_case_ids)
       and r.is_current = true;
  end if;

  -- A retired case cannot keep owning Canonical Sale Proof. Reuse the single canonical revoke owner.
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

revoke all on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) from public;
revoke all on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) from anon;
revoke all on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) from authenticated;
grant execute on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) to service_role;

comment on column public.sales_intelligence_cases.retire_reason is
  'Machine-readable reason a case left current truth; latest_segmentation_case_set or superseded_by_finer_canonical_source.';
