-- Read-only capture of the Production definition of sales_intelligence_reconcile_case_set_v2
-- (pg_get_functiondef md5 ef4470ef0413343c7cc57ed332ba243f, read 2026-10-25). Test fixture only:
-- this function is NOT reproduced by any committed migration (the closest committed text is
-- docs/whatsapp-master-brain-lifecycle-v4-20261017/sql/phase-a-release-candidate.sql, md5 b1d51222),
-- which is a known reproducibility gap. Used by test-whatsapp-soft-delete.py so the isolated
-- re-analysis checks exercise the live lifecycle writer. Never apply to an application database.
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

  -- Archive UPDATE already holds its source row. Take source rows before advisory locks
  -- in the same order, so refresh cannot hold advisory while waiting on archival's row.
  perform s.id from public.whatsapp_review_sources s
  where s.id = any(v_lock_source_ids) order by s.id for update;

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
