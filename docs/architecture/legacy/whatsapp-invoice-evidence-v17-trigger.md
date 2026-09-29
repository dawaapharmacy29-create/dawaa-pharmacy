# Legacy invoice evidence trigger (V17): live definition and planned replacement

Status: **replaced live by V50** (`20260929155727_whatsapp_legacy_invoice_evidence_only_v50`, STEP 3C-2).
The sections below keep the pre-V50 definition for history.

The function and trigger exist only in the live database; no migration in this repository
defines them (schema drift). Recorded from `pg_get_functiondef` on 2026-09-29.

## Why it must change

Rule: *Conversation is evidence. Invoice is transaction truth.* Only Canonical Sale Proof
(`dawaa_reconcile_sales_intelligence_case_v22_v1`, V44/V46) may produce official sale truth.

This trigger turns the legacy field `whatsapp_review_sources.invoice_match_status='verified'`
into an official fact (`fact_type='verified_sale'`, `review_state='confirmed'`,
`official_eligible=true`), and it fires on **every** update of a source row (any column), so
unrelated writes (reanalysis snapshots, archiving) re-assert it. Live today it holds exactly one
official `verified_sale` fact, on historical source `2b17106c…` (no V22 case, no canonical proof).

Correction (STEP 3C-2): the pre-V50 trigger was already column-scoped
(`AFTER UPDATE OF invoice_match_status, matched_invoice_id, matched_invoice_number,
matched_invoice_value, invoice_match_confidence`), so it did not fire on every source update; it
did fire whenever those columns appeared in an UPDATE, even with unchanged values. V50 adds a
`WHEN ... IS DISTINCT FROM` guard and removes the official-truth write.

## Current definition (live)

```sql
-- trigger: trg_whatsapp_invoice_evidence_v17  AFTER UPDATE OF invoice_match_status, matched_invoice_id,
--          matched_invoice_number, matched_invoice_value, invoice_match_confidence ON public.whatsapp_review_sources
CREATE OR REPLACE FUNCTION public.dawaa_sync_whatsapp_invoice_evidence_v17()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if new.invoice_match_status='verified' then
    insert into public.whatsapp_evidence_facts_v17(
      source_id,fact_key,fact_type,fact_at,branch,customer_id,customer_code,customer_name,customer_phone,staff_id,staff_name,
      confidence,evidence_kind,evidence_json,analysis_version,review_state,official_eligible,updated_at
    ) values (
      new.id,'invoice:verified-sale','verified_sale',coalesce(new.matched_invoice_date,new.conversation_ended_at,new.updated_at),new.branch,new.customer_id,new.customer_code,new.customer_name,new.customer_phone,new.staff_id,new.staff_name,
      greatest(90,coalesce(new.invoice_match_confidence,0)),'invoice',jsonb_build_object('invoiceId',new.matched_invoice_id,'invoiceNumber',new.matched_invoice_number,'invoiceValue',new.matched_invoice_value,'reason',new.invoice_match_reason),coalesce(new.analysis_version,'whatsapp-evidence-v17'),'confirmed',true,now()
    ) on conflict(source_id,fact_key) do update set fact_at=excluded.fact_at,confidence=excluded.confidence,evidence_json=excluded.evidence_json,review_state='confirmed',official_eligible=true,updated_at=now();

    update public.whatsapp_sales_opportunities_v17 set
      sale_verified_scope='conversation',matched_invoice_id=new.matched_invoice_id::text,matched_invoice_number=new.matched_invoice_number,matched_invoice_value=new.matched_invoice_value,
      evidence_json=coalesce(evidence_json,'{}'::jsonb)||jsonb_build_object('invoiceTruth','فاتورة مؤكدة مرتبطة بالمحادثة؛ إثبات الصنف نفسه يحتاج مطابقة بنود الفاتورة.'),updated_at=now()
    where root_source_id=new.id;
  else
    update public.whatsapp_evidence_facts_v17 set review_state='rejected',official_eligible=false,evidence_json=coalesce(evidence_json,'{}'::jsonb)||jsonb_build_object('invoiceVerificationRevokedAt',now()),updated_at=now()
    where source_id=new.id and fact_key='invoice:verified-sale';
    update public.whatsapp_sales_opportunities_v17 set sale_verified_scope='none',matched_invoice_id=null,matched_invoice_number=null,matched_invoice_value=null,updated_at=now() where root_source_id=new.id;
  end if;
  return new;
end $function$;
```

## Replacement (applied by V50)

The authoritative SQL is `supabase/migrations/20260929155727_whatsapp_legacy_invoice_evidence_only_v50.sql`:

- Evidence-only: the legacy status may record an invoice *candidate* fact
  (`review_state='proposed'`, `official_eligible=false`), never official truth, and never a
  sale-verified opportunity scope.
- Fires only when a legacy invoice column value actually changes (`WHEN ... IS DISTINCT FROM`).
- Withdrawing the status rejects the candidate fact and may only clear a legacy scope.

V50 also demoted the one existing official fact on `2b17106c…` (fact `ec012486…`, invoice 35205)
to `review_state='proposed'`, `official_eligible=false`, with `evidence_json.legacyTruthCorrectionV50`
holding the previous values and an audit row `legacy_invoice_truth_demoted_v50`. Nothing was deleted.
