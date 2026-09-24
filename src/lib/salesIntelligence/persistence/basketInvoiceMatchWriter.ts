// Sales Intelligence Phase H.1B — basket-invoice-match (sales_intelligence_basket_invoice_matches)
// writer. Writes ONLY against the exact analysisId + exact PERSISTED attributionRowId the caller
// hands in — never re-derives or looks up "whichever attribution is current now" (H.1B instruction
// #11). Calls the atomic `sales_intelligence_write_basket_invoice_match` RPC (design doc §26/§27).
import { computeMatchingInputHash, type MatchingInputHashItem } from './hashing';
import type { BasketInvoiceMatchRowContent } from './mappers';
import { ENGINE_VERSIONS } from './versions';

export interface PersistBasketInvoiceMatchResult {
  matchRowId: string;
  evaluationVersion: number;
  isCurrentEvaluation: boolean;
  isNew: boolean;
  matchingInputHash: string;
}

export async function persistBasketInvoiceMatch(
  supabaseClient: any,
  analysisId: string,
  caseId: string,
  attributionRowId: string,
  /** The active basket's own items AT MATCH TIME — caller supplies these (e.g. from `analysis.itemsByBasketId[analysis.activeBasket?.basketId ?? '']`); this writer never re-derives them, only hashes them. */
  activeItems: MatchingInputHashItem[],
  content: BasketInvoiceMatchRowContent,
  invoiceItemEvidenceSnapshot: unknown = null
): Promise<PersistBasketInvoiceMatchResult> {
  const matchingInputHash = await computeMatchingInputHash({
    basketId: content.basketId,
    basketVersion: content.basketVersion,
    activeItems,
    selectedInvoiceId: content.invoiceId,
    selectedInvoiceNumber: content.invoiceNumber,
    matchingEngineVersion: ENGINE_VERSIONS.matching,
    invoiceItemEvidenceSnapshot,
  });

  const { data, error } = await supabaseClient.rpc('sales_intelligence_write_basket_invoice_match', {
    p_analysis_id: analysisId,
    p_row: {
      case_id: caseId,
      attribution_row_id: attributionRowId,
      matching_engine_version: ENGINE_VERSIONS.matching,
      matching_input_hash: matchingInputHash,
      basket_id: content.basketId,
      basket_version: content.basketVersion,
      invoice_id: content.invoiceId,
      invoice_number: content.invoiceNumber,
      total_match: content.totalMatch,
      item_match: content.itemMatch,
      quantity_match: content.quantityMatch,
      overall_match: content.overallMatch,
      header_evidence_ready: content.headerEvidenceReady,
      item_evidence_ready: content.itemEvidenceReady,
      integrity_evaluation_scope: content.integrityEvaluationScope,
      differences: content.differences,
      needs_human_review: content.needsHumanReview,
      human_review_reasons: content.humanReviewReasons,
    },
  });
  if (error) throw error;

  return {
    matchRowId: data.id,
    evaluationVersion: data.evaluation_version,
    isCurrentEvaluation: data.is_current_evaluation,
    isNew: data.is_new,
    matchingInputHash,
  };
}
