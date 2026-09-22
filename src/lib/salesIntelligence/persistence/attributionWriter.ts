// Sales Intelligence Phase H.1B — attribution (sales_intelligence_attributions) writer.
// Analysis-version-owned but independently re-evaluable (design doc H.0.1 §9-§11) — idempotency is
// scoped to (analysisId, attributionInputHash, attributionEngineVersion), never analysisVersion.
// Calls the atomic `sales_intelligence_write_attribution` RPC for the same reason analysisWriter.ts
// does (design doc §26/§27) — the current-row supersede must never race.
import { computeAttributionInputHash } from './hashing';
import type { AttributionRowContent } from './mappers';
import { ENGINE_VERSIONS } from './versions';

export interface PersistAttributionResult {
  attributionRowId: string;
  evaluationVersion: number;
  isCurrentEvaluation: boolean;
  isNew: boolean;
  attributionInputHash: string;
}

export interface AttributionInputContext {
  customerId: string | null;
  customerPhone: string | null;
  /** The candidate invoice id set actually offered to the attribution engine for this case — see computeAttributionInputHash's own doc comment on why order doesn't matter. */
  candidateInvoiceIds: string[];
  branchNameRaw: string | null;
}

export async function persistAttribution(
  supabaseClient: any,
  analysisId: string,
  caseId: string,
  inputContext: AttributionInputContext,
  content: AttributionRowContent
): Promise<PersistAttributionResult> {
  const attributionInputHash = await computeAttributionInputHash(inputContext);

  const { data, error } = await supabaseClient.rpc('sales_intelligence_write_attribution', {
    p_analysis_id: analysisId,
    p_row: {
      case_id: caseId,
      attribution_engine_version: ENGINE_VERSIONS.attribution,
      attribution_input_hash: attributionInputHash,
      identity_customer_id: content.identityAtEvaluation.customerId,
      identity_customer_phone: content.identityAtEvaluation.customerPhone,
      selected_invoice_id: content.selectedInvoiceId,
      selected_invoice_number: content.selectedInvoiceNumber,
      attribution_level: content.attributionLevel,
      confidence_score: content.confidenceScore,
      is_official_for_staff_evaluation: content.isOfficialForStaffEvaluation,
      competing_case_ids: content.competingCaseIds,
      ambiguity_status: content.ambiguityStatus,
      identity_conflict: content.identityConflict,
      branch_conflict: content.branchConflict,
      candidate_count: content.candidateCount,
      primary_evidence: content.primaryEvidence,
      contradictions: content.contradictions,
      rule_ids: content.ruleIds,
      legacy_evidence_used: content.legacyEvidenceUsed,
    },
  });
  if (error) throw error;

  return {
    attributionRowId: data.id,
    evaluationVersion: data.evaluation_version,
    isCurrentEvaluation: data.is_current_evaluation,
    isNew: data.is_new,
    attributionInputHash,
  };
}
