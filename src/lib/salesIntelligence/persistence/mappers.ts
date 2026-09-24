// Sales Intelligence Phase H.1B — pure mappers from engine output (SalesIntelligenceCaseAnalysis,
// ../types.ts) to persistence row content (persistence/types.ts). PURE FUNCTIONS ONLY — no
// Supabase, no hashing, no version/idempotency decisions (those live in each *Writer.ts and in
// hashing.ts). A mapper's only job is "given an already-computed engine result, what content
// belongs in this row" — never whether to write it, never what version number it gets.
import type { InvoiceLike } from '../../invoices/invoiceCore';
import type { EvidenceLevel, SalesIntelligenceCaseAnalysis } from '../types';
import type {
  SalesIntelligenceAttributionRow,
  SalesIntelligenceBasketInvoiceMatchRow,
  SalesIntelligenceCaseAnalysisRow,
  SalesIntelligenceCaseRow,
  SalesIntelligencePolicyEvaluationRow,
} from './types';

/** Content-only projection of SalesIntelligenceCaseRow — excludes caseId/createdAt/firstSeenAt/lastSeenAt, which caseWriter.ts owns (see its own module comment on why). */
export type CaseRowContent = Omit<SalesIntelligenceCaseRow, 'caseId' | 'createdAt' | 'firstSeenAt' | 'lastSeenAt'>;

/**
 * The CURRENT canonical identity pointer for sales_intelligence_cases — never historical evidence
 * (design doc H.0.2 §15: this table holds only current/correctable pointers, an analysis's own
 * identityAtAnalysis snapshot is the historical record). `conversationId` here is the caller's
 * already-resolved whatsapp_review_sources.id (uuid) — the pipeline's own `conversationId` field on
 * SalesIntelligenceCaseAnalysis is a string that may equal it exactly or be a composite root id;
 * mapCaseRowContent takes the resolved uuid explicitly rather than assuming that equivalence.
 */
export function mapCaseRowContent(analysis: SalesIntelligenceCaseAnalysis, conversationRowId: string): CaseRowContent {
  const cc = analysis.conversationCase;
  return {
    conversationId: conversationRowId,
    sourceCaseIdV22: cc.sourceCaseIdV22,
    customerId: cc.customerId,
    customerPhone: cc.customerPhone,
    branchId: cc.branchId,
    branchNameRaw: cc.branchNameRaw,
    caseStartedAt: cc.startedAt,
    caseEndedAt: cc.endedAt,
  };
}

/** Content-only projection of SalesIntelligenceCaseAnalysisRow — excludes every provenance/versioning field (analysisId, analysisVersion, pipelineVersion, engineVersions, semanticSourceHash, analyzedAt, isCurrent, supersededAt, supersededByAnalysisId, caseId), which analysisWriter.ts owns. */
export type CaseAnalysisRowContent = Omit<
  SalesIntelligenceCaseAnalysisRow,
  keyof {
    analysisId: unknown;
    caseId: unknown;
    analysisVersion: unknown;
    pipelineVersion: unknown;
    engineVersions: unknown;
    semanticSourceHash: unknown;
    analyzedAt: unknown;
    isCurrent: unknown;
    supersededAt: unknown;
    supersededByAnalysisId: unknown;
  }
>;

/**
 * The SEMANTIC FACTS the case_analyses row stores (design doc H.0.2 §9): never
 * protocolPolicyCompliance (that lives on sales_intelligence_policy_evaluations, computed
 * separately by policyEvaluationWriter.ts from this same analysis once persisted).
 */
export function mapCaseAnalysisRowContent(analysis: SalesIntelligenceCaseAnalysis): CaseAnalysisRowContent {
  const cc = analysis.conversationCase;
  return {
    caseType: cc.caseType,
    caseStatus: cc.status,
    pipelineStatus: analysis.status,
    overallEvidenceLevel: analysis.evidenceCompleteness.overallEvidenceLevel,
    identityAtAnalysis: {
      customerId: cc.customerId,
      customerPhone: cc.customerPhone,
      branchId: cc.branchId,
      branchNameRaw: cc.branchNameRaw,
    },
    caseStartedAt: cc.startedAt,
    caseEndedAt: cc.endedAt,
    historicalClosureLevel: analysis.historicalClosure.closureLevel,
    commercialConfirmationState: analysis.commercialConfirmation.currentState,
    protocolApplicability: analysis.protocolAssessment.applicability ?? 'applicable',
    attributionLevel: analysis.attribution.attributionLevel,
    integrityEvaluationScope: analysis.basketInvoiceMatch.integrityEvaluationScope,
    needsHumanReview: analysis.needsHumanReview,
    humanReviewReasons: analysis.humanReviewReasons,
    failureReasons: analysis.failureReasons,
    pipelineWarnings: analysis.pipelineWarnings,
    evidenceSnapshot: {
      conversationCaseConfidence: {
        level: cc.confidence.level,
        score: cc.confidence.score,
        ruleIds: cc.confidence.ruleIds,
      },
      evidenceCompleteness: analysis.evidenceCompleteness as unknown as Record<string, boolean | EvidenceLevel>,
      historicalClosureEvidence: analysis.historicalClosure.confidence.evidence,
      // No dedicated applicability-rule-id field exists on OrderConfirmationProtocolAssessment —
      // applicability is DERIVED from historicalClosure + commercialConfirmation (see
      // salesIntelligencePipeline.ts's own data-flow comment: "historicalClosure is computed
      // BEFORE applicability and consumed BY it as one evidence source"), so the rule ids that
      // actually explain an applicability verdict are historicalClosure's own ruleIds. Documented
      // choice, not a guess.
      protocolApplicabilityRuleIds: analysis.historicalClosure.ruleIds,
    },
  };
}

/** Content-only projection of SalesIntelligenceAttributionRow — excludes AnalysisDependentProvenanceFields (id, analysisId, caseId, evaluationVersion, isCurrentEvaluation, evaluatedAt, supersededAt, supersededByEvaluationVersion) and attributionEngineVersion/attributionInputHash, which attributionWriter.ts owns. */
export type AttributionRowContent = Omit<
  SalesIntelligenceAttributionRow,
  keyof {
    id: unknown;
    analysisId: unknown;
    caseId: unknown;
    evaluationVersion: unknown;
    isCurrentEvaluation: unknown;
    evaluatedAt: unknown;
    supersededAt: unknown;
    supersededByEvaluationVersion: unknown;
    attributionEngineVersion: unknown;
    attributionInputHash: unknown;
  }
>;

export function mapAttributionRowContent(analysis: SalesIntelligenceCaseAnalysis): AttributionRowContent {
  const attribution = analysis.attribution;
  const selected = attribution.selectedCandidate;
  return {
    identityAtEvaluation: {
      customerId: analysis.conversationCase.customerId,
      customerPhone: analysis.conversationCase.customerPhone,
    },
    selectedInvoiceId: attribution.selectedInvoiceId,
    selectedInvoiceNumber: attribution.selectedInvoiceNumber,
    attributionLevel: attribution.attributionLevel,
    confidenceScore: attribution.confidence.score,
    isOfficialForStaffEvaluation: attribution.isOfficialForStaffEvaluation,
    competingCaseIds: attribution.competingCaseIds,
    ambiguityStatus: attribution.contradictions.includes('ambiguous_multiple_candidates')
      ? 'ambiguous_multiple_candidates'
      : 'none',
    identityConflict: selected?.identityConflict ?? 'none',
    branchConflict: selected?.branchMatch === 'mismatch',
    candidateCount: attribution.candidateCount,
    primaryEvidence: attribution.primaryEvidence,
    contradictions: attribution.contradictions,
    ruleIds: attribution.ruleIds,
    legacyEvidenceUsed: attribution.legacyEvidenceUsed,
  };
}

/** Content-only projection of SalesIntelligenceBasketInvoiceMatchRow — excludes AnalysisDependentProvenanceFields, attributionRowId, matchingEngineVersion, and matchingInputHash, which basketInvoiceMatchWriter.ts owns. */
export type BasketInvoiceMatchRowContent = Omit<
  SalesIntelligenceBasketInvoiceMatchRow,
  keyof {
    id: unknown;
    analysisId: unknown;
    caseId: unknown;
    evaluationVersion: unknown;
    isCurrentEvaluation: unknown;
    evaluatedAt: unknown;
    supersededAt: unknown;
    supersededByEvaluationVersion: unknown;
    attributionRowId: unknown;
    matchingEngineVersion: unknown;
    matchingInputHash: unknown;
  }
>;

export function mapBasketInvoiceMatchRowContent(analysis: SalesIntelligenceCaseAnalysis): BasketInvoiceMatchRowContent {
  const match = analysis.basketInvoiceMatch;
  return {
    basketId: match.basketId,
    basketVersion: match.basketVersion,
    invoiceId: match.invoiceId,
    invoiceNumber: match.invoiceNumber,
    totalMatch: match.totalMatch,
    itemMatch: match.itemMatch,
    quantityMatch: match.quantityMatch,
    overallMatch: match.overallMatch,
    headerEvidenceReady: match.headerEvidenceReady,
    itemEvidenceReady: match.itemEvidenceReady,
    // Never upgraded here (H.1B instruction #11) — this is exactly what basketInvoiceMatchingEngine
    // itself returned; the writer/mapper layer has no opinion and applies no promotion logic.
    integrityEvaluationScope: match.integrityEvaluationScope,
    differences: match.differences.map((difference) => ({
      type: difference.type,
      key: difference.key,
      before: difference.before,
      after: difference.after,
      explanation: difference.explanation,
    })),
    needsHumanReview: match.needsHumanReview,
    humanReviewReasons: match.humanReviewReasons,
  };
}

/** Content-only projection of SalesIntelligencePolicyEvaluationRow — excludes provenance/versioning fields, which policyEvaluationWriter.ts owns. */
export type PolicyEvaluationRowContent = Omit<
  SalesIntelligencePolicyEvaluationRow,
  keyof {
    policyEvaluationId: unknown;
    analysisId: unknown;
    caseId: unknown;
    policyConfigId: unknown;
    policyConfigVersion: unknown;
    evaluationVersion: unknown;
    policyInputHash: unknown;
    isCurrent: unknown;
    evaluatedAt: unknown;
    supersededAt: unknown;
    supersededByPolicyEvaluationId: unknown;
  }
>;

export function mapPolicyEvaluationRowContent(
  analysis: SalesIntelligenceCaseAnalysis,
  protocolPolicyEffectiveAt: string | null
): PolicyEvaluationRowContent {
  return {
    protocolPolicyEffectiveAt,
    protocolApplicability: analysis.protocolAssessment.applicability ?? 'applicable',
    protocolPolicyCompliance: analysis.integrityAssessment.protocolPolicyCompliance,
  };
}

/**
 * Mirrors salesIntelligencePipeline.ts's own private `invoiceRowLookupId()` field-priority
 * (id, invoice_number, invoice_no) — duplicated here (not imported, since the pipeline keeps it
 * private on purpose) so the batch service can re-find the exact invoice row it already fetched,
 * for computeMatchingInputHash. Never re-derives attribution — purely a lookup-key helper.
 */
export function invoiceRowLookupId(row: InvoiceLike): string {
  const value = (row as Record<string, unknown>).id ?? (row as Record<string, unknown>).invoice_number ?? (row as Record<string, unknown>).invoice_no;
  return String(value ?? '').trim();
}
