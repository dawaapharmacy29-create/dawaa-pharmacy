// Sales Intelligence Phase H.1B — immutable case-analysis (sales_intelligence_case_analyses)
// writer. Calls the atomic `sales_intelligence_write_case_analysis` RPC (design doc §26/§27) rather
// than a client-side read-then-write sequence — H.1B instruction #7 explicitly forbids improvising
// a fragile multi-step transaction once a real concurrency hazard (two workers, same case_id) was
// identified; the RPC is what makes "one current row per case_id, always" safe under real races.
import { computeSemanticSourceHash } from './hashing';
import type { CaseAnalysisRowContent } from './mappers';
import { BRANCH_IDENTITY_MAPPING_VERSION, ENGINE_VERSIONS, PIPELINE_VERSION } from './versions';

export interface PersistCaseAnalysisResult {
  analysisId: string;
  analysisVersion: number;
  isCurrent: boolean;
  /** True only when this call actually inserted a new row — false on a same-hash no-op. */
  isNew: boolean;
  semanticSourceHash: string;
}

/**
 * Computes semanticSourceHash and calls the atomic RPC. Idempotency (design doc/H.1B instruction
 * #6): identical case_id + semantic_source_hash + pipeline_version + all four engine versions =>
 * no new row, the RPC returns the existing current analysis unchanged. Any difference => a brand
 * new immutable row, the old current row superseded — never an UPDATE of semantic fields on an
 * existing row (case_analyses is fully immutable once written, per H.0.2).
 */
export async function persistCaseAnalysis(
  supabaseClient: any,
  caseId: string,
  rawWhatsAppExportText: string,
  content: CaseAnalysisRowContent
): Promise<PersistCaseAnalysisResult> {
  const semanticSourceHash = await computeSemanticSourceHash({
    rawWhatsAppExportText,
    branchIdentityMappingVersion: BRANCH_IDENTITY_MAPPING_VERSION,
  });

  const { data, error } = await supabaseClient.rpc('sales_intelligence_write_case_analysis', {
    p_case_id: caseId,
    p_row: {
      pipeline_version: PIPELINE_VERSION,
      engine_version_case_segmentation: ENGINE_VERSIONS.caseSegmentation,
      engine_version_historical_closure: ENGINE_VERSIONS.historicalClosure,
      engine_version_commercial_confirmation: ENGINE_VERSIONS.commercialConfirmation,
      engine_version_protocol_applicability: ENGINE_VERSIONS.protocolApplicability,
      semantic_source_hash: semanticSourceHash,
      case_type: content.caseType,
      case_status: content.caseStatus,
      pipeline_status: content.pipelineStatus,
      overall_evidence_level: content.overallEvidenceLevel,
      identity_customer_id: content.identityAtAnalysis.customerId,
      identity_customer_phone: content.identityAtAnalysis.customerPhone,
      identity_branch_id: content.identityAtAnalysis.branchId,
      identity_branch_name_raw: content.identityAtAnalysis.branchNameRaw,
      case_started_at: content.caseStartedAt,
      case_ended_at: content.caseEndedAt,
      historical_closure_level: content.historicalClosureLevel,
      commercial_confirmation_state: content.commercialConfirmationState,
      protocol_applicability: content.protocolApplicability,
      attribution_level: content.attributionLevel,
      integrity_evaluation_scope: content.integrityEvaluationScope,
      needs_human_review: content.needsHumanReview,
      human_review_reasons: content.humanReviewReasons,
      failure_reasons: content.failureReasons,
      pipeline_warnings: content.pipelineWarnings,
      evidence_snapshot: content.evidenceSnapshot,
    },
  });
  if (error) throw error;

  return {
    analysisId: data.analysis_id,
    analysisVersion: data.analysis_version,
    isCurrent: data.is_current,
    isNew: data.is_new,
    semanticSourceHash,
  };
}
