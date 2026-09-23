// Phase I.C.2 — Canonical Sale Proof State regression tests.
//
// Constructs SaleAttributionAssessment/BasketInvoiceMatch fixtures directly (same style as
// salesIntegrityEngine.test.ts's own attribution()/bim() helpers), then runs the REAL
// deriveSalesIntegrityAssessment() engine over them (never hand-faked exceptions) before feeding
// everything into deriveSaleProofState() — so these tests exercise the real Phase F exception
// detection this module projects, not a duplicate of it.
import { describe, expect, it } from 'vitest';
import { deriveSalesIntegrityAssessment, type SalesIntegrityInput } from '../salesIntegrityEngine';
import { deriveSaleProofState, type SaleProofStateInput } from '../saleProofState';
import type {
  BasketInvoiceMatch,
  CommercialConfirmationAssessment,
  OrderConfirmationProtocolAssessment,
  SaleAttributionAssessment,
  SaleAttributionCandidate,
} from '../types';

function cc(overrides: Partial<CommercialConfirmationAssessment> = {}): CommercialConfirmationAssessment {
  return {
    caseId: 'c1',
    basketId: 'b1',
    basketVersion: 1,
    summaryPresented: true,
    customerConfirmed: true,
    staffConfirmed: true,
    announcedTotalPresent: true,
    modificationAfterConfirmation: false,
    currentState: 'commercial_confirmation_complete',
    primaryMessageIds: [],
    ruleIds: [],
    confidence: { level: 'strongly_inferred', score: 0.85, ruleIds: [], evidence: [] },
    needsHumanReview: false,
    humanReviewReasons: [],
    ...overrides,
  };
}

function protocol(overrides: Partial<OrderConfirmationProtocolAssessment> = {}): OrderConfirmationProtocolAssessment {
  return {
    caseId: 'c1',
    basketId: 'b1',
    basketVersion: 1,
    summaryCompliant: true,
    announcedTotalCompliant: true,
    customerConfirmationCompliant: true,
    staffFinalConfirmationCompliant: true,
    protocolCompliant: true,
    missingProtocolSteps: [],
    ...overrides,
  };
}

function candidate(overrides: Partial<SaleAttributionCandidate> = {}): SaleAttributionCandidate {
  return {
    caseId: 'c1',
    invoiceId: 'inv-1',
    invoiceNumber: 'INV-1',
    customerIdMatch: true,
    phoneMatch: false,
    identityConflict: 'none',
    branchMatch: 'exact_canonical',
    timeDistanceMinutes: 10,
    timeMatchStrength: 'very_strong',
    staffMatch: 'unknown',
    announcedTotalMatch: 'exact',
    basketValueMatch: 'not_available',
    productMatch: 'unavailable',
    quantityMatch: 'unavailable',
    legacyEvidenceMatch: false,
    directOrderLink: false,
    directInvoiceLink: false,
    evidence: [],
    ruleIds: [],
    confidenceAssessment: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] },
    disqualifiers: [],
    ...overrides,
  };
}

function attribution(overrides: Partial<SaleAttributionAssessment> = {}): SaleAttributionAssessment {
  return {
    caseId: 'c1',
    commercialConfirmationState: 'commercial_confirmation_complete',
    candidateCount: 1,
    selectedInvoiceId: 'inv-1',
    selectedInvoiceNumber: 'INV-1',
    selectedCandidate: candidate(),
    alternativeCandidates: [],
    attributionLevel: 'strongly_inferred',
    confidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] },
    primaryEvidence: [],
    contradictions: [],
    needsHumanReview: false,
    humanReviewReasons: [],
    isOfficialForStaffEvaluation: true,
    legacyEvidenceUsed: false,
    ruleIds: [],
    hasAttributedInvoice: true,
    competingCaseIds: [],
    ...overrides,
  };
}

function bim(overrides: Partial<BasketInvoiceMatch> = {}): BasketInvoiceMatch {
  return {
    matchId: 'm1',
    caseId: 'c1',
    basketId: 'b1',
    basketVersion: 1,
    invoiceId: 'inv-1',
    invoiceNumber: 'INV-1',
    totalMatch: 'exact',
    itemMatch: 'insufficient_data',
    quantityMatch: 'insufficient_data',
    overallMatch: 'partial',
    headerEvidenceReady: true,
    itemEvidenceReady: false,
    integrityEvaluationScope: 'header_only',
    differences: [],
    confidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] },
    needsHumanReview: false,
    humanReviewReasons: [],
    ruleIds: [],
    ...overrides,
  };
}

/** Runs the REAL Phase F engine, then the REAL I.C.2 layer — never hand-fakes either result. */
function assess(attr: SaleAttributionAssessment, match: BasketInvoiceMatch): ReturnType<typeof deriveSaleProofState> {
  const integrityInput: SalesIntegrityInput = {
    caseId: 'c1',
    commercialConfirmation: cc(),
    protocolAssessment: protocol(),
    attribution: attr,
    basketInvoiceMatch: match,
  };
  const integrityAssessment = deriveSalesIntegrityAssessment(integrityInput);
  const input: SaleProofStateInput = { attribution: attr, basketInvoiceMatch: match, integrityAssessment };
  return deriveSaleProofState(input);
}

describe('I.C.2 — Canonical Sale Proof State', () => {
  it('1. trusted canonical invoice (directInvoiceLink) with no contradiction -> proven', () => {
    const result = assess(
      attribution({ attributionLevel: 'proven', selectedCandidate: candidate({ directInvoiceLink: true }) }),
      bim()
    );
    expect(result.state).toBe('proven');
    expect(result.trustedInvoiceId).toBe('inv-1');
    expect(result.confidence.level).toBe('proven');
    expect(result.proofSource).toBe('trusted_invoice');
  });

  it('2. strong statistical match (clean, unambiguous, official) WITHOUT a trusted invoice -> strongly_supported, never proven', () => {
    const result = assess(attribution(), bim());
    expect(result.state).toBe('strongly_supported');
    expect(result.trustedInvoiceId).toBeNull();
  });

  it('3. weak statistical match -> weakly_supported', () => {
    const result = assess(
      attribution({
        attributionLevel: 'weakly_inferred',
        isOfficialForStaffEvaluation: false,
        confidence: { level: 'weakly_inferred', score: 0.3, ruleIds: [], evidence: [] },
        selectedCandidate: candidate({
          customerIdMatch: false,
          branchMatch: 'unknown',
          timeMatchStrength: 'weak',
          announcedTotalMatch: 'not_available',
          confidenceAssessment: { level: 'weakly_inferred', score: 0.3, ruleIds: [], evidence: [] },
        }),
      }),
      bim({ headerEvidenceReady: false, totalMatch: 'insufficient_data', integrityEvaluationScope: 'insufficient' })
    );
    expect(result.state).toBe('weakly_supported');
    expect(result.trustedInvoiceId).toBeNull();
  });

  it('4. no invoice candidates at all -> unknown', () => {
    const result = assess(
      attribution({
        candidateCount: 0,
        selectedInvoiceId: null,
        selectedInvoiceNumber: null,
        selectedCandidate: null,
        attributionLevel: 'unknown',
        confidence: { level: 'unknown', score: 0, ruleIds: [], evidence: [] },
        isOfficialForStaffEvaluation: false,
        hasAttributedInvoice: false,
      }),
      bim({
        invoiceId: null,
        invoiceNumber: null,
        totalMatch: 'insufficient_data',
        overallMatch: 'insufficient_data',
        headerEvidenceReady: false,
        integrityEvaluationScope: 'insufficient',
      })
    );
    expect(result.state).toBe('unknown');
    expect(result.proofSource).toBe('none');
    expect(result.trustedInvoiceId).toBeNull();
  });

  it('5. customer conflict (phone matches, customer_id differs) -> contradicted, not merely weak', () => {
    const result = assess(
      attribution({
        selectedCandidate: candidate({ identityConflict: 'phone_vs_customer_id_conflict', phoneMatch: true, customerIdMatch: false }),
      }),
      bim()
    );
    expect(result.state).toBe('contradicted');
    expect(result.contradictions).toContain('cross_customer_invoice_link');
    expect(result.trustedInvoiceId).toBeNull();
  });

  it('6. trusted invoice missing + commercial closure complete -> never proven (conversation confidence alone proves nothing)', () => {
    const result = assess(
      attribution({
        candidateCount: 0,
        selectedInvoiceId: null,
        selectedCandidate: null,
        attributionLevel: 'unknown',
        isOfficialForStaffEvaluation: false,
        hasAttributedInvoice: false,
        commercialConfirmationState: 'commercial_confirmation_complete',
      }),
      bim({ invoiceId: null, totalMatch: 'insufficient_data', headerEvidenceReady: false, integrityEvaluationScope: 'insufficient' })
    );
    expect(result.state).not.toBe('proven');
    expect(result.state).toBe('unknown');
  });

  it('7. staff "تم الارسال" fulfillment-intent language alone (no invoice candidate) -> never proven', () => {
    // commercialConfirmation.staffConfirmed being true (the "تم الارسال" signal) is not even an
    // input to this module — deriveSaleProofState only ever reads attribution/basketInvoiceMatch/
    // integrityAssessment, so a fully-confirmed conversation with zero invoice candidates cannot
    // reach anything but `unknown`, structurally.
    const result = assess(
      attribution({ candidateCount: 0, selectedInvoiceId: null, selectedCandidate: null, attributionLevel: 'unknown', isOfficialForStaffEvaluation: false, hasAttributedInvoice: false }),
      bim({ invoiceId: null, totalMatch: 'insufficient_data', headerEvidenceReady: false, integrityEvaluationScope: 'insufficient' })
    );
    expect(result.state).toBe('unknown');
  });

  it('8. invoice_match_status=verified (automated) alone, without a trusted link, never reaches proven even with decent statistical support', () => {
    // Mirrors I.C.1's own finding: legacyEvidenceMatch (the 'verified' automated match) contributes
    // only a small scoring factor — never directInvoiceLink. Even a strongly_inferred, official
    // result built partly from legacy evidence must land on strongly_supported, never proven.
    const result = assess(
      attribution({ legacyEvidenceUsed: true, selectedCandidate: candidate({ legacyEvidenceMatch: true, directInvoiceLink: false }) }),
      bim()
    );
    expect(result.state).toBe('strongly_supported');
    expect(result.state).not.toBe('proven');
    expect(result.trustedInvoiceId).toBeNull();
  });

  it('9. multiple competing (ambiguous) candidates never becomes proven', () => {
    const result = assess(
      attribution({
        candidateCount: 2,
        attributionLevel: 'weakly_inferred',
        isOfficialForStaffEvaluation: false,
        contradictions: ['ambiguous_multiple_candidates'],
        selectedCandidate: candidate({ directInvoiceLink: false }),
      }),
      bim()
    );
    expect(result.state).not.toBe('proven');
  });

  it('10. missing branch data (branchMatch=unknown) never auto-becomes contradicted', () => {
    const result = assess(attribution({ selectedCandidate: candidate({ branchMatch: 'unknown' }) }), bim());
    expect(result.state).not.toBe('contradicted');
    expect(result.contradictions).toEqual([]);
  });

  it('11. item evidence unavailable -> state never claims item-level verification', () => {
    const proven = assess(
      attribution({ attributionLevel: 'proven', selectedCandidate: candidate({ directInvoiceLink: true }) }),
      bim({ itemEvidenceReady: false, integrityEvaluationScope: 'header_only' })
    );
    expect(proven.state).toBe('proven');
    expect(proven.itemEvidenceReady).toBe(false);
    expect(proven.quantityEvidenceReady).toBe(false);
    expect(proven.invoiceEvidenceScope).toBe('header_only');
  });

  it('12. a directly trusted invoice ID with a cross-customer contradiction is NEVER passed through blindly as proven', () => {
    const result = assess(
      attribution({
        attributionLevel: 'proven',
        selectedCandidate: candidate({ directInvoiceLink: true, identityConflict: 'phone_vs_customer_id_conflict', phoneMatch: true, customerIdMatch: false }),
      }),
      bim()
    );
    expect(result.state).toBe('contradicted');
    expect(result.state).not.toBe('proven');
    expect(result.trustedInvoiceId).toBeNull();
    expect(result.proofSource).toBe('trusted_invoice_with_contradiction');
  });

  it('13. invariant: trustedInvoiceId !== null <=> state === proven (both directions)', () => {
    const proven = assess(
      attribution({ attributionLevel: 'proven', selectedCandidate: candidate({ directInvoiceLink: true }) }),
      bim()
    );
    expect(proven.state).toBe('proven');
    expect(proven.trustedInvoiceId).not.toBeNull();

    // trustedInvoiceId === null => state !== 'proven', even when everything else about the
    // candidate is strong — directInvoiceLink is false here (no I.C.1-eligible trusted link).
    const notTrusted = assess(attribution({ selectedCandidate: candidate({ directInvoiceLink: false }) }), bim());
    expect(notTrusted.trustedInvoiceId).toBeNull();
    expect(notTrusted.state).not.toBe('proven');

    // A hard contradiction on an otherwise-trusted candidate must also leave trustedInvoiceId null.
    const contradicted = assess(
      attribution({
        attributionLevel: 'proven',
        selectedCandidate: candidate({ directInvoiceLink: true, identityConflict: 'phone_vs_customer_id_conflict' }),
      }),
      bim()
    );
    expect(contradicted.trustedInvoiceId).toBeNull();
    expect(contradicted.state).not.toBe('proven');
  });

  it('14. duplicate invoice_number across two branches never cross-contaminates state (identity is always by real id)', () => {
    // Real Production shape (I.C.0 audit): invoice_number "32069" exists once at فرع الشامي and
    // once at فرع شكري as two entirely different invoices with two different sales_invoices.id
    // values. Two independent cases, each trusted on their OWN invoice id, must each resolve their
    // own distinct proven trustedInvoiceId — never each other's.
    const caseShamy = assess(
      attribution({
        selectedInvoiceId: '31682815-branch-shamy-real-id',
        selectedInvoiceNumber: '32069',
        attributionLevel: 'proven',
        selectedCandidate: candidate({ invoiceId: '31682815-branch-shamy-real-id', invoiceNumber: '32069', directInvoiceLink: true, branchMatch: 'exact_canonical' }),
      }),
      bim({ invoiceId: '31682815-branch-shamy-real-id', invoiceNumber: '32069' })
    );
    const caseShokry = assess(
      attribution({
        selectedInvoiceId: '22a61dc5-branch-shokry-real-id',
        selectedInvoiceNumber: '32069',
        attributionLevel: 'proven',
        selectedCandidate: candidate({ invoiceId: '22a61dc5-branch-shokry-real-id', invoiceNumber: '32069', directInvoiceLink: true, branchMatch: 'exact_canonical' }),
      }),
      bim({ invoiceId: '22a61dc5-branch-shokry-real-id', invoiceNumber: '32069' })
    );
    expect(caseShamy.state).toBe('proven');
    expect(caseShokry.state).toBe('proven');
    expect(caseShamy.trustedInvoiceId).toBe('31682815-branch-shamy-real-id');
    expect(caseShokry.trustedInvoiceId).toBe('22a61dc5-branch-shokry-real-id');
    expect(caseShamy.trustedInvoiceId).not.toBe(caseShokry.trustedInvoiceId);
  });

  it('15. a trusted invoice with a real branch mismatch (within trusted-evidence context) is contradicted', () => {
    const result = assess(
      attribution({ attributionLevel: 'proven', selectedCandidate: candidate({ directInvoiceLink: true, branchMatch: 'mismatch' }) }),
      bim()
    );
    expect(result.state).toBe('contradicted');
    expect(result.contradictions).toContain('cross_branch_invoice_link');
  });

  it('16. a merely statistical candidate with a branch mismatch is NOT force-contradicted (branch mismatches are common/expected for non-trusted candidates)', () => {
    const result = assess(
      attribution({
        attributionLevel: 'weakly_inferred',
        isOfficialForStaffEvaluation: false,
        selectedCandidate: candidate({ directInvoiceLink: false, branchMatch: 'mismatch' }),
      }),
      bim()
    );
    expect(result.state).not.toBe('contradicted');
  });

  it('17. a competing case claiming the same invoice is a contradiction even on an otherwise-trusted candidate', () => {
    const result = assess(
      attribution({
        attributionLevel: 'proven',
        selectedCandidate: candidate({ directInvoiceLink: true }),
        competingCaseIds: ['other-case-1'],
      }),
      bim()
    );
    expect(result.state).toBe('contradicted');
    expect(result.contradictions).toContain('cross_case_invoice_collision');
  });

  it('18. an unexplained real total mismatch against the trusted selected invoice contradicts it', () => {
    const result = assess(
      attribution({ attributionLevel: 'proven', selectedCandidate: candidate({ directInvoiceLink: true }) }),
      bim({
        totalMatch: 'mismatch',
        overallMatch: 'mismatch',
        differences: [
          { type: 'total_mismatch', key: 'total', before: 180, after: 500, explanation: 'none', evidence: [], confidence: { level: 'proven', score: 0.9, ruleIds: [], evidence: [] } },
          { type: 'unexplained_difference', key: 'total', before: 180, after: 500, explanation: 'none', evidence: [], confidence: { level: 'unknown', score: 0.3, ruleIds: [], evidence: [] } },
        ],
      })
    );
    expect(result.state).toBe('contradicted');
    expect(result.contradictions).toContain('unexplained_amount_conflict');
  });
});
