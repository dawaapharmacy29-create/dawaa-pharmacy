-- Sales Intelligence case lifecycle reconciliation.
--
-- Why this exists:
-- case_id is stable only while a segmentation boundary remains valid. When a newer engine
-- re-segments the same conversation, old case rows must remain auditable but must stop being
-- current truth. Deleting them would destroy lineage; leaving them readable creates stale sale
-- proof, QA, and automatic-review leakage.
--
-- Publication rule:
-- persistence may write new raw case/analysis rows, but those rows are NOT current application
-- truth until the per-conversation case-set reconciliation RPC publishes them atomically. This
-- prevents a partially-completed refresh from leaking new cases or analyses into current views.
--
-- This migration intentionally performs NO bulk retirement. Existing cases/analyses are published
-- as the compatibility baseline; later successful canonical refreshes publish the exact latest set.

-- Add nullable first so existing rows can be initialized as the pre-migration published baseline.
alter table public.sales_intelligence_cases
  add column if not exists is_active boolean,
  add column if not exists published_analysis_id uuid,
  add column if not exists retired_at timestamptz,
  add column if not exists retire_reason text;

-- Preserve today's visible truth exactly at migration time: every existing case remains active,
-- and its currently-owned analysis (when one exists) becomes the initial published snapshot.
update public.sales_intelligence_cases
set is_active = true
where is_active is null;

update public.sales_intelligence_cases c
set published_analysis_id = ca.analysis_id
from public.sales_intelligence_case_analyses ca
where ca.case_id = c.case_id
  and ca.is_current = true
  and c.published_analysis_id is null;

-- After the compatibility backfill, NEW case rows are unpublished by default. Only the atomic
-- reconcile RPC below may activate/publish them.
alter table public.sales_intelligence_cases
  alter column is_active set default false,
  alter column is_active set not null;

create index if not exists sales_intelligence_cases_active_conversation_idx
  on public.sales_intelligence_cases (conversation_id, case_id, published_analysis_id)
  where is_active = true;

alter table public.conversation_sales_reviews
  add column if not exists is_current boolean not null default true,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

create index if not exists conversation_sales_reviews_current_si_case_idx
  on public.conversation_sales_reviews (sales_intelligence_case_id, whatsapp_review_source_id)
  where is_current = true and sales_intelligence_case_id is not null;

comment on column public.sales_intelligence_cases.is_active is
  'True only when this case_id belongs to the latest successfully published segmentation set for its conversation. New cases default false until reconciliation.';
comment on column public.sales_intelligence_cases.published_analysis_id is
  'The analysis snapshot atomically published as current application truth for this case. Raw newer analyses may exist but are invisible until reconciliation succeeds.';
comment on column public.sales_intelligence_cases.retired_at is
  'Timestamp when a formerly-active case left the latest segmentation set. Historical rows are retained for audit.';
comment on column public.sales_intelligence_cases.retire_reason is
  'Machine-readable reason a case left current truth; currently latest_segmentation_case_set.';
comment on column public.conversation_sales_reviews.is_current is
  'False when an automatic case-level review belongs to a retired Sales Intelligence case. Manual reviews remain current unless explicitly superseded.';

-- Atomic owner of the published case set for ONE source conversation.
-- Service role only: browser clients must never decide which cases/analyses are current.
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
  v_retired_case_ids text[] := '{}'::text[];
  v_reactivated_case_ids text[] := '{}'::text[];
  v_published_analysis_ids jsonb := '{}'::jsonb;
  v_case record;
  v_v22_id uuid;
  v_proof_sales_case_id text;
begin
  if p_conversation_id is null then
    return jsonb_build_object('ok', false, 'status', 'conversation_id_required');
  end if;

  -- Serialize publication per source. Raw pipeline work may happen outside this transaction, but
  -- publication of the visible case set + analysis snapshots is one atomic DB action.
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:' || p_conversation_id::text));

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

  -- Every published case must have EXACTLY ONE raw current analysis at publication time. Zero
  -- means persistence was incomplete; >1 means raw writer invariants are already broken. Neither
  -- condition is allowed to alter visible truth.
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

  -- Publish the caller's exact active set and the exact current analysis snapshot for each case.
  -- This is the publication barrier: raw analysis rows written before this RPC stay invisible.
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
           retired_at = now(),
           retire_reason = 'latest_segmentation_case_set'
     where c.conversation_id = p_conversation_id
       and c.is_active = true
       and not (c.case_id = any(v_active_case_ids))
    returning c.case_id
  )
  select coalesce(array_agg(case_id order by case_id), '{}'::text[])
    into v_retired_case_ids
  from retired;

  -- Automatic reviews follow case lifecycle. They are retained for audit but disappear from the
  -- current client surface. If a stable case id becomes active again, the refresh writer updates
  -- that same review row and restores is_current=true.
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

  -- A retired case cannot keep owning canonical sale proof. Reuse the existing canonical revoke
  -- owner instead of re-implementing any sale-proof semantics here.
  for v_case in
    select c.case_id, c.source_case_id_v22
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
          'reason', 'latest_segmentation_case_set'
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
    'reactivatedCaseIds', to_jsonb(v_reactivated_case_ids)
  );
end;
$function$;

revoke all on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) from public;
revoke all on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) from anon;
revoke all on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) from authenticated;
grant execute on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) to service_role;

-- Current read models are publication views, not raw-writer views. A raw analysis may have
-- is_current=true internally and still be invisible until published_analysis_id points at it.
create or replace view public.sales_intelligence_current_case_analyses
with (security_invoker = true)
as
select
  ca.analysis_id,
  ca.case_id,
  ca.analysis_version,
  ca.pipeline_version,
  ca.engine_version_case_segmentation,
  ca.engine_version_historical_closure,
  ca.engine_version_commercial_confirmation,
  ca.engine_version_protocol_applicability,
  ca.semantic_source_hash,
  ca.analyzed_at,
  true::boolean as is_current,
  ca.superseded_at,
  ca.superseded_by_analysis_id,
  ca.case_type,
  ca.case_status,
  ca.pipeline_status,
  ca.overall_evidence_level,
  ca.identity_customer_id,
  ca.identity_customer_phone,
  ca.identity_branch_id,
  ca.identity_branch_name_raw,
  ca.case_started_at,
  ca.case_ended_at,
  ca.historical_closure_level,
  ca.commercial_confirmation_state,
  ca.protocol_applicability,
  ca.attribution_level,
  ca.integrity_evaluation_scope,
  ca.needs_human_review,
  ca.human_review_reasons,
  ca.failure_reasons,
  ca.pipeline_warnings,
  ca.evidence_snapshot
from public.sales_intelligence_cases c
join public.sales_intelligence_case_analyses ca on ca.analysis_id = c.published_analysis_id
join public.whatsapp_review_sources s on s.id = c.conversation_id
where c.is_active = true
  and c.source_case_id_v22 is not null
  and coalesce(s.review_status, '') <> 'archived';

create or replace view public.sales_intelligence_current_attributions
with (security_invoker = true)
as
select
  a.id,
  a.analysis_id,
  a.case_id,
  a.evaluation_version,
  a.is_current_evaluation,
  a.evaluated_at,
  a.superseded_at,
  a.superseded_by_evaluation_version,
  a.attribution_engine_version,
  a.attribution_input_hash,
  a.identity_customer_id,
  a.identity_customer_phone,
  a.selected_invoice_id,
  a.selected_invoice_number,
  a.attribution_level,
  a.confidence_score,
  a.is_official_for_staff_evaluation,
  a.competing_case_ids,
  a.ambiguity_status,
  a.identity_conflict,
  a.branch_conflict,
  a.candidate_count,
  a.primary_evidence,
  a.contradictions,
  a.rule_ids,
  a.legacy_evidence_used
from public.sales_intelligence_cases c
join public.sales_intelligence_attributions a
  on a.case_id = c.case_id
 and a.analysis_id = c.published_analysis_id
join public.whatsapp_review_sources s on s.id = c.conversation_id
where c.is_active = true
  and a.is_current_evaluation = true
  and c.source_case_id_v22 is not null
  and coalesce(s.review_status, '') <> 'archived';

create or replace view public.sales_intelligence_current_policy_evaluations
with (security_invoker = true)
as
select
  pe.policy_evaluation_id,
  pe.analysis_id,
  pe.case_id,
  pe.policy_config_id,
  pe.policy_config_version,
  pe.protocol_policy_effective_at,
  pe.protocol_applicability,
  pe.protocol_policy_compliance,
  pe.evaluation_version,
  pe.policy_input_hash,
  pe.is_current,
  pe.evaluated_at,
  pe.superseded_at,
  pe.superseded_by_policy_evaluation_id
from public.sales_intelligence_cases c
join public.sales_intelligence_policy_evaluations pe
  on pe.case_id = c.case_id
 and pe.analysis_id = c.published_analysis_id
join public.whatsapp_review_sources s on s.id = c.conversation_id
where c.is_active = true
  and pe.is_current = true
  and c.source_case_id_v22 is not null
  and coalesce(s.review_status, '') <> 'archived';

create or replace view public.sales_intelligence_current_basket_invoice_matches
with (security_invoker = true)
as
select
  b.id,
  b.analysis_id,
  b.case_id,
  b.attribution_row_id,
  b.evaluation_version,
  b.is_current_evaluation,
  b.evaluated_at,
  b.superseded_at,
  b.superseded_by_evaluation_version,
  b.matching_engine_version,
  b.basket_id,
  b.basket_version,
  b.invoice_id,
  b.invoice_number,
  b.total_match,
  b.item_match,
  b.quantity_match,
  b.overall_match,
  b.header_evidence_ready,
  b.item_evidence_ready,
  b.integrity_evaluation_scope,
  b.differences,
  b.needs_human_review,
  b.human_review_reasons,
  b.matching_input_hash
from public.sales_intelligence_cases c
join public.sales_intelligence_basket_invoice_matches b
  on b.case_id = c.case_id
 and b.analysis_id = c.published_analysis_id
join public.whatsapp_review_sources s on s.id = c.conversation_id
where c.is_active = true
  and b.is_current_evaluation = true
  and c.source_case_id_v22 is not null
  and coalesce(s.review_status, '') <> 'archived';

-- Client read boundaries: normal app users see published current truth only. Service role bypasses
-- RLS and therefore retains full historical/raw audit access.
drop policy if exists sales_intelligence_cases_select_v1 on public.sales_intelligence_cases;
create policy sales_intelligence_cases_select_v1
on public.sales_intelligence_cases
for select
to public
using (
  is_active = true
  and (
    (select public.dawaa_actor_is_top_management_v1())
    or exists (
      select 1
      from public.staff_accounts me
      where me.id = (select public.dawaa_current_staff_account_id_strict())
        and coalesce(me.active, false)
        and coalesce(me.can_login, false)
        and (
          lower(trim(coalesce(me.role, ''))) = any(array['team_dawaa_alpha', 'customer_service_manager'])
          or (
            lower(trim(coalesce(me.role, ''))) = any(array['branch_manager', 'customer_service', 'shift_supervisor_morning', 'shift_supervisor_evening'])
            and public.dawaa_customer_request_branch_key(me.branch) is not null
            and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(sales_intelligence_cases.branch_name_raw)
          )
        )
    )
  )
);

drop policy if exists conversation_sales_reviews_select_canonical on public.conversation_sales_reviews;
create policy conversation_sales_reviews_select_canonical
on public.conversation_sales_reviews
for select
to public
using (
  is_current = true
  and (select public.dawaa_current_actor_can(array['view_reviews']))
  and public.dawaa_can_read_conversation_review_row_v2(
    (select public.dawaa_current_staff_account_id_strict()),
    staff_id,
    doctor_id,
    branch,
    reviewer_id
  )
);
