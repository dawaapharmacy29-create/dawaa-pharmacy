-- V50: legacy invoice evidence is evidence only (STEP 3C-2).
--
-- Rule: Conversation is evidence. Invoice is transaction truth. Official sale truth comes only
-- from Canonical Sale Proof (dawaa_reconcile_sales_intelligence_case_v22_v1, V44/V46).
--
-- The live trigger trg_whatsapp_invoice_evidence_v17 (never defined in a repository migration;
-- recorded in docs/architecture/legacy/whatsapp-invoice-evidence-v17-trigger.md) turned the legacy
-- field whatsapp_review_sources.invoice_match_status='verified' into an official fact
-- (fact_type='verified_sale', review_state='confirmed', official_eligible=true) and a
-- sale-verified opportunity scope. This migration:
--   A. replaces the function: the legacy status may record an invoice candidate fact
--      (review_state='proposed', official_eligible=false) and never sets a sale-verified scope;
--      revocation still rejects the candidate. It runs only when the legacy invoice columns
--      actually change (WHEN ... IS DISTINCT FROM).
--   B. demotes the single existing legacy official fact to proposed evidence with a V50 marker
--      and an audit row. Nothing is deleted; no V22 link or canonical proof is created.
-- Fail closed: an unexpected current trigger definition, an unexpected number of legacy official
-- facts, or a fact backed by a V22 case aborts the migration. Re-running is a no-op.

do $$
declare
  v_def text := pg_get_functiondef('public.dawaa_sync_whatsapp_invoice_evidence_v17()'::regprocedure);
begin
  if md5(v_def) <> '3b51862203cfe3bc9e405576d65bf816'
     and position('legacy_invoice_evidence_only_v50' in v_def) = 0 then
    raise exception 'v50_unexpected_legacy_invoice_trigger_definition';
  end if;
end $$;

create or replace function public.dawaa_sync_whatsapp_invoice_evidence_v17()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- legacy_invoice_evidence_only_v50: legacy invoice matching is evidence, never official truth.
  if new.invoice_match_status = 'verified' then
    insert into public.whatsapp_evidence_facts_v17(
      source_id, fact_key, fact_type, fact_at, branch, customer_id, customer_code, customer_name,
      customer_phone, staff_id, staff_name, confidence, evidence_kind, evidence_json,
      analysis_version, review_state, official_eligible, updated_at
    ) values (
      new.id, 'invoice:verified-sale', 'verified_sale',
      coalesce(new.matched_invoice_date, new.conversation_ended_at, new.updated_at),
      new.branch, new.customer_id, new.customer_code, new.customer_name, new.customer_phone,
      new.staff_id, new.staff_name,
      least(89, round(coalesce(new.invoice_match_confidence, 0) * 100)),
      'invoice',
      jsonb_build_object(
        'invoiceId', new.matched_invoice_id,
        'invoiceNumber', new.matched_invoice_number,
        'invoiceValue', new.matched_invoice_value,
        'reason', new.invoice_match_reason,
        'legacyEvidenceOnly', true
      ),
      coalesce(new.analysis_version, 'whatsapp-evidence-v17'),
      'proposed', false, now()
    )
    on conflict (source_id, fact_key) do update set
      fact_at = excluded.fact_at,
      confidence = excluded.confidence,
      evidence_json = coalesce(public.whatsapp_evidence_facts_v17.evidence_json, '{}'::jsonb) || excluded.evidence_json,
      review_state = 'proposed',
      official_eligible = false,
      updated_at = now();
  else
    update public.whatsapp_evidence_facts_v17
    set review_state = 'rejected',
        official_eligible = false,
        evidence_json = coalesce(evidence_json, '{}'::jsonb) || jsonb_build_object('invoiceVerificationRevokedAt', now()),
        updated_at = now()
    where source_id = new.id
      and fact_key = 'invoice:verified-sale'
      and review_state <> 'rejected';

    -- Withdrawing a legacy status may only remove legacy scope, never add truth.
    update public.whatsapp_sales_opportunities_v17
    set sale_verified_scope = 'none',
        matched_invoice_id = null,
        matched_invoice_number = null,
        matched_invoice_value = null,
        updated_at = now()
    where root_source_id = new.id
      and sale_verified_scope = 'conversation';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_whatsapp_invoice_evidence_v17 on public.whatsapp_review_sources;
create trigger trg_whatsapp_invoice_evidence_v17
after update of invoice_match_status, matched_invoice_id, matched_invoice_number, matched_invoice_value,
  matched_invoice_date, invoice_match_confidence
on public.whatsapp_review_sources
for each row
when (
  old.invoice_match_status is distinct from new.invoice_match_status
  or old.matched_invoice_id is distinct from new.matched_invoice_id
  or old.matched_invoice_number is distinct from new.matched_invoice_number
  or old.matched_invoice_value is distinct from new.matched_invoice_value
  or old.matched_invoice_date is distinct from new.matched_invoice_date
  or old.invoice_match_confidence is distinct from new.invoice_match_confidence
)
execute function public.dawaa_sync_whatsapp_invoice_evidence_v17();

-- B. Demote the legacy official fact(s): exactly one expected on first run, zero on re-run.
do $$
declare
  v_expected integer;
  v_backed integer;
  v_row record;
begin
  select count(*) into v_expected
  from public.whatsapp_evidence_facts_v17 f
  where f.fact_type = 'verified_sale'
    and f.fact_key = 'invoice:verified-sale'
    and f.evidence_kind = 'invoice'
    and f.official_eligible;

  if v_expected = 0 then
    if not exists (
      select 1 from public.whatsapp_evidence_facts_v17 f
      where f.evidence_json ? 'legacyTruthCorrectionV50'
    ) then
      raise exception 'v50_expected_one_legacy_official_fact_found_none';
    end if;
    return; -- already applied
  end if;
  if v_expected <> 1 then
    raise exception 'v50_expected_one_legacy_official_fact_found_%', v_expected;
  end if;

  if exists (
    select 1 from public.whatsapp_evidence_facts_v17 f
    where f.official_eligible and f.fact_type <> 'verified_sale'
  ) then
    raise exception 'v50_unexpected_other_official_facts';
  end if;

  select f.* into v_row
  from public.whatsapp_evidence_facts_v17 f
  where f.fact_type = 'verified_sale'
    and f.fact_key = 'invoice:verified-sale'
    and f.evidence_kind = 'invoice'
    and f.official_eligible
  for update;

  -- Never demote a fact backed by canonical truth.
  select count(*) into v_backed
  from public.whatsapp_customer_cases_v22 c
  where (c.root_source_id = v_row.source_id or v_row.source_id = any(c.source_ids))
    and (
      coalesce(c.case_json #>> '{canonicalSaleProof,state}', '') = 'proven'
      or c.confirmed_outcome = 'verified_sale'
    );
  if v_backed > 0 then
    raise exception 'v50_legacy_fact_is_backed_by_canonical_sale_proof';
  end if;

  update public.whatsapp_evidence_facts_v17
  set official_eligible = false,
      review_state = case when review_state = 'confirmed' then 'proposed' else review_state end,
      evidence_json = coalesce(evidence_json, '{}'::jsonb) || jsonb_build_object(
        'legacyTruthCorrectionV50', jsonb_build_object(
          'correctedAt', now(),
          'reason', 'legacy_invoice_match_status_is_evidence_only',
          'previousReviewState', v_row.review_state,
          'previousOfficialEligible', v_row.official_eligible,
          'previousConfidence', v_row.confidence
        )
      ),
      updated_at = now()
  where id = v_row.id;

  insert into public.whatsapp_review_audit(source_id, action, actor_name, before_state, after_state, note)
  values (
    v_row.source_id,
    'legacy_invoice_truth_demoted_v50',
    'migration:v50',
    jsonb_build_object('factId', v_row.id, 'reviewState', v_row.review_state, 'officialEligible', v_row.official_eligible),
    jsonb_build_object('factId', v_row.id, 'reviewState', case when v_row.review_state = 'confirmed' then 'proposed' else v_row.review_state end, 'officialEligible', false),
    'Legacy invoice_match_status is evidence only; official sale truth requires Canonical Sale Proof.'
  );
end $$;
