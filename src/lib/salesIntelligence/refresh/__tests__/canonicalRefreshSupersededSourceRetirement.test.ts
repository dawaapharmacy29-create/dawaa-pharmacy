import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../../../supabase/migrations/20261004064500_si_case_lifecycle_superseded_source_retirement_v2.sql',
  import.meta.url
);
const sql = readFileSync(migrationUrl, 'utf8');

describe('Sales Intelligence superseded-source lifecycle migration', () => {
  it('keeps the existing lifecycle RPC contract and requires canonical fine-source ownership', () => {
    expect(sql).toContain(
      'create or replace function public.sales_intelligence_reconcile_case_set_v1('
    );
    expect(sql).toContain('v_current_owner_count = 1');
    expect(sql).toContain("coalesce(v_current_source.review_status, '') <> 'archived'");
    expect(sql).toContain("p_conversation_id = any(coalesce(wc.source_ids, '{}'::uuid[]))");
  });

  it('uses the same containment semantics as the Canonical Source Gate', () => {
    expect(sql).toContain('s.source_filename = v_current_source.source_filename');
    expect(sql).toContain(
      's.conversation_started_at <= v_current_source.conversation_started_at'
    );
    expect(sql).toContain('s.conversation_ended_at >= v_current_source.conversation_ended_at');
    expect(sql).toContain('position(v_current_source.raw_text in s.raw_text) > 0');
  });

  it('retires coarse cases before automatic-review supersession and canonical-proof revoke', () => {
    const retire = sql.indexOf("retire_reason = 'superseded_by_finer_canonical_source'");
    const reviewSupersession = sql.indexOf('update public.conversation_sales_reviews');
    const proofRevoke = sql.indexOf('dawaa_revoke_whatsapp_canonical_sale_proof_v46');

    expect(retire).toBeGreaterThan(-1);
    expect(reviewSupersession).toBeGreaterThan(retire);
    expect(proofRevoke).toBeGreaterThan(reviewSupersession);
  });

  it('serializes every source it can mutate in deterministic order', () => {
    expect(sql).toContain(
      'select distinct unnest(array_prepend(p_conversation_id, v_superseded_source_ids)) as id'
    );
    expect(sql).toContain("pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:'");
  });

  it('preserves audit history and keeps the RPC service-role only', () => {
    expect(sql.toLowerCase()).not.toContain('delete from public.sales_intelligence_cases');
    expect(sql).toContain(
      'revoke all on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) from authenticated;'
    );
    expect(sql).toContain(
      'grant execute on function public.sales_intelligence_reconcile_case_set_v1(uuid, text[]) to service_role;'
    );
  });
});
