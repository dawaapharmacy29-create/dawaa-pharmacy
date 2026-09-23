// Phase I.B.4 — shadow-only bridge from Basket V2 into the existing Historical Commercial Closure engine.
//
// This file does NOT replace historicalCommercialClosureEngine.ts and does NOT change canonical
// pipeline behavior. It exists only so I.B.4 can compare today's closure assessment against the
// richer Basket V2 semantic state without re-parsing products/quantities a second time.
import type { NormalizedConversationMessageV32 } from '../../whatsappConversationUnderstandingV32';
import { deriveHistoricalCommercialClosureAssessment } from '../historicalCommercialClosureEngine';
import type {
  CaseBasketItem,
  CommercialConfirmationAssessment,
  ConfidenceAssessment,
  HistoricalCommercialClosureAssessment,
} from '../types';
import type { BasketItemV2, CaseBasketV2 } from './basketV2Types';

function confidenceForItem(item: BasketItemV2): ConfidenceAssessment {
  switch (item.resolutionStatus) {
    case 'proven':
      return {
        level: 'proven',
        score: 0.95,
        ruleIds: ['basket_v2.shadow_adapter.proven_product_identity'],
        evidence: [],
      };
    case 'partially_proven':
      return {
        level: 'strongly_inferred',
        score: 0.7,
        ruleIds: ['basket_v2.shadow_adapter.partially_proven_product_identity'],
        evidence: [],
      };
    case 'unknown':
      return {
        level: 'unknown',
        score: 0.2,
        ruleIds: ['basket_v2.shadow_adapter.unknown_product_identity'],
        evidence: [],
      };
  }
}

function toLegacyCompatibleItem(basket: CaseBasketV2, item: BasketItemV2): CaseBasketItem {
  return {
    itemId: item.itemId,
    basketId: basket.basketId,
    productNameRaw: item.rawMentions[0] ?? item.canonicalName ?? '',
    productId: item.canonicalProductId,
    quantity: item.currentQuantity,
    unit: item.quantityUnit,
    unitPrice: item.unitPrice,
    lineTotal: item.lineTotal,
    sourceMessageId: item.evidenceHistory[0]?.sourceMessageId ?? basket.sourceMessageIds[0] ?? '',
    confidence: confidenceForItem(item),
    resolutionStatus: item.resolutionStatus,
  };
}

/**
 * Shadow-only closure assessment using Basket V2's current active items as the basket evidence.
 *
 * IMPORTANT:
 * - No persistence write.
 * - No policy/compliance change.
 * - No staff score.
 * - No sale proof.
 * - The existing closure engine remains the sole implementation of closure semantics; this adapter
 *   only supplies richer item evidence in its already-established input shape.
 */
export function deriveHistoricalClosureShadowFromBasketV2(
  caseId: string,
  scopedMessages: NormalizedConversationMessageV32[],
  commercial: CommercialConfirmationAssessment,
  basket: CaseBasketV2
): HistoricalCommercialClosureAssessment {
  const activeItems = basket.items
    .filter((item) => !['removed', 'rejected', 'substituted'].includes(item.itemState))
    .map((item) => toLegacyCompatibleItem(basket, item));

  return deriveHistoricalCommercialClosureAssessment(
    caseId,
    scopedMessages,
    commercial,
    activeItems,
    basket.announcedOrderTotal !== null
  );
}
