-- Recovery truth correction V40.
-- Reopen Legacy system auto-closures that were marked sold/completed from invoice-match
-- evidence without Canonical Sale Proof. Preserve full previous state in audit + payload.
-- Extend the live health guard so this class of regression fails CI.

create temp table _v40_affected on commit drop as
select
  a.id,
  a.source_id,
  a.work_status,
  a.completed_at,
  a.outcome,
  a.outcome_note,
  a.recovered_invoice_id,
  a.recovered_invoice_number,
  a.recovered_invoice_value,
  a.recovered_at,
  a.payload
from public.whatsapp_conversation_actions a
where a.action_type in ('customer_followup','complaint_followup')
  and a.status='ready'
  and a.outcome='sold'
  and coalesce(a.outcome_note,'') ilike '%تم تأكيد عودة العميل للشراء من خلال فاتورة مرتبطة بالقصة%'
  and a.assigned_to_id is null
  and a.started_at is null
  and not exists (
    select 1
    from public.whatsapp_customer_cases_v22 c
    where (c.root_source_id=a.source_id or a.source_id=any(c.source_ids))
      and c.verified_invoice_id is not null
      and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
      and (
        c.confirmed_outcome='verified_sale'
        or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
      )
  );

insert into public.whatsapp_review_audit(
  source_id,action,actor_id,actor_name,actor_role,before_state,after_state,note
)
select
  x.source_id,
  'legacy_recovery_auto_close_reopened_v40',
  null,
  'system truth correction v40',
  'system',
  jsonb_build_object(
    'action_id',x.id,
    'work_status',x.work_status,
    'completed_at',x.completed_at,
    'outcome',x.outcome,
    'outcome_note',x.outcome_note,
    'recovered_invoice_id',x.recovered_invoice_id,
    'recovered_invoice_number',x.recovered_invoice_number,
    'recovered_invoice_value',x.recovered_invoice_value,
    'recovered_at',x.recovered_at
  ),
  jsonb_build_object(
    'action_id',x.id,
    'work_status','unassigned',
    'completed_at',null,
    'outcome',null,
    'outcome_note',null,
    'recovered_invoice_id',null,
    'recovered_invoice_number',null,
    'recovered_invoice_value',null,
    'recovered_at',null
  ),
  'Truth correction: reopened a Legacy system auto-close that used invoice-match evidence without Canonical Sale Proof.'
from _v40_affected x;

update public.whatsapp_conversation_actions a
set
  work_status='unassigned',
  completed_at=null,
  outcome=null,
  outcome_note=null,
  recovered_invoice_id=null,
  recovered_invoice_number=null,
  recovered_invoice_value=null,
  recovered_at=null,
  payload=coalesce(a.payload,'{}'::jsonb) || jsonb_build_object(
    'truthCorrectionV40',
    jsonb_build_object(
      'correctedAt',now(),
      'reason','legacy_invoice_match_auto_close_without_canonical_sale_proof',
      'previousWorkStatus',x.work_status,
      'previousCompletedAt',x.completed_at,
      'previousOutcome',x.outcome,
      'previousOutcomeNote',x.outcome_note,
      'previousRecoveredInvoiceId',x.recovered_invoice_id,
      'previousRecoveredInvoiceNumber',x.recovered_invoice_number,
      'previousRecoveredInvoiceValue',x.recovered_invoice_value,
      'previousRecoveredAt',x.recovered_at
    )
  ),
  updated_at=now()
from _v40_affected x
where a.id=x.id;

create or replace function public.dawaa_whatsapp_story_truth_health_v39()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_legacy_triggers int := 0;
  v_canonical_triggers int := 0;
  v_unproven_story_purchases int := 0;
  v_unproven_recovered_stories int := 0;
  v_unproven_purchase_events int := 0;
  v_unproven_recovery_events int := 0;
  v_legacy_auto_closed_actions int := 0;
  v_actions_recovered_without_proof int := 0;
begin
  select count(*)::int into v_legacy_triggers
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='whatsapp_review_sources'
    and not t.tgisinternal
    and t.tgname in ('trg_whatsapp_story_verified_purchase_v16','trg_whatsapp_recovery_invoice_truth_v11');

  select count(*)::int into v_canonical_triggers
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='whatsapp_customer_cases_v22'
    and not t.tgisinternal
    and t.tgname='trg_whatsapp_story_canonical_purchase_v36';

  select count(*)::int into v_unproven_story_purchases
  from public.whatsapp_customer_stories s
  where s.last_verified_purchase_at is not null
    and not exists (
      select 1 from public.whatsapp_customer_cases_v22 c
      where c.story_id=s.id
        and c.verified_invoice_id is not null
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
    );

  select count(*)::int into v_unproven_recovered_stories
  from public.whatsapp_customer_stories s
  where s.status='recovered'
    and not exists (
      select 1 from public.whatsapp_customer_cases_v22 c
      where c.story_id=s.id
        and c.verified_invoice_id is not null
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
    );

  select count(*)::int into v_unproven_purchase_events
  from public.whatsapp_customer_story_events e
  where e.event_type='verified_purchase'
    and not exists (
      select 1 from public.whatsapp_customer_cases_v22 c
      where c.story_id=e.story_id
        and c.verified_invoice_id::text=e.invoice_id
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
    );

  select count(*)::int into v_unproven_recovery_events
  from public.whatsapp_customer_story_events e
  where e.event_type='customer_recovered'
    and not exists (
      select 1 from public.whatsapp_customer_cases_v22 c
      where c.story_id=e.story_id
        and c.verified_invoice_id::text=e.invoice_id
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
    );

  select count(*)::int into v_legacy_auto_closed_actions
  from public.whatsapp_conversation_actions a
  where a.action_type in ('customer_followup','complaint_followup')
    and a.outcome='sold'
    and coalesce(a.outcome_note,'') ilike '%تم تأكيد عودة العميل للشراء من خلال فاتورة مرتبطة بالقصة%'
    and a.assigned_to_id is null
    and a.started_at is null
    and not exists (
      select 1 from public.whatsapp_customer_cases_v22 c
      where (c.root_source_id=a.source_id or a.source_id=any(c.source_ids))
        and c.verified_invoice_id is not null
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
    );

  select count(*)::int into v_actions_recovered_without_proof
  from public.whatsapp_conversation_actions a
  where a.recovered_invoice_id is not null
    and not exists (
      select 1 from public.whatsapp_customer_cases_v22 c
      where c.verified_invoice_id::text=a.recovered_invoice_id
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
        and (
          c.root_source_id=a.source_id
          or a.source_id=any(c.source_ids)
          or (a.customer_id is not null and c.customer_id=a.customer_id)
          or (
            a.customer_code is not null
            and c.customer_code=a.customer_code
            and public.dawaa_customer_request_branch_key(c.branch)=public.dawaa_customer_request_branch_key(a.branch)
          )
        )
    );

  return jsonb_build_object(
    'ok',
      v_legacy_triggers=0
      and v_canonical_triggers=1
      and v_unproven_story_purchases=0
      and v_unproven_recovered_stories=0
      and v_unproven_purchase_events=0
      and v_unproven_recovery_events=0
      and v_legacy_auto_closed_actions=0
      and v_actions_recovered_without_proof=0,
    'legacyTriggerCount',v_legacy_triggers,
    'canonicalTriggerCount',v_canonical_triggers,
    'storiesWithUnprovenPurchase',v_unproven_story_purchases,
    'storiesRecoveredWithoutProof',v_unproven_recovered_stories,
    'unprovenVerifiedPurchaseEvents',v_unproven_purchase_events,
    'unprovenRecoveredEvents',v_unproven_recovery_events,
    'legacyAutoClosedActions',v_legacy_auto_closed_actions,
    'actionsRecoveredWithoutProof',v_actions_recovered_without_proof,
    'checkedAt',now()
  );
end
$$;

revoke all on function public.dawaa_whatsapp_story_truth_health_v39() from public, anon, authenticated;
grant execute on function public.dawaa_whatsapp_story_truth_health_v39() to service_role;
