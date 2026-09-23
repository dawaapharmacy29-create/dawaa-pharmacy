// Final Pilot Readiness — QA Sale Proof projection tests.
//
// Confirms the persisted-row projection reproduces the REAL deriveSaleProofState() decisions —
// never a re-implementation, so these tests exercise the actual engine, fed reconstructed inputs.
import { describe, expect, it } from 'vitest';
import { deriveSaleProofStateFromPersisted } from '../saleProofProjection';

describe('Final Pilot Readiness — deriveSaleProofStateFromPersisted (persisted-row projection)', () => {
  it('proven: attribution_level=proven, no conflicts -> proven, trustedInvoiceId set', () => {
    const result = deriveSaleProofStateFromPersisted(
      'case-1',
      { commercial_confirmation_state: 'commercial_confirmation_complete' },
      {
        attribution_level: 'proven',
        selected_invoice_id: 'inv-1',
        selected_invoice_number: 'INV-1',
        identity_conflict: 'none',
        branch_conflict: false,
        competing_case_ids: [],
        candidate_count: 1,
        is_official_for_staff_evaluation: true,
      },
      { integrity_evaluation_scope: 'header_only', item_evidence_ready: false, total_match: 'exact', header_evidence_ready: true, differences: [] }
    );
    expect(result.state).toBe('proven');
    expect(result.trustedInvoiceId).toBe('inv-1');
  });

  it('strongly_supported: strongly_inferred + official, no trusted link -> strongly_supported, never proven', () => {
    const result = deriveSaleProofStateFromPersisted(
      'case-2',
      null,
      {
        attribution_level: 'strongly_inferred',
        selected_invoice_id: 'inv-2',
        selected_invoice_number: 'INV-2',
        identity_conflict: 'none',
        branch_conflict: false,
        competing_case_ids: [],
        candidate_count: 1,
        is_official_for_staff_evaluation: true,
      },
      { integrity_evaluation_scope: 'header_only', item_evidence_ready: false, differences: [] }
    );
    expect(result.state).toBe('strongly_supported');
    expect(result.trustedInvoiceId).toBeNull();
  });

  it('unknown: no attribution row at all -> unknown', () => {
    const result = deriveSaleProofStateFromPersisted('case-3', null, null, null);
    expect(result.state).toBe('unknown');
    expect(result.trustedInvoiceId).toBeNull();
  });

  it('contradicted: identity_conflict on the persisted row -> contradicted, even at attribution_level=proven', () => {
    const result = deriveSaleProofStateFromPersisted(
      'case-4',
      null,
      {
        attribution_level: 'proven',
        selected_invoice_id: 'inv-4',
        selected_invoice_number: 'INV-4',
        identity_conflict: 'phone_vs_customer_id_conflict',
        branch_conflict: false,
        competing_case_ids: [],
        candidate_count: 1,
        is_official_for_staff_evaluation: true,
      },
      { integrity_evaluation_scope: 'header_only', item_evidence_ready: false, differences: [] }
    );
    expect(result.state).toBe('contradicted');
    expect(result.contradictions).toContain('cross_customer_invoice_link');
    expect(result.trustedInvoiceId).toBeNull();
  });

  it('contradicted: competing_case_ids non-empty -> contradicted, mirrors persisted competition', () => {
    const result = deriveSaleProofStateFromPersisted(
      'case-5',
      null,
      {
        attribution_level: 'proven',
        selected_invoice_id: 'inv-5',
        selected_invoice_number: 'INV-5',
        identity_conflict: 'none',
        branch_conflict: false,
        competing_case_ids: ['other-case'],
        candidate_count: 2,
        is_official_for_staff_evaluation: true,
      },
      { integrity_evaluation_scope: 'header_only', item_evidence_ready: false, differences: [] }
    );
    expect(result.state).toBe('contradicted');
    expect(result.contradictions).toContain('cross_case_invoice_collision');
  });

  it('item evidence unavailable is carried through verbatim regardless of state', () => {
    const result = deriveSaleProofStateFromPersisted(
      'case-6',
      null,
      { attribution_level: 'proven', selected_invoice_id: 'inv-6', identity_conflict: 'none', branch_conflict: false, competing_case_ids: [], candidate_count: 1, is_official_for_staff_evaluation: true },
      { integrity_evaluation_scope: 'header_only', item_evidence_ready: false, differences: [] }
    );
    expect(result.itemEvidenceReady).toBe(false);
    expect(result.invoiceEvidenceScope).toBe('header_only');
  });

  it('a trusted (proven) candidate with a real branch_conflict is contradicted, not proven', () => {
    const result = deriveSaleProofStateFromPersisted(
      'case-7',
      null,
      {
        attribution_level: 'proven',
        selected_invoice_id: 'inv-7',
        identity_conflict: 'none',
        branch_conflict: true,
        competing_case_ids: [],
        candidate_count: 1,
        is_official_for_staff_evaluation: true,
      },
      { integrity_evaluation_scope: 'header_only', item_evidence_ready: false, differences: [] }
    );
    expect(result.state).toBe('contradicted');
    expect(result.contradictions).toContain('cross_branch_invoice_link');
  });

  it('is deterministic — running twice with the same rows produces byte-identical output', () => {
    const analysisRow = { commercial_confirmation_state: 'commercial_confirmation_complete' };
    const attributionRow = {
      attribution_level: 'weakly_inferred',
      selected_invoice_id: 'inv-8',
      identity_conflict: 'none',
      branch_conflict: false,
      competing_case_ids: [],
      candidate_count: 1,
      is_official_for_staff_evaluation: false,
    };
    const matchRow = { integrity_evaluation_scope: 'insufficient', item_evidence_ready: false, differences: [] };
    const a = deriveSaleProofStateFromPersisted('case-9', analysisRow, attributionRow, matchRow);
    const b = deriveSaleProofStateFromPersisted('case-9', analysisRow, attributionRow, matchRow);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
