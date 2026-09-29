-- Live read-only health guard for WhatsApp Story/Recovery truth.
-- The final CI gate calls this RPC with service_role and fails closed if legacy
-- invoice-match recovery truth reappears or Story truth loses Canonical proof.

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
begin
  select count(*)::int
  into v_legacy_triggers
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='whatsapp_review_sources'
    and not t.tgisinternal
    and t.tgname in (
      'trg_whatsapp_story_verified_purchase_v16',
      'trg_whatsapp_recovery_invoice_truth_v11'
    );

  select count(*)::int
  into v_canonical_triggers
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relname='whatsapp_customer_cases_v22'
    and not t.tgisinternal
    and t.tgname='trg_whatsapp_story_canonical_purchase_v36';

  select count(*)::int
  into v_unproven_story_purchases
  from public.whatsapp_customer_stories s
  where s.last_verified_purchase_at is not null
    and not exists (
      select 1
      from public.whatsapp_customer_cases_v22 c
      where c.story_id=s.id
        and c.verified_invoice_id is not null
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
    );

  select count(*)::int
  into v_unproven_recovered_stories
  from public.whatsapp_customer_stories s
  where s.status='recovered'
    and not exists (
      select 1
      from public.whatsapp_customer_cases_v22 c
      where c.story_id=s.id
        and c.verified_invoice_id is not null
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
    );

  select count(*)::int
  into v_unproven_purchase_events
  from public.whatsapp_customer_story_events e
  where e.event_type='verified_purchase'
    and not exists (
      select 1
      from public.whatsapp_customer_cases_v22 c
      where c.story_id=e.story_id
        and c.verified_invoice_id::text=e.invoice_id
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
    );

  select count(*)::int
  into v_unproven_recovery_events
  from public.whatsapp_customer_story_events e
  where e.event_type='customer_recovered'
    and not exists (
      select 1
      from public.whatsapp_customer_cases_v22 c
      where c.story_id=e.story_id
        and c.verified_invoice_id::text=e.invoice_id
        and coalesce(c.confirmed_outcome,c.proposed_outcome)='verified_sale'
        and (
          c.confirmed_outcome='verified_sale'
          or coalesce(c.case_json #>> '{canonicalSaleProof,state}','')='proven'
        )
    );

  return jsonb_build_object(
    'ok',
      v_legacy_triggers=0
      and v_canonical_triggers=1
      and v_unproven_story_purchases=0
      and v_unproven_recovered_stories=0
      and v_unproven_purchase_events=0
      and v_unproven_recovery_events=0,
    'legacyTriggerCount',v_legacy_triggers,
    'canonicalTriggerCount',v_canonical_triggers,
    'storiesWithUnprovenPurchase',v_unproven_story_purchases,
    'storiesRecoveredWithoutProof',v_unproven_recovered_stories,
    'unprovenVerifiedPurchaseEvents',v_unproven_purchase_events,
    'unprovenRecoveredEvents',v_unproven_recovery_events,
    'checkedAt',now()
  );
end
$$;

revoke all on function public.dawaa_whatsapp_story_truth_health_v39() from public, anon, authenticated;
grant execute on function public.dawaa_whatsapp_story_truth_health_v39() to service_role;
