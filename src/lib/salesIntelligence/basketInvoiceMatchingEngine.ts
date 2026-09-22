// Sales Intelligence Phase E — Basket <-> Invoice Matching Engine.
//
// Compares the case's CURRENT (latest, never-superseded) basket version against the invoice
// Phase D already selected. This engine NEVER re-runs Sale Attribution (which invoice belongs to
// this case is entirely Phase D's decision, taken as-is) — it only verifies, for that ALREADY
// CHOSEN invoice, whether its content (total/items/quantities) actually matches the basket.
//
// NEVER assigns staff fault. A BasketInvoiceDifference is a fact about WHAT differs, never WHO is
// responsible — no staff id, no blame language, anywhere in this module's output.
//
// Pure functions only — no Supabase calls. sales_invoice_items_v21 has 0 rows in the live schema
// (see the Phase E ingestion-path investigation) — item/quantity matching is designed fully, but
// in production today an InvoiceItemEvidenceProvider honestly returns 'unavailable', never a
// guessed missing/extra item.
import { getInvoiceAmount, type InvoiceLike } from '../invoices/invoiceCore';
import {
  normalizeProductNameForMatch,
  unavailableInvoiceItemEvidenceProvider,
  type InvoiceItemEvidenceProvider,
} from './saleAttributionEngine';
import type {
  BasketInvoiceDifference,
  BasketInvoiceDifferenceType,
  BasketInvoiceMatch,
  CaseBasket,
  CaseBasketItem,
  ConfidenceAssessment,
  DifferenceExplanationKind,
  EvidenceRef,
  FieldMatchStatus,
  SaleAttributionAssessment,
} from './types';

// ---------------------------------------------------------------------------
// Centralized, documented tolerance — the SAME formula Phase D uses for its own total-match
// classification (see saleAttributionEngine.ts's AMOUNT_MATCH_TOLERANCE), reused here rather than
// re-invented so "near_match" means the same thing everywhere in this codebase.
// ---------------------------------------------------------------------------
export const TOTAL_MATCH_TOLERANCE = {
  absoluteEgp: 20,
  relativeFraction: 0.02,
} as const;

export type DocumentedAdjustmentKind = 'delivery_fee' | 'discount' | 'cashback' | 'documented_edit';

/**
 * A caller-supplied, EVIDENCE-BACKED fact about why the invoice total might legitimately differ
 * from the basket total — never invented by this engine. `amount` is signed: positive when the
 * invoice is higher than the basket (e.g. a delivery fee), negative when lower (a discount/cashback).
 */
export interface DocumentedAdjustment {
  kind: DocumentedAdjustmentKind;
  amount: number;
  evidence: EvidenceRef[];
}

export interface BasketInvoiceMatchingInput {
  caseId: string;
  /** Full version history — this engine selects the active (latest, never-superseded) version itself; never accept a version pointer from the caller, per the active-basket invariant. */
  baskets: CaseBasket[];
  itemsByBasketId: Record<string, CaseBasketItem[]>;
  /** Phase D's own result, taken as-is — this engine never re-selects or re-scores a candidate invoice. */
  attribution: SaleAttributionAssessment;
  /** The selected invoice's raw row — used only for its numeric amount and for item-evidence lookup; invoice identity (id/number) always comes from `attribution`, never re-derived from this row. Pass null when unavailable — total matching degrades to insufficient_data rather than throwing. */
  invoiceRow: InvoiceLike | null;
  itemEvidenceProvider?: InvoiceItemEvidenceProvider;
  documentedAdjustments?: DocumentedAdjustment[];
  /** An explicit, caller-confirmed fact (e.g. from an invoice status the caller has already verified) — never inferred from ambiguous free-text status columns. */
  invoiceCancelledOrReturned?: boolean;
}

function assessment(level: ConfidenceAssessment['level'], score: number, ruleIds: string[], evidence: EvidenceRef[]): ConfidenceAssessment {
  return { level, score, ruleIds, evidence };
}

function amountRef(description: string): EvidenceRef {
  return { sourceTable: 'sales_invoices', sourceId: '', description };
}

/** The ONLY place the active basket is selected — never a version pointer from the caller (rule: no old basket/total may enter matching). */
function selectActiveBasket(baskets: CaseBasket[]): CaseBasket | null {
  if (baskets.length === 0) return null;
  return baskets[baskets.length - 1];
}

/**
 * Raw amount-match classification, reusing Phase D's exact tolerance formula. Returns the
 * generic 'exact' | 'near_match' | 'different' | 'not_available' vocabulary, mapped by the
 * caller into this engine's own FieldMatchStatus (mapAmountToFieldStatus below).
 */
function classifyAmountDifference(expected: number | null, actual: number | null): 'exact' | 'near_match' | 'different' | 'not_available' {
  if (expected == null || actual == null) return 'not_available';
  const diff = Math.abs(expected - actual);
  if (diff === 0) return 'exact';
  const tolerance = Math.max(TOTAL_MATCH_TOLERANCE.absoluteEgp, expected * TOTAL_MATCH_TOLERANCE.relativeFraction);
  return diff <= tolerance ? 'near_match' : 'different';
}

function mapAmountToFieldStatus(kind: 'exact' | 'near_match' | 'different' | 'not_available'): FieldMatchStatus {
  if (kind === 'different') return 'mismatch';
  if (kind === 'not_available') return 'insufficient_data';
  return kind;
}

/**
 * Reconciles a real total gap against caller-supplied documented adjustments (delivery fee,
 * discount, cashback, a documented conversation edit). Only ever classifies 'explained_difference'
 * when the adjustments actually account for the gap within the same tolerance — never guessed.
 */
function explainTotalGap(
  rawDiff: number,
  adjustments: DocumentedAdjustment[]
): { explanation: DifferenceExplanationKind; evidence: EvidenceRef[] } {
  if (adjustments.length === 0) return { explanation: 'none', evidence: [] };
  const adjustmentSum = adjustments.reduce((sum, a) => sum + a.amount, 0);
  const residual = Math.abs(rawDiff - adjustmentSum);
  const tolerance = Math.max(TOTAL_MATCH_TOLERANCE.absoluteEgp, Math.abs(rawDiff) * TOTAL_MATCH_TOLERANCE.relativeFraction);
  if (residual > tolerance) return { explanation: 'none', evidence: [] };
  // Single-kind adjustments report that kind; a mix of kinds is reported as a documented edit —
  // still explained, but not misleadingly labeled as one specific kind.
  const kinds = new Set(adjustments.map((a) => a.kind));
  const explanation: DifferenceExplanationKind = kinds.size === 1 ? adjustments[0].kind : 'documented_edit';
  return { explanation, evidence: adjustments.flatMap((a) => a.evidence) };
}

function classifyTotalMatch(
  activeBasket: CaseBasket,
  invoiceRow: InvoiceLike | null
): { status: FieldMatchStatus; basketAmount: number | null; invoiceAmount: number | null } {
  const basketAmount = activeBasket.announcedTotal?.amount ?? null;
  const invoiceAmount = invoiceRow ? getInvoiceAmount(invoiceRow) : null;
  const status = mapAmountToFieldStatus(classifyAmountDifference(basketAmount, invoiceAmount));
  return { status, basketAmount, invoiceAmount };
}

interface ItemComparisonResult {
  itemMatch: FieldMatchStatus;
  quantityMatch: FieldMatchStatus;
  differences: BasketInvoiceDifference[];
  itemEvidenceAvailable: boolean;
}

function classifyItemsAndQuantities(
  caseId: string,
  basketItems: CaseBasketItem[],
  invoiceId: string,
  invoiceNumber: string | null,
  provider: InvoiceItemEvidenceProvider
): ItemComparisonResult {
  const invoiceItems = provider.getItemsForInvoice(invoiceId, invoiceNumber);

  // Never fabricate missing/extra items or a quantity verdict from absent evidence.
  if (invoiceItems === 'unavailable') {
    return { itemMatch: 'insufficient_data', quantityMatch: 'insufficient_data', differences: [], itemEvidenceAvailable: false };
  }
  if (basketItems.length === 0) {
    return { itemMatch: 'insufficient_data', quantityMatch: 'insufficient_data', differences: [], itemEvidenceAvailable: true };
  }

  const invoiceByKey = new Map(invoiceItems.map((i) => [normalizeProductNameForMatch(i.productNameRaw), i]));
  const basketKeysSeen = new Set<string>();
  const differences: BasketInvoiceDifference[] = [];
  const matchedPairs: Array<{ basketItem: CaseBasketItem; invoiceQuantity: number | null }> = [];

  basketItems.forEach((item) => {
    const key = normalizeProductNameForMatch(item.productNameRaw);
    basketKeysSeen.add(key);
    const invoiceItem = invoiceByKey.get(key);
    if (!invoiceItem) {
      differences.push({
        type: 'missing_item',
        key: item.productNameRaw,
        before: item.quantity,
        after: null,
        explanation: 'none',
        evidence: [amountRef(`الصنف "${item.productNameRaw}" موجود في السلة ولم يُعثر عليه في بنود الفاتورة.`)],
        confidence: assessment('proven', 0.9, ['matching.item.missing'], []),
      });
    } else {
      matchedPairs.push({ basketItem: item, invoiceQuantity: invoiceItem.quantity });
    }
  });

  invoiceItems.forEach((invoiceItem) => {
    const key = normalizeProductNameForMatch(invoiceItem.productNameRaw);
    if (!basketKeysSeen.has(key)) {
      differences.push({
        type: 'extra_item',
        key: invoiceItem.productNameRaw,
        before: null,
        after: invoiceItem.quantity,
        explanation: 'none',
        evidence: [amountRef(`الصنف "${invoiceItem.productNameRaw}" موجود في بنود الفاتورة ولم يُعثر عليه في السلة.`)],
        confidence: assessment('proven', 0.9, ['matching.item.extra'], []),
      });
    }
  });

  const missingCount = differences.filter((d) => d.type === 'missing_item').length;
  const extraCount = differences.filter((d) => d.type === 'extra_item').length;
  let itemMatch: FieldMatchStatus;
  if (missingCount === 0 && extraCount === 0) itemMatch = 'exact';
  else if (matchedPairs.length === 0) itemMatch = 'mismatch';
  else itemMatch = 'partial';

  let quantityMatch: FieldMatchStatus;
  if (matchedPairs.length === 0) {
    quantityMatch = 'insufficient_data';
  } else {
    let agreed = 0;
    let disagreed = 0;
    matchedPairs.forEach(({ basketItem, invoiceQuantity }) => {
      if (basketItem.quantity == null || invoiceQuantity == null) return; // unknown on one side — not counted either way
      if (basketItem.quantity === invoiceQuantity) {
        agreed += 1;
      } else {
        disagreed += 1;
        differences.push({
          type: 'quantity_mismatch',
          key: basketItem.productNameRaw,
          before: basketItem.quantity,
          after: invoiceQuantity,
          explanation: 'none',
          evidence: [amountRef(`الكمية في السلة (${basketItem.quantity}) تختلف عن الكمية في الفاتورة (${invoiceQuantity}) للصنف "${basketItem.productNameRaw}".`)],
          confidence: assessment('proven', 0.9, ['matching.item.quantity_mismatch'], []),
        });
      }
    });
    if (disagreed === 0 && agreed > 0) quantityMatch = 'exact';
    else if (disagreed === 0) quantityMatch = 'insufficient_data';
    else if (disagreed === matchedPairs.length) quantityMatch = 'mismatch';
    else quantityMatch = 'partial';
  }

  return { itemMatch, quantityMatch, differences, itemEvidenceAvailable: true };
}

/**
 * Rule: an exact invoice-total match can NEVER by itself count as a full basket match — a
 * header-only invoice (no item evidence) caps `overallMatch` at 'partial' at best, however good
 * the total looks, because the item-level content was never actually verified.
 */
function rollupOverallMatch(totalMatch: FieldMatchStatus, itemMatch: FieldMatchStatus, quantityMatch: FieldMatchStatus, itemEvidenceAvailable: boolean): FieldMatchStatus {
  if (!itemEvidenceAvailable) {
    if (totalMatch === 'mismatch') return 'mismatch';
    if (totalMatch === 'insufficient_data') return 'insufficient_data';
    return 'partial'; // exact or near_match total, item-level unconfirmed — never 'exact' here.
  }
  if (totalMatch === 'exact' && itemMatch === 'exact' && quantityMatch === 'exact') return 'exact';
  if (totalMatch === 'mismatch' && itemMatch === 'mismatch') return 'mismatch';
  if (totalMatch === 'insufficient_data' && itemMatch === 'insufficient_data' && quantityMatch === 'insufficient_data') {
    return 'insufficient_data';
  }
  return 'partial';
}

function insufficientDataMatch(caseId: string, ruleId: string, needsHumanReview = false, humanReviewReasons: string[] = []): BasketInvoiceMatch {
  return {
    matchId: `${caseId}:match:insufficient_data`,
    caseId,
    basketId: null,
    basketVersion: null,
    invoiceId: null,
    invoiceNumber: null,
    totalMatch: 'insufficient_data',
    itemMatch: 'insufficient_data',
    quantityMatch: 'insufficient_data',
    overallMatch: 'insufficient_data',
    itemEvidenceAvailable: false,
    differences: [],
    confidence: assessment('unknown', 0.2, [ruleId], []),
    needsHumanReview,
    humanReviewReasons,
    ruleIds: [ruleId],
  };
}

/**
 * The single entry point. Never re-runs Sale Attribution — `input.attribution` is taken as-is.
 * When attribution has no usable invoice (`unknown` level or no selected invoice), returns
 * `insufficient_data` across the board rather than guessing. Only ever compares against the
 * CURRENT (latest, non-superseded) basket version — see selectActiveBasket().
 */
export function deriveBasketInvoiceMatch(input: BasketInvoiceMatchingInput): BasketInvoiceMatch {
  const { caseId, attribution } = input;

  if (attribution.attributionLevel === 'unknown' || !attribution.selectedInvoiceId) {
    return insufficientDataMatch(caseId, 'matching.insufficient_attribution', attribution.needsHumanReview, attribution.humanReviewReasons);
  }

  const activeBasket = selectActiveBasket(input.baskets);
  if (!activeBasket) {
    return insufficientDataMatch(caseId, 'matching.no_active_basket');
  }

  if (input.invoiceCancelledOrReturned) {
    return {
      matchId: `${caseId}:match:${activeBasket.basketId}:${attribution.selectedInvoiceId}`,
      caseId,
      basketId: activeBasket.basketId,
      basketVersion: activeBasket.version,
      invoiceId: attribution.selectedInvoiceId,
      invoiceNumber: attribution.selectedInvoiceNumber,
      totalMatch: 'mismatch',
      itemMatch: 'mismatch',
      quantityMatch: 'mismatch',
      overallMatch: 'mismatch',
      itemEvidenceAvailable: false,
      differences: [],
      confidence: assessment('unknown', 0.3, ['matching.invoice_cancelled_or_returned'], []),
      needsHumanReview: true,
      humanReviewReasons: ['invoice_cancelled_or_returned'],
      ruleIds: ['matching.invoice_cancelled_or_returned'],
    };
  }

  const provider = input.itemEvidenceProvider ?? unavailableInvoiceItemEvidenceProvider;
  const basketItems = input.itemsByBasketId[activeBasket.basketId] || [];
  const adjustments = input.documentedAdjustments ?? [];

  const { status: totalMatch, basketAmount, invoiceAmount } = classifyTotalMatch(activeBasket, input.invoiceRow);
  const { itemMatch, quantityMatch, differences: itemDifferences, itemEvidenceAvailable } = classifyItemsAndQuantities(
    caseId,
    basketItems,
    attribution.selectedInvoiceId,
    attribution.selectedInvoiceNumber,
    provider
  );

  const differences: BasketInvoiceDifference[] = [...itemDifferences];
  if (totalMatch === 'near_match') {
    differences.push({
      type: 'total_mismatch',
      key: 'total',
      before: basketAmount,
      after: invoiceAmount,
      explanation: 'none',
      evidence: [amountRef(`فرق بسيط ضمن هامش التسامح بين إجمالي السلة (${basketAmount}) وإجمالي الفاتورة (${invoiceAmount}).`)],
      confidence: assessment('strongly_inferred', 0.7, ['matching.total.near_match'], []),
    });
  } else if (totalMatch === 'mismatch') {
    const rawDiff = (invoiceAmount ?? 0) - (basketAmount ?? 0);
    differences.push({
      type: 'total_mismatch',
      key: 'total',
      before: basketAmount,
      after: invoiceAmount,
      explanation: 'none',
      evidence: [amountRef(`فرق حقيقي بين إجمالي السلة (${basketAmount}) وإجمالي الفاتورة (${invoiceAmount}).`)],
      confidence: assessment('proven', 0.9, ['matching.total.mismatch'], []),
    });
    const { explanation, evidence } = explainTotalGap(rawDiff, adjustments);
    differences.push({
      type: explanation === 'none' ? 'unexplained_difference' : 'explained_difference',
      key: 'total',
      before: basketAmount,
      after: invoiceAmount,
      explanation,
      evidence,
      confidence: assessment(
        explanation === 'none' ? 'unknown' : 'strongly_inferred',
        explanation === 'none' ? 0.3 : 0.75,
        [explanation === 'none' ? 'matching.total.unexplained' : 'matching.total.explained'],
        evidence
      ),
    });
  }

  const overallMatch = rollupOverallMatch(totalMatch, itemMatch, quantityMatch, itemEvidenceAvailable);

  const humanReviewReasons: string[] = [...attribution.humanReviewReasons];
  if (differences.some((d) => d.type === 'unexplained_difference')) humanReviewReasons.push('unexplained_basket_invoice_difference');
  // A total gap that IS explained (e.g. a documented delivery fee) is an accounted-for fact, not
  // something to send to human review — only flag 'basket_invoice_mismatch' when the mismatch is
  // NOT fully covered by an explained total AND there's no separate item-level issue.
  const totalGapExplained = totalMatch === 'mismatch' && differences.some((d) => d.type === 'explained_difference');
  const hasItemLevelIssue = itemDifferences.some((d) => d.type === 'missing_item' || d.type === 'extra_item' || d.type === 'quantity_mismatch');
  if (overallMatch === 'mismatch' && !(totalGapExplained && !hasItemLevelIssue)) {
    humanReviewReasons.push('basket_invoice_mismatch');
  }
  const needsHumanReview = attribution.needsHumanReview || humanReviewReasons.length > attribution.humanReviewReasons.length;

  const level: ConfidenceAssessment['level'] =
    overallMatch === 'exact' ? 'strongly_inferred' : overallMatch === 'insufficient_data' ? 'unknown' : 'weakly_inferred';
  const score = overallMatch === 'exact' ? 0.85 : overallMatch === 'partial' ? 0.5 : overallMatch === 'mismatch' ? 0.2 : 0.1;
  const ruleIds = [
    `matching.total.${totalMatch}`,
    `matching.item.${itemMatch}`,
    `matching.quantity.${quantityMatch}`,
    `matching.overall.${overallMatch}`,
  ];

  return {
    matchId: `${caseId}:match:${activeBasket.basketId}:${attribution.selectedInvoiceId}`,
    caseId,
    basketId: activeBasket.basketId,
    basketVersion: activeBasket.version,
    invoiceId: attribution.selectedInvoiceId,
    invoiceNumber: attribution.selectedInvoiceNumber,
    totalMatch,
    itemMatch,
    quantityMatch,
    overallMatch,
    itemEvidenceAvailable,
    differences,
    confidence: assessment(level, score, ruleIds, []),
    needsHumanReview,
    humanReviewReasons,
    ruleIds,
  };
}
