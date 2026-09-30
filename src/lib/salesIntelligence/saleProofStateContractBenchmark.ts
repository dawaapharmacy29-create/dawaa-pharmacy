// Phase I.C.2 — Sale Proof State CONTRACT benchmark.
//
// NOT a Ground Truth / real-data benchmark (that is I.C.3's job, explicitly deferred). This is a
// small, fully deterministic, synthetic-scenario benchmark that proves the deriveSaleProofState()
// MAPPING RULES themselves hold — never a measurement of real-world accuracy. Every scenario here
// is a named, hand-built SaleAttributionAssessment/BasketInvoiceMatch pair; there is no real
// conversation, invoice, or customer data anywhere in this file.
//
// Required, permanent zero-metrics (see the I.C.2 report):
//   false_proven_sale                — any scenario reaching 'proven' without trustedInvoiceId set,
//                                       or without a real directInvoiceLink candidate.
//   proven_without_trusted_evidence  — same invariant, phrased the other way round.
//   conversation_only_proven         — a scenario with strong CONVERSATION-side signals only
//                                       (commercial closure, staff fulfillment intent) and NO real
//                                       invoice candidate ever reaching 'proven'.
//   statistical_only_proven          — a scenario reaching 'proven' from statistical evidence alone
//                                       (no directInvoiceLink).
// All four MUST be 0 on every run, permanently — a future regression that breaks this must fail
// loudly, never be silently tolerated.
import { deriveSalesIntegrityAssessment, type SalesIntegrityInput } from './salesIntegrityEngine';
import { deriveSaleProofState, type SaleProofState } from './saleProofState';
import type {
  BasketInvoiceMatch,
  CommercialConfirmationAssessment,
  OrderConfirmationProtocolAssessment,
  SaleAttributionAssessment,
  SaleAttributionCandidate,
} from './types';

function cc(overrides: Partial<CommercialConfirmationAssessment> = {}): CommercialConfirmationAssessment {
  return {
    caseId: 'c', basketId: 'b', basketVersion: 1, summaryPresented: true, customerConfirmed: true,
    staffConfirmed: true, announcedTotalPresent: true, modificationAfterConfirmation: false,
    currentState: 'commercial_confirmation_complete', primaryMessageIds: [], ruleIds: [],
    confidence: { level: 'strongly_inferred', score: 0.85, ruleIds: [], evidence: [] },
    needsHumanReview: false, humanReviewReasons: [], ...overrides,
  };
}

function protocol(overrides: Partial<OrderConfirmationProtocolAssessment> = {}): OrderConfirmationProtocolAssessment {
  return {
    caseId: 'c', basketId: 'b', basketVersion: 1, summaryCompliant: true, announcedTotalCompliant: true,
    customerConfirmationCompliant: true, staffFinalConfirmationCompliant: true, protocolCompliant: true,
    missingProtocolSteps: [], ...overrides,
  };
}

function candidate(overrides: Partial<SaleAttributionCandidate> = {}): SaleAttributionCandidate {
  return {
    caseId: 'c', invoiceId: 'inv-1', invoiceNumber: 'INV-1', customerIdMatch: true, phoneMatch: false,
    identityConflict: 'none', branchMatch: 'exact_canonical', timeDistanceMinutes: 10,
    timeMatchStrength: 'very_strong', staffMatch: 'unknown', announcedTotalMatch: 'exact',
    basketValueMatch: 'not_available', productMatch: 'unavailable', quantityMatch: 'unavailable',
    legacyEvidenceMatch: false, directOrderLink: false, directInvoiceLink: false, evidence: [],
    ruleIds: [], confidenceAssessment: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] },
    disqualifiers: [], ...overrides,
  };
}

function attribution(overrides: Partial<SaleAttributionAssessment> = {}): SaleAttributionAssessment {
  return {
    caseId: 'c', commercialConfirmationState: 'commercial_confirmation_complete', candidateCount: 1,
    selectedInvoiceId: 'inv-1', selectedInvoiceNumber: 'INV-1', selectedCandidate: candidate(),
    alternativeCandidates: [], attributionLevel: 'strongly_inferred',
    confidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] }, primaryEvidence: [],
    contradictions: [], needsHumanReview: false, humanReviewReasons: [], isOfficialForStaffEvaluation: true,
    legacyEvidenceUsed: false, ruleIds: [], hasAttributedInvoice: true, competingCaseIds: [], ...overrides,
  };
}

function bim(overrides: Partial<BasketInvoiceMatch> = {}): BasketInvoiceMatch {
  return {
    matchId: 'm', caseId: 'c', basketId: 'b', basketVersion: 1, invoiceId: 'inv-1', invoiceNumber: 'INV-1',
    totalMatch: 'exact', itemMatch: 'insufficient_data', quantityMatch: 'insufficient_data',
    overallMatch: 'partial', headerEvidenceReady: true, itemEvidenceReady: false,
    integrityEvaluationScope: 'header_only', differences: [],
    confidence: { level: 'strongly_inferred', score: 0.8, ruleIds: [], evidence: [] }, needsHumanReview: false,
    humanReviewReasons: [], ruleIds: [], ...overrides,
  };
}

interface Scenario {
  name: string;
  attribution: SaleAttributionAssessment;
  basketInvoiceMatch: BasketInvoiceMatch;
  expectedState: SaleProofState;
  /** True only for scenarios deliberately modeling "conversation confidence alone" (no real invoice candidate). */
  conversationOnly?: boolean;
  /** True only for scenarios deliberately modeling "'verified' automated match / statistical evidence, no trusted link". */
  statisticalOnly?: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'trusted_invoice_clean',
    attribution: attribution({ attributionLevel: 'proven', selectedCandidate: candidate({ directInvoiceLink: true }) }),
    basketInvoiceMatch: bim(),
    expectedState: 'proven',
  },
  {
    name: 'statistical_strong_clean',
    attribution: attribution(),
    basketInvoiceMatch: bim(),
    expectedState: 'strongly_supported',
    statisticalOnly: true,
  },
  {
    name: 'statistical_weak',
    attribution: attribution({
      attributionLevel: 'weakly_inferred',
      isOfficialForStaffEvaluation: false,
      selectedCandidate: candidate({ customerIdMatch: false, branchMatch: 'unknown', timeMatchStrength: 'weak' }),
    }),
    basketInvoiceMatch: bim({ headerEvidenceReady: false, totalMatch: 'insufficient_data', integrityEvaluationScope: 'insufficient' }),
    expectedState: 'weakly_supported',
  },
  {
    name: 'no_candidates_conversation_complete',
    attribution: attribution({
      candidateCount: 0, selectedInvoiceId: null, selectedCandidate: null, attributionLevel: 'unknown',
      isOfficialForStaffEvaluation: false, hasAttributedInvoice: false,
    }),
    basketInvoiceMatch: bim({ invoiceId: null, totalMatch: 'insufficient_data', headerEvidenceReady: false, integrityEvaluationScope: 'insufficient' }),
    expectedState: 'unknown',
    conversationOnly: true,
  },
  {
    name: 'cross_customer_identity_conflict',
    attribution: attribution({ selectedCandidate: candidate({ identityConflict: 'phone_vs_customer_id_conflict', phoneMatch: true, customerIdMatch: false }) }),
    basketInvoiceMatch: bim(),
    expectedState: 'contradicted',
  },
  {
    name: 'trusted_plus_cross_customer_conflict',
    attribution: attribution({
      attributionLevel: 'proven',
      selectedCandidate: candidate({ directInvoiceLink: true, identityConflict: 'phone_vs_customer_id_conflict' }),
    }),
    basketInvoiceMatch: bim(),
    expectedState: 'contradicted',
  },
  {
    name: 'trusted_plus_branch_mismatch',
    attribution: attribution({ attributionLevel: 'proven', selectedCandidate: candidate({ directInvoiceLink: true, branchMatch: 'mismatch' }) }),
    basketInvoiceMatch: bim(),
    expectedState: 'contradicted',
  },
  {
    name: 'statistical_branch_mismatch_not_contradicted',
    attribution: attribution({
      attributionLevel: 'weakly_inferred',
      isOfficialForStaffEvaluation: false,
      selectedCandidate: candidate({ directInvoiceLink: false, branchMatch: 'mismatch' }),
    }),
    basketInvoiceMatch: bim(),
    expectedState: 'weakly_supported',
  },
  {
    name: 'ambiguous_multiple_candidates',
    attribution: attribution({
      candidateCount: 2, attributionLevel: 'weakly_inferred', isOfficialForStaffEvaluation: false,
      contradictions: ['ambiguous_multiple_candidates'], selectedCandidate: candidate({ directInvoiceLink: false }),
    }),
    basketInvoiceMatch: bim(),
    expectedState: 'weakly_supported',
  },
  {
    name: 'competing_case_same_invoice',
    attribution: attribution({ attributionLevel: 'proven', selectedCandidate: candidate({ directInvoiceLink: true }), competingCaseIds: ['other-case'] }),
    basketInvoiceMatch: bim(),
    expectedState: 'contradicted',
  },
  {
    name: 'missing_branch_data_not_contradicted',
    attribution: attribution({ selectedCandidate: candidate({ branchMatch: 'unknown' }) }),
    basketInvoiceMatch: bim(),
    expectedState: 'strongly_supported',
  },
  {
    name: 'verified_automated_match_alone_never_proven',
    attribution: attribution({ legacyEvidenceUsed: true, selectedCandidate: candidate({ legacyEvidenceMatch: true, directInvoiceLink: false }) }),
    basketInvoiceMatch: bim(),
    expectedState: 'strongly_supported',
    statisticalOnly: true,
  },
];

export interface SaleProofStateContractBenchmarkReport {
  scenarioCount: number;
  stateCounts: Record<SaleProofState, number>;
  /** Every scenario's name -> the state it actually produced (for drill-down / diffing across runs). */
  resultsByScenario: Record<string, SaleProofState>;
  mismatches: Array<{ scenario: string; expected: SaleProofState; actual: SaleProofState }>;
  falseProvenSale: number;
  provenWithoutTrustedEvidence: number;
  conversationOnlyProven: number;
  statisticalOnlyProven: number;
  allInvariantsHold: boolean;
}

/** Pure, deterministic — no I/O, no randomness. Running this twice must produce byte-identical JSON. */
export function runSaleProofStateContractBenchmark(): SaleProofStateContractBenchmarkReport {
  const stateCounts: Record<SaleProofState, number> = { proven: 0, strongly_supported: 0, weakly_supported: 0, unknown: 0, contradicted: 0 };
  const resultsByScenario: Record<string, SaleProofState> = {};
  const mismatches: SaleProofStateContractBenchmarkReport['mismatches'] = [];
  let falseProvenSale = 0;
  let provenWithoutTrustedEvidence = 0;
  let conversationOnlyProven = 0;
  let statisticalOnlyProven = 0;

  for (const scenario of SCENARIOS) {
    const integrityAssessment = deriveSalesIntegrityAssessment({
      caseId: 'c',
      commercialConfirmation: cc(),
      protocolAssessment: protocol(),
      attribution: scenario.attribution,
      basketInvoiceMatch: scenario.basketInvoiceMatch,
    } satisfies SalesIntegrityInput);

    const result = deriveSaleProofState({
      attribution: scenario.attribution,
      basketInvoiceMatch: scenario.basketInvoiceMatch,
      integrityAssessment,
    });

    stateCounts[result.state] += 1;
    resultsByScenario[scenario.name] = result.state;
    if (result.state !== scenario.expectedState) {
      mismatches.push({ scenario: scenario.name, expected: scenario.expectedState, actual: result.state });
    }

    if (result.state === 'proven') {
      const hasRealDirectLink = scenario.attribution.selectedCandidate?.directInvoiceLink === true;
      if (!hasRealDirectLink || result.trustedInvoiceId == null) falseProvenSale += 1;
      if (result.trustedInvoiceId == null) provenWithoutTrustedEvidence += 1;
      if (scenario.conversationOnly) conversationOnlyProven += 1;
      if (scenario.statisticalOnly) statisticalOnlyProven += 1;
    }
  }

  return {
    scenarioCount: SCENARIOS.length,
    stateCounts,
    resultsByScenario,
    mismatches,
    falseProvenSale,
    provenWithoutTrustedEvidence,
    conversationOnlyProven,
    statisticalOnlyProven,
    allInvariantsHold:
      mismatches.length === 0 && falseProvenSale === 0 && provenWithoutTrustedEvidence === 0 &&
      conversationOnlyProven === 0 && statisticalOnlyProven === 0,
  };
}
