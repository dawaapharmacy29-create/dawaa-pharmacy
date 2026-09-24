// Sales Intelligence Phase E — Basket <-> Invoice Matching Engine.
// Phase E.1 hardening: explicit active-basket selection (never array order), a percentage-based
// amount-tolerance rule informed by real invoice data, product-identity-basis-aware item matching,
// and a structural integrity-evaluation-scope gate for Phase F.
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
  type InvoiceItemRecordForAttribution,
} from './saleAttributionEngine';
import type {
  BasketInvoiceDifference,
  BasketInvoiceMatch,
  CaseBasket,
  CaseBasketItem,
  ConfidenceAssessment,
  DifferenceExplanationKind,
  EvidenceRef,
  FieldMatchStatus,
  IntegrityEvaluationScope,
  ProductIdentityMatchBasis,
  SaleAttributionAssessment,
} from './types';

// ---------------------------------------------------------------------------
// Phase E.1: amount-tolerance semantics, informed by a read-only real-data investigation (see the
// Phase E.1 report). sales_invoices.net_amount: median 124 EGP, p25 50 EGP, p10 24 EGP — 43% of
// all invoices are under 100 EGP. A flat 20 EGP (or 2%) tolerance would have swallowed 20-80%+ of
// a typical small invoice's own value as "near enough". Amounts round to at most half-EGP
// granularity (max observed fractional part: 0.5 EGP across 69,614 invoices) — a 1 EGP floor
// safely covers genuine rounding noise without hiding a real commercial-size difference.
//
// Three SEPARATE concepts, never conflated:
//   - technicalToleranceEgp: pure rounding/float noise — always negligible, never a business signal.
//   - nearMatchRelativeFraction: a small, still-visible business-level discrepancy — PURELY
//     relative, with no large flat absolute floor that could hide a big percentage gap on a small
//     basket (the exact failure mode of the old 20 EGP-or-2% rule: 100 -> 120 is only 20 EGP but a
//     real 20% difference, and must never be called "near").
//   - An explained adjustment (delivery fee/discount/cashback/documented edit) is EVIDENCE, not a
//     tolerance band — see explainTotalGap(). It never changes the raw totalMatch classification
//     (see classifyTotalMatch/deriveBasketInvoiceMatch): a mismatch stays a mismatch as a FACT,
//     with the explanation recorded as a SEPARATE, additional difference entry.
// ---------------------------------------------------------------------------
export const AMOUNT_TOLERANCE = {
  /** Genuine rounding/float noise only — max observed real fractional part is 0.5 EGP. */
  technicalToleranceEgp: 1,
  /** A small, still-visible business-level gap — purely relative, no flat absolute override. */
  nearMatchRelativeFraction: 0.03,
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
  /** Full version history — this engine selects the active version itself via resolveActiveBasket(); never accept a version pointer from the caller, per the active-basket invariant. */
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

// ---------------------------------------------------------------------------
// Phase E.1: active-basket selection, hardened. Derived EXPLICITLY from each basket's own
// `status`/`version` metadata — never from array position. A caller may pass baskets in any
// order; the outcome must be identical.
// ---------------------------------------------------------------------------

export type ActiveBasketResolution =
  | { outcome: 'selected'; basket: CaseBasket }
  | { outcome: 'insufficient_data' }
  | { outcome: 'needs_human_review'; conflictingBaskets: CaseBasket[] };

/**
 * The ONLY place the active basket is selected. A basket counts as a candidate for "active" when
 * its own `status` is not `'superseded'` (superseded is the one status the engine's own
 * caseBasketEngine.ts uses to explicitly retire a historical version — never re-eligible).
 * Exactly one candidate is the expected, valid case (`selected`). Zero candidates means there is
 * nothing to match against (`insufficient_data`) — never a basket from history. More than one
 * candidate is a genuine data-invariant violation (two versions both claiming to be active) —
 * this is NEVER resolved by guessing (e.g. picking the highest version number), only surfaced
 * for human review, per the explicit "not guessing" requirement.
 */
export function resolveActiveBasket(baskets: CaseBasket[]): ActiveBasketResolution {
  const candidates = baskets.filter((b) => b.status !== 'superseded');
  if (candidates.length === 0) return { outcome: 'insufficient_data' };
  if (candidates.length === 1) return { outcome: 'selected', basket: candidates[0] };
  const conflictingBaskets = [...candidates].sort((a, b) => b.version - a.version);
  return { outcome: 'needs_human_review', conflictingBaskets };
}

/**
 * Raw amount-match classification. Purely relative near-match band (see AMOUNT_TOLERANCE) — never
 * a large flat absolute floor that could hide a real percentage-size gap on a small basket.
 */
function classifyAmountDifference(expected: number | null, actual: number | null): 'exact' | 'near_match' | 'different' | 'not_available' {
  if (expected == null || actual == null) return 'not_available';
  const diff = Math.abs(expected - actual);
  if (diff <= AMOUNT_TOLERANCE.technicalToleranceEgp) return 'exact';
  const nearMatchTolerance = Math.max(
    AMOUNT_TOLERANCE.technicalToleranceEgp,
    Math.abs(expected) * AMOUNT_TOLERANCE.nearMatchRelativeFraction
  );
  return diff <= nearMatchTolerance ? 'near_match' : 'different';
}

function mapAmountToFieldStatus(kind: 'exact' | 'near_match' | 'different' | 'not_available'): FieldMatchStatus {
  if (kind === 'different') return 'mismatch';
  if (kind === 'not_available') return 'insufficient_data';
  return kind;
}

/**
 * Reconciles a real total gap against caller-supplied documented adjustments (delivery fee,
 * discount, cashback, a documented conversation edit). Only ever classifies 'explained_difference'
 * when the adjustments actually account for the gap within the technical tolerance — never
 * guessed, and NEVER changes the raw totalMatch classification itself (see rule §3 of the Phase
 * E.1 spec: "Do NOT convert the underlying amount comparison itself into near_match or exact").
 */
function explainTotalGap(
  rawDiff: number,
  adjustments: DocumentedAdjustment[]
): { explanation: DifferenceExplanationKind; evidence: EvidenceRef[] } {
  if (adjustments.length === 0) return { explanation: 'none', evidence: [] };
  const adjustmentSum = adjustments.reduce((sum, a) => sum + a.amount, 0);
  const residual = Math.abs(rawDiff - adjustmentSum);
  if (residual > AMOUNT_TOLERANCE.technicalToleranceEgp) return { explanation: 'none', evidence: [] };
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

// ---------------------------------------------------------------------------
// Phase E.1: product-identity-basis-aware item/quantity matching.
//   - canonical_id: basketItem.productId equals invoiceItem.productId (both products.id UUIDs) —
//     the only identity basis that can ever be `proven`. product_code is audit/business identity,
//     never compared directly to a products.id UUID.
//   - normalized_name: matched only via normalizeProductNameForMatch() text equality — real,
//     useful evidence, but capped at `strongly_inferred`, never `proven` (never claim identity
//     certainty from text alone).
//   - ambiguous: more than one invoice item normalizes to the SAME key as a basket item (or vice
//     versa) — never silently pick one; excluded from quantity comparison, forces human review.
//   - unresolved: the basket item's OWN identity was never resolved by Phase B
//     (resolutionStatus === 'unknown', e.g. a raw pronoun like "التاني") — even a coincidental
//     text match is not trusted enough to compare quantities against.
// ---------------------------------------------------------------------------

interface MatchedPair {
  basketItem: CaseBasketItem;
  invoiceItem: InvoiceItemRecordForAttribution;
  basis: ProductIdentityMatchBasis;
}

interface ItemComparisonResult {
  itemMatch: FieldMatchStatus;
  quantityMatch: FieldMatchStatus;
  differences: BasketInvoiceDifference[];
  itemEvidenceReady: boolean;
  needsHumanReview: boolean;
  humanReviewReasons: string[];
}

function quantityConfidenceFor(basis: ProductIdentityMatchBasis): ConfidenceAssessment {
  if (basis === 'canonical_id') return assessment('proven', 0.95, ['matching.item.quantity_mismatch.canonical_id'], []);
  return assessment('strongly_inferred', 0.75, ['matching.item.quantity_mismatch.normalized_name'], []);
}

function classifyItemsAndQuantities(
  basketItems: CaseBasketItem[],
  invoiceId: string,
  invoiceNumber: string | null,
  provider: InvoiceItemEvidenceProvider
): ItemComparisonResult {
  const invoiceItems = provider.getItemsForInvoice(invoiceId, invoiceNumber);

  // Never fabricate missing/extra items or a quantity verdict from absent evidence.
  if (invoiceItems === 'unavailable') {
    return { itemMatch: 'insufficient_data', quantityMatch: 'insufficient_data', differences: [], itemEvidenceReady: false, needsHumanReview: false, humanReviewReasons: [] };
  }
  if (basketItems.length === 0) {
    return { itemMatch: 'insufficient_data', quantityMatch: 'insufficient_data', differences: [], itemEvidenceReady: true, needsHumanReview: false, humanReviewReasons: [] };
  }

  // Group invoice items by normalized name key — a Map keyed 1:1 would silently DROP a genuine
  // ambiguity (two different invoice lines normalizing to the same key); grouping preserves it.
  const invoiceGroupsByName = new Map<string, InvoiceItemRecordForAttribution[]>();
  invoiceItems.forEach((i) => {
    const key = normalizeProductNameForMatch(i.productNameRaw);
    const group = invoiceGroupsByName.get(key) ?? [];
    group.push(i);
    invoiceGroupsByName.set(key, group);
  });
  const invoiceGroupsByProductId = new Map<string, InvoiceItemRecordForAttribution[]>();
  invoiceItems.forEach((i) => {
    if (!i.productId) return;
    const key = String(i.productId);
    const group = invoiceGroupsByProductId.get(key) ?? [];
    group.push(i);
    invoiceGroupsByProductId.set(key, group);
  });

  const differences: BasketInvoiceDifference[] = [];
  const matchedPairs: MatchedPair[] = [];
  const claimedInvoiceKeys = new Set<string>();
  let ambiguousCount = 0;
  let unresolvedCount = 0;
  const humanReviewReasons: string[] = [];

  basketItems.forEach((item) => {
    const nameKey = normalizeProductNameForMatch(item.productNameRaw);

    // A basket item Phase B never resolved a real identity for (e.g. a raw pronoun) is never
    // trusted for a positive match, even if its raw text coincidentally equals an invoice item's.
    if (item.resolutionStatus === 'unknown') {
      const candidates = invoiceGroupsByName.get(nameKey) ?? [];
      if (candidates.length === 0) {
        differences.push({
          type: 'missing_item',
          key: item.productNameRaw,
          before: item.quantity,
          after: null,
          explanation: 'none',
          evidence: [amountRef(`صنف بهوية غير محلولة من المحادثة ("${item.productNameRaw}") لا يقابله أي بند في الفاتورة.`)],
          confidence: assessment('weakly_inferred', 0.4, ['matching.item.missing.unresolved_identity'], []),
        });
      } else {
        unresolvedCount += 1;
        humanReviewReasons.push('unresolved_product_identity');
      }
      return;
    }

    // Canonical products.id match first — the only path to a proven identity match.
    const canonicalCandidates = item.productId
      ? invoiceGroupsByProductId.get(String(item.productId)) ?? []
      : [];
    if (canonicalCandidates.length === 1) {
      const invoiceItem = canonicalCandidates[0];
      matchedPairs.push({ basketItem: item, invoiceItem, basis: 'canonical_id' });
      claimedInvoiceKeys.add(normalizeProductNameForMatch(invoiceItem.productNameRaw));
      return;
    }
    if (canonicalCandidates.length > 1) {
      ambiguousCount += 1;
      humanReviewReasons.push('ambiguous_product_alias');
      return;
    }

    // Fall back to normalized-name matching — real evidence, but never `proven`.
    const nameCandidates = invoiceGroupsByName.get(nameKey) ?? [];
    if (nameCandidates.length === 1) {
      matchedPairs.push({ basketItem: item, invoiceItem: nameCandidates[0], basis: 'normalized_name' });
      claimedInvoiceKeys.add(nameKey);
    } else if (nameCandidates.length > 1) {
      ambiguousCount += 1;
      humanReviewReasons.push('ambiguous_product_alias');
    } else {
      differences.push({
        type: 'missing_item',
        key: item.productNameRaw,
        before: item.quantity,
        after: null,
        explanation: 'none',
        evidence: [amountRef(`الصنف "${item.productNameRaw}" موجود في السلة ولم يُعثر عليه في بنود الفاتورة.`)],
        confidence: assessment('proven', 0.9, ['matching.item.missing'], []),
      });
    }
  });

  invoiceItems.forEach((invoiceItem) => {
    const key = normalizeProductNameForMatch(invoiceItem.productNameRaw);
    if (!claimedInvoiceKeys.has(key) && (invoiceGroupsByName.get(key) ?? []).length === 1) {
      // Only report a clean, unambiguous extra — an item that's part of an ambiguous group at the
      // invoice side was already counted in ambiguousCount above via the basket-side pass.
      const alreadyReported = differences.some((d) => d.type === 'extra_item' && d.key === invoiceItem.productNameRaw);
      if (!alreadyReported) {
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
    }
  });

  const missingCount = differences.filter((d) => d.type === 'missing_item').length;
  const extraCount = differences.filter((d) => d.type === 'extra_item').length;
  let itemMatch: FieldMatchStatus;
  if (missingCount === 0 && extraCount === 0 && ambiguousCount === 0 && unresolvedCount === 0) itemMatch = 'exact';
  else if (matchedPairs.length === 0) itemMatch = 'mismatch';
  else itemMatch = 'partial';

  // Quantity is compared ONLY over matchedPairs — ambiguous and unresolved items are structurally
  // excluded above, so "quantity comparison occurs only after product identity is sufficiently
  // resolved" holds by construction, not by a separate check.
  let quantityMatch: FieldMatchStatus;
  if (matchedPairs.length === 0) {
    quantityMatch = 'insufficient_data';
  } else {
    let agreed = 0;
    let disagreed = 0;
    matchedPairs.forEach(({ basketItem, invoiceItem, basis }) => {
      if (basketItem.quantity == null || invoiceItem.quantity == null) return; // unknown on one side — not counted either way, never a mismatch
      if (basketItem.quantity === invoiceItem.quantity) {
        agreed += 1;
      } else {
        disagreed += 1;
        differences.push({
          type: 'quantity_mismatch',
          key: basketItem.productNameRaw,
          before: basketItem.quantity,
          after: invoiceItem.quantity,
          explanation: 'none',
          evidence: [amountRef(`الكمية في السلة (${basketItem.quantity}) تختلف عن الكمية في الفاتورة (${invoiceItem.quantity}) للصنف "${basketItem.productNameRaw}".`)],
          confidence: quantityConfidenceFor(basis),
        });
      }
    });
    if (disagreed === 0 && agreed > 0) quantityMatch = 'exact';
    else if (disagreed === 0) quantityMatch = 'insufficient_data';
    else if (disagreed === matchedPairs.length) quantityMatch = 'mismatch';
    else quantityMatch = 'partial';
  }

  return {
    itemMatch,
    quantityMatch,
    differences,
    itemEvidenceReady: true,
    needsHumanReview: humanReviewReasons.length > 0,
    humanReviewReasons: Array.from(new Set(humanReviewReasons)),
  };
}

/**
 * Rule: an exact invoice-total match can NEVER by itself count as a full basket match — a
 * header-only invoice (no item evidence) caps `overallMatch` at 'partial' at best, however good
 * the total looks, because the item-level content was never actually verified.
 */
function rollupOverallMatch(totalMatch: FieldMatchStatus, itemMatch: FieldMatchStatus, quantityMatch: FieldMatchStatus, itemEvidenceReady: boolean): FieldMatchStatus {
  if (!itemEvidenceReady) {
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

/**
 * Phase E.1 §7: the structural gate Phase F must read before drawing any conclusion. Never a
 * comment — a real field. `header_only` can support total-vs-invoiced-total and invoice-status
 * findings; it can NEVER support a missing/extra-product or wrong-quantity finding.
 */
function resolveIntegrityScope(headerEvidenceReady: boolean, itemEvidenceReady: boolean): IntegrityEvaluationScope {
  if (!headerEvidenceReady) return 'insufficient';
  return itemEvidenceReady ? 'header_and_items' : 'header_only';
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
    headerEvidenceReady: false,
    itemEvidenceReady: false,
    integrityEvaluationScope: 'insufficient',
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
 * CURRENT active basket version — see resolveActiveBasket().
 */
export function deriveBasketInvoiceMatch(input: BasketInvoiceMatchingInput): BasketInvoiceMatch {
  const { caseId, attribution } = input;

  if (attribution.attributionLevel === 'unknown' || !attribution.selectedInvoiceId) {
    return insufficientDataMatch(caseId, 'matching.insufficient_attribution', attribution.needsHumanReview, attribution.humanReviewReasons);
  }

  const resolution = resolveActiveBasket(input.baskets);
  if (resolution.outcome === 'insufficient_data') {
    return insufficientDataMatch(caseId, 'matching.no_active_basket');
  }
  if (resolution.outcome === 'needs_human_review') {
    return insufficientDataMatch(
      caseId,
      'matching.conflicting_active_basket_versions',
      true,
      ['conflicting_active_basket_versions']
    );
  }
  const activeBasket = resolution.basket;

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
      headerEvidenceReady: false,
      itemEvidenceReady: false,
      integrityEvaluationScope: 'insufficient',
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
  const headerEvidenceReady = basketAmount != null && invoiceAmount != null;
  const {
    itemMatch,
    quantityMatch,
    differences: itemDifferences,
    itemEvidenceReady,
    needsHumanReview: itemsNeedHumanReview,
    humanReviewReasons: itemHumanReviewReasons,
  } = classifyItemsAndQuantities(basketItems, attribution.selectedInvoiceId, attribution.selectedInvoiceNumber, provider);

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

  const overallMatch = rollupOverallMatch(totalMatch, itemMatch, quantityMatch, itemEvidenceReady);
  const integrityEvaluationScope = resolveIntegrityScope(headerEvidenceReady, itemEvidenceReady);

  const humanReviewReasons: string[] = [...attribution.humanReviewReasons, ...itemHumanReviewReasons];
  if (differences.some((d) => d.type === 'unexplained_difference')) humanReviewReasons.push('unexplained_basket_invoice_difference');
  // A total gap that IS explained (e.g. a documented delivery fee) is an accounted-for fact, not
  // something to send to human review — only flag 'basket_invoice_mismatch' when the mismatch is
  // NOT fully covered by an explained total AND there's no separate item-level issue.
  const totalGapExplained = totalMatch === 'mismatch' && differences.some((d) => d.type === 'explained_difference');
  const hasItemLevelIssue = itemDifferences.some((d) => d.type === 'missing_item' || d.type === 'extra_item' || d.type === 'quantity_mismatch');
  if (overallMatch === 'mismatch' && !(totalGapExplained && !hasItemLevelIssue)) {
    humanReviewReasons.push('basket_invoice_mismatch');
  }
  const dedupedHumanReviewReasons = Array.from(new Set(humanReviewReasons));
  const needsHumanReview = attribution.needsHumanReview || itemsNeedHumanReview || dedupedHumanReviewReasons.length > attribution.humanReviewReasons.length;

  const level: ConfidenceAssessment['level'] =
    overallMatch === 'exact' ? 'strongly_inferred' : overallMatch === 'insufficient_data' ? 'unknown' : 'weakly_inferred';
  const score = overallMatch === 'exact' ? 0.85 : overallMatch === 'partial' ? 0.5 : overallMatch === 'mismatch' ? 0.2 : 0.1;
  const ruleIds = [
    `matching.total.${totalMatch}`,
    `matching.item.${itemMatch}`,
    `matching.quantity.${quantityMatch}`,
    `matching.overall.${overallMatch}`,
    `matching.scope.${integrityEvaluationScope}`,
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
    headerEvidenceReady,
    itemEvidenceReady,
    integrityEvaluationScope,
    differences,
    confidence: assessment(level, score, ruleIds, []),
    needsHumanReview,
    humanReviewReasons: dedupedHumanReviewReasons,
    ruleIds,
  };
}
