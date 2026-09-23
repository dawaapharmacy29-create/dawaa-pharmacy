// Phase I.B.4 — deterministic, read-only end-to-end benchmark runner.
//
// This is BENCHMARK infrastructure, not a production decision engine. It runs OLD and V2 over the
// same immutable Ground Truth cases and returns machine-readable metrics + per-case traces.
// No persistence writes, no policy changes, no staff scoring, no invoice attribution.
import { parseWhatsAppExport, splitWhatsAppSessions } from '../../whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '../../whatsappConversationUnderstandingV32';
import type { NormalizedConversationMessageV32 } from '../../whatsappConversationUnderstandingV32';
import { buildCaseBaskets } from '../caseBasketEngine';
import type { PharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { buildConversationEntityGraphV2 } from './conversationEntityGraphV2';
import { reconstructBasketV2 } from './basketReconstructionV2';
import type { BasketStatusV2, ConversationEntityGraphV2 } from './basketV2Types';

/** @deprecated Pass the canonical dataset version explicitly from benchmarkGroundTruthV1.ts. */
export const SALES_INTELLIGENCE_GROUND_TRUTH_VERSION = 'legacy-unspecified-ground-truth-version';

export type BenchmarkSource = 'real' | 'synthetic';
export type BenchmarkDifficulty = 'easy' | 'medium' | 'hard';

export interface SalesIntelligenceGroundTruthCase {
  id: string;
  source: BenchmarkSource;
  category: string;
  difficulty?: BenchmarkDifficulty;
  sourceNote: string;
  raw: string;
  /** Trusted persisted conversation_started_at for time-only markdown exports; never inferred. */
  trustedConversationStartedAt?: string | null;
  groundTruth: {
    expectedAddedProductCodes: string[];
    expectedNeverAddedProductCodes: string[];
    expectedQuantities: Record<string, number | null>;
    expectedStatus: BasketStatusV2 | null;
    expectUnresolvedSignal: boolean;
    /** Optional I.B.4 event-history labels. Treated as ordered-subsequence expectations, not a demand
     * that the engine emit no extra explainability events. */
    expectedEventTypes?: string[];
    /** Optional immutable-basket version label. */
    expectedVersionCount?: number;
  };
}

export type BenchmarkCaseClassification =
  | 'both_correct'
  | 'v2_fixed_old'
  | 'old_correct_v2_regression'
  | 'both_partial'
  | 'both_wrong'
  | 'intentionally_unresolved';

export type BenchmarkFailureCategory =
  | 'parser_failure'
  | 'product_not_detected'
  | 'product_wrong_sku'
  | 'transliteration_failure'
  | 'quantity_missed'
  | 'quantity_wrong_target'
  | 'reference_false_resolution'
  | 'active_state_error'
  | 'graph_edge_error'
  | 'basket_mutation_error'
  | 'media_unavailable'
  | 'ground_truth_uncertain';

interface NormalizedBasketItem {
  productCode: string | null;
  quantity: number | null;
}

export interface SalesIntelligenceBenchmarkCaseResult {
  caseId: string;
  source: BenchmarkSource;
  category: string;
  difficulty: BenchmarkDifficulty;
  classification: BenchmarkCaseClassification;
  groundTruth: {
    addedProductCodes: string[];
    neverAddedProductCodes: string[];
    quantities: Record<string, number | null>;
    expectedStatus: BasketStatusV2 | null;
    expectUnresolvedSignal: boolean;
  };
  old: {
    productCodes: string[];
    status: string | null;
  };
  v2: {
    productCodes: string[];
    quantities: Record<string, number | null>;
    status: BasketStatusV2;
    unresolved: boolean;
    basketVersionCount: number;
  };
  failures: BenchmarkFailureCategory[];
  safetyCritical: string[];
  firstDivergence: BenchmarkFailureCategory | null;
}

export interface DifficultyBenchmarkMetricsV2 {
  cases: number;
  tp: number;
  fp: number;
  fn: number;
  precision: number;
  recall: number;
  falseAddedProducts: number;
  wrongQuantities: number;
}

export interface ConfidenceBucketCalibrationV2 {
  bucket: 'high' | 'medium' | 'low';
  total: number;
  verifiedCorrect: number;
  verifiedIncorrect: number;
  unverifiable: number;
  empiricalCorrectness: number;
}

export interface HumanReviewQualityV2 {
  trueReviewNeeded: number;
  unnecessaryReview: number;
  missedReview: number;
  correctlyNoReview: number;
  precision: number;
  recall: number;
}

export interface SalesIntelligenceBenchmarkMetrics {
  datasetVersion: string;
  totalCases: number;
  realCases: number;
  syntheticCases: number;
  /** Evidence-composition counters: prevent "20 real cases" from being satisfied only by easy negatives. */
  realPositiveOrderCases: number;
  realHardCases: number;
  byDifficulty: Record<BenchmarkDifficulty, number>;
  difficultyMetrics: Record<BenchmarkDifficulty, DifficultyBenchmarkMetricsV2>;
  realOnlyV2Product: { tp: number; fp: number; fn: number; precision: number; recall: number };
  syntheticOnlyV2Product: { tp: number; fp: number; fn: number; precision: number; recall: number };
  oldProduct: { tp: number; fp: number; fn: number; precision: number; recall: number };
  v2Product: { tp: number; fp: number; fn: number; precision: number; recall: number };
  /** Canonical SKU correctness over all V2 SKU predictions that Ground Truth can judge. */
  canonicalSkuAccuracy: number;
  basketMatch: { exactCases: number; partialCases: number; wrongCases: number; intentionallyUnresolvedCases: number; exactRate: number; partialRate: number };
  quantityTargetAudit: { labeled: number; correct: number; incorrect: number; missed: number; accuracy: number };
  falseAddedProductToBasket: { old: number; v2: number };
  /** Empirical audit of graph edges already marked safeForBasketLinking=safe. "Unverifiable" is
   * deliberately separate — Ground Truth does not pretend to label every reference relation. */
  safeEdgeAudit: { total: number; verifiedCorrect: number; verifiedIncorrect: number; unverifiable: number; empiricalErrorRate: number };
  confidenceCalibration: {
    productMentions: ConfidenceBucketCalibrationV2[];
    quantityLinks: ConfidenceBucketCalibrationV2[];
    referenceLinks: ConfidenceBucketCalibrationV2[];
  };
  humanReviewQuality: HumanReviewQualityV2;
  eventSequenceAudit: { labeledCases: number; correct: number; incorrect: number; unverifiable: number; accuracy: number };
  versioningAudit: { labeledCases: number; correct: number; incorrect: number; unverifiable: number; accuracy: number };
  wrongQuantityAppliedToCorrectProduct: number;
  missedExpectedQuantity: number;
  unresolvedCases: number;
  mediaLimitedCases: number;
  transliterationFailureCases: number;
  safetyCriticalErrorCount: number;
  regressions: number;
  failureCounts: Partial<Record<BenchmarkFailureCategory, number>>;
}

export interface SalesIntelligenceBenchmarkReport {
  datasetVersion: string;
  generatedBy: 'runSalesIntelligenceBenchmarkV2';
  metrics: SalesIntelligenceBenchmarkMetrics;
  cases: SalesIntelligenceBenchmarkCaseResult[];
  machineReadableJson: string;
  humanSummary: string;
}

function messagesFrom(raw: string, trustedConversationStartedAt?: string | null): NormalizedConversationMessageV32[] {
  const sessions = splitWhatsAppSessions(
    parseWhatsAppExport(raw, { trustedConversationStartedAt: trustedConversationStartedAt ?? null }),
    120
  );
  if (sessions.length === 0) return [];
  return buildConversationUnderstandingV32(sessions[0]).messages;
}

function difficultyFor(c: SalesIntelligenceGroundTruthCase): BenchmarkDifficulty {
  if (c.difficulty) return c.difficulty;
  if (/image|media|substitution|ambiguous|quantity_change|multiple|multi_item/i.test(c.category)) return 'hard';
  if (/recommendation|availability|same_customer|price/i.test(c.category)) return 'medium';
  return 'easy';
}

function productCodeFor(index: PharmacyProductIndex, productId: string | null): string | null {
  if (!productId) return null;
  return index.catalog.find((p) => p.productId === productId)?.productCode ?? null;
}

function runOld(caseId: string, messages: NormalizedConversationMessageV32[], index: PharmacyProductIndex): { items: NormalizedBasketItem[]; status: string | null } {
  const result = buildCaseBaskets(caseId, messages);
  const latest = result.baskets[result.baskets.length - 1] ?? null;
  if (!latest) return { items: [], status: null };
  const items = (result.itemsByBasketId[latest.basketId] ?? []).map((i) => ({
    productCode: productCodeFor(index, i.productId),
    quantity: i.quantity,
  }));
  return { items, status: latest.status };
}

function runV2(caseId: string, messages: NormalizedConversationMessageV32[], index: PharmacyProductIndex): {
  graph: ConversationEntityGraphV2;
  items: NormalizedBasketItem[];
  status: BasketStatusV2;
  unresolved: boolean;
  versionCount: number;
  eventTypes: string[];
} {
  const graph = buildConversationEntityGraphV2(caseId, messages, { productIndex: index });
  const timestamps = new Map(messages.map((m) => [m.id, m.timestamp.toISOString()] as const));
  const result = reconstructBasketV2(graph, timestamps);
  const items = result.currentBasket.items
    .filter((i) => !['removed', 'rejected', 'substituted'].includes(i.itemState))
    .map((i) => ({ productCode: i.canonicalProductCode, quantity: i.currentQuantity }));
  const unresolved = result.currentBasket.unresolvedCandidates.length > 0 || result.currentBasket.pendingReviewSignals.length > 0;
  return {
    graph,
    items,
    status: result.currentBasket.status,
    unresolved,
    versionCount: result.basketVersions.length + 1,
    eventTypes: result.events.map((e) => e.eventType),
  };
}

function countItemMetrics(items: NormalizedBasketItem[], expected: Set<string>): { tp: number; fp: number; fn: number } {
  const predicted = new Set(items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const code of predicted) expected.has(code) ? tp++ : fp++;
  for (const code of expected) if (!predicted.has(code)) fn++;
  return { tp, fp, fn };
}

function isCaseCorrect(items: NormalizedBasketItem[], c: SalesIntelligenceGroundTruthCase): boolean {
  const predicted = new Set(items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
  if (c.groundTruth.expectedAddedProductCodes.some((code) => !predicted.has(code))) return false;
  if (c.groundTruth.expectedNeverAddedProductCodes.some((code) => predicted.has(code))) return false;
  for (const [code, expectedQty] of Object.entries(c.groundTruth.expectedQuantities)) {
    const item = items.find((i) => i.productCode === code);
    if (expectedQty !== null && item?.quantity !== expectedQty) return false;
  }
  return true;
}

function classifyCase(
  c: SalesIntelligenceGroundTruthCase,
  oldItems: NormalizedBasketItem[],
  v2Items: NormalizedBasketItem[],
  unresolved: boolean
): BenchmarkCaseClassification {
  const oldCorrect = isCaseCorrect(oldItems, c);
  const v2Correct = isCaseCorrect(v2Items, c);
  if (c.groundTruth.expectUnresolvedSignal && unresolved && v2Correct) return 'intentionally_unresolved';
  if (oldCorrect && v2Correct) return 'both_correct';
  if (!oldCorrect && v2Correct) return 'v2_fixed_old';
  if (oldCorrect && !v2Correct) return 'old_correct_v2_regression';

  const expected = new Set(c.groundTruth.expectedAddedProductCodes);
  const v2Pred = new Set(v2Items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
  const hasSomeExpected = [...expected].some((code) => v2Pred.has(code));
  return hasSomeExpected || unresolved ? 'both_partial' : 'both_wrong';
}

function inferFailures(
  c: SalesIntelligenceGroundTruthCase,
  graph: ConversationEntityGraphV2,
  v2Items: NormalizedBasketItem[],
  parsed: boolean
): { failures: BenchmarkFailureCategory[]; safetyCritical: string[]; firstDivergence: BenchmarkFailureCategory | null } {
  const failures: BenchmarkFailureCategory[] = [];
  const safetyCritical: string[] = [];
  if (!parsed) failures.push('parser_failure');

  const expected = new Set(c.groundTruth.expectedAddedProductCodes);
  const never = new Set(c.groundTruth.expectedNeverAddedProductCodes);
  const predicted = new Set(v2Items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
  const graphCodes = new Set(graph.productMentions.map((p) => p.canonicalProductCode).filter((x): x is string => Boolean(x)));

  for (const code of expected) {
    if (!predicted.has(code)) {
      if (!graphCodes.has(code) && /transliter|misspell|فليكس|arabic.*latin|latin.*arabic/i.test(`${c.category} ${c.sourceNote}`)) {
        failures.push('transliteration_failure');
      } else {
        failures.push(graphCodes.has(code) ? 'basket_mutation_error' : 'product_not_detected');
      }
    }
  }

  for (const code of predicted) {
    if (!expected.has(code)) {
      failures.push(graphCodes.has(code) ? 'basket_mutation_error' : 'product_wrong_sku');
      safetyCritical.push(`false_added_product:${code}`);
    }
  }
  // expectedNeverAddedProductCodes remains useful as an explicit label even when the engine made no
  // prediction; the generic predicted-not-expected rule above is the actual false-add safety gate.
  for (const code of never) {
    if (predicted.has(code) && !safetyCritical.includes(`false_added_product:${code}`)) {
      safetyCritical.push(`false_added_product:${code}`);
    }
  }

  for (const [code, expectedQty] of Object.entries(c.groundTruth.expectedQuantities)) {
    if (expectedQty === null) continue;
    const item = v2Items.find((i) => i.productCode === code);
    if (!item || item.quantity === null) failures.push('quantity_missed');
    else if (item.quantity !== expectedQty) {
      failures.push('quantity_wrong_target');
      safetyCritical.push(`wrong_quantity:${code}:expected=${expectedQty}:actual=${item.quantity}`);
    }
  }

  if (
    c.groundTruth.expectUnresolvedSignal &&
    (graph.references.some((r) => r.antecedentKind === 'media') || /image|media|voice/i.test(c.sourceNote))
  ) failures.push('media_unavailable');

  const unique = Array.from(new Set(failures));
  return { failures: unique, safetyCritical, firstDivergence: unique[0] ?? null };
}

function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      if (seen.has(input as object)) return '[Circular]';
      seen.add(input as object);
      return Object.fromEntries(
        Object.entries(input as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, normalize(v)])
      );
    }
    return input;
  };
  return JSON.stringify(normalize(value), null, 2);
}

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

function confidenceBucket(value: number): ConfidenceBucketCalibrationV2['bucket'] {
  if (value >= 0.8) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

function emptyCalibration(): Record<ConfidenceBucketCalibrationV2['bucket'], { total: number; verifiedCorrect: number; verifiedIncorrect: number; unverifiable: number }> {
  return {
    high: { total: 0, verifiedCorrect: 0, verifiedIncorrect: 0, unverifiable: 0 },
    medium: { total: 0, verifiedCorrect: 0, verifiedIncorrect: 0, unverifiable: 0 },
    low: { total: 0, verifiedCorrect: 0, verifiedIncorrect: 0, unverifiable: 0 },
  };
}

function finalizeCalibration(raw: ReturnType<typeof emptyCalibration>): ConfidenceBucketCalibrationV2[] {
  return (['high', 'medium', 'low'] as const).map((bucket) => {
    const row = raw[bucket];
    return {
      bucket,
      ...row,
      empiricalCorrectness: ratio(row.verifiedCorrect, row.verifiedCorrect + row.verifiedIncorrect),
    };
  });
}

export function runSalesIntelligenceBenchmarkV2(
  cases: SalesIntelligenceGroundTruthCase[],
  productIndex: PharmacyProductIndex,
  datasetVersion = SALES_INTELLIGENCE_GROUND_TRUTH_VERSION
): SalesIntelligenceBenchmarkReport {
  let oldTP = 0, oldFP = 0, oldFN = 0;
  let v2TP = 0, v2FP = 0, v2FN = 0;
  let falseOld = 0, falseV2 = 0;
  let wrongQty = 0, missedQty = 0, unresolvedCases = 0, regressions = 0;
  let exactBasketCases = 0, partialBasketCases = 0, wrongBasketCases = 0, intentionallyUnresolvedCases = 0;
  let labeledQuantities = 0, correctQuantities = 0;
  let mediaLimitedCases = 0, transliterationFailureCases = 0, safetyCriticalErrorCount = 0;
  let eventLabeled = 0, eventCorrect = 0, eventIncorrect = 0;
  let versionLabeled = 0, versionCorrect = 0, versionIncorrect = 0;
  let safeEdgeTotal = 0, safeEdgeCorrect = 0, safeEdgeIncorrect = 0, safeEdgeUnverifiable = 0;
  const productCalibration = emptyCalibration();
  const quantityCalibration = emptyCalibration();
  const referenceCalibration = emptyCalibration();
  let trueReviewNeeded = 0, unnecessaryReview = 0, missedReview = 0, correctlyNoReview = 0;
  const byDifficulty: Record<BenchmarkDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
  const difficultyRaw: Record<BenchmarkDifficulty, { tp: number; fp: number; fn: number; falseAddedProducts: number; wrongQuantities: number }> = {
    easy: { tp: 0, fp: 0, fn: 0, falseAddedProducts: 0, wrongQuantities: 0 },
    medium: { tp: 0, fp: 0, fn: 0, falseAddedProducts: 0, wrongQuantities: 0 },
    hard: { tp: 0, fp: 0, fn: 0, falseAddedProducts: 0, wrongQuantities: 0 },
  };
  const realV2 = { tp: 0, fp: 0, fn: 0 };
  const syntheticV2 = { tp: 0, fp: 0, fn: 0 };
  const failureCounts: Partial<Record<BenchmarkFailureCategory, number>> = {};

  const results: SalesIntelligenceBenchmarkCaseResult[] = cases.map((c) => {
    const messages = messagesFrom(c.raw, c.trustedConversationStartedAt);
    const old = runOld(c.id, messages, productIndex);
    const v2 = runV2(c.id, messages, productIndex);
    const expected = new Set(c.groundTruth.expectedAddedProductCodes);
    const never = new Set(c.groundTruth.expectedNeverAddedProductCodes);
    const oldM = countItemMetrics(old.items, expected);
    const v2M = countItemMetrics(v2.items, expected);
    oldTP += oldM.tp; oldFP += oldM.fp; oldFN += oldM.fn;
    v2TP += v2M.tp; v2FP += v2M.fp; v2FN += v2M.fn;

    const oldCodes = new Set(old.items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
    const v2Codes = new Set(v2.items.map((i) => i.productCode).filter((x): x is string => Boolean(x)));
    // Safety definition: any SKU present in the reconstructed basket but absent from the complete
    // Ground Truth basket is a false-added product. Do not restrict this to a hand-written denylist.
    for (const code of oldCodes) if (!expected.has(code)) falseOld++;
    for (const code of v2Codes) if (!expected.has(code)) falseV2++;

    for (const [code, expectedQty] of Object.entries(c.groundTruth.expectedQuantities)) {
      if (expectedQty === null) continue;
      labeledQuantities++;
      const item = v2.items.find((i) => i.productCode === code);
      if (!item || item.quantity === null) missedQty++;
      else if (item.quantity !== expectedQty) wrongQty++;
      else correctQuantities++;
    }

    if (v2.unresolved) unresolvedCases++;
    const classification = classifyCase(c, old.items, v2.items, v2.unresolved);
    if (classification === 'old_correct_v2_regression') regressions++;
    if (classification === 'both_correct' || classification === 'v2_fixed_old') exactBasketCases++;
    else if (classification === 'intentionally_unresolved') intentionallyUnresolvedCases++;
    else if (classification === 'both_partial') partialBasketCases++;
    else wrongBasketCases++;

    if (c.groundTruth.expectedEventTypes) {
      eventLabeled++;
      let cursor = 0;
      for (const actual of v2.eventTypes) {
        if (actual === c.groundTruth.expectedEventTypes[cursor]) cursor++;
        if (cursor === c.groundTruth.expectedEventTypes.length) break;
      }
      cursor === c.groundTruth.expectedEventTypes.length ? eventCorrect++ : eventIncorrect++;
    }
    if (typeof c.groundTruth.expectedVersionCount === 'number') {
      versionLabeled++;
      v2.versionCount === c.groundTruth.expectedVersionCount ? versionCorrect++ : versionIncorrect++;
    }

    const reviewExpected = c.groundTruth.expectUnresolvedSignal;
    if (reviewExpected && v2.unresolved) trueReviewNeeded++;
    else if (!reviewExpected && v2.unresolved) unnecessaryReview++;
    else if (reviewExpected && !v2.unresolved) missedReview++;
    else correctlyNoReview++;

    const difficulty = difficultyFor(c);
    for (const code of v2Codes) if (!expected.has(code)) difficultyRaw[difficulty].falseAddedProducts++;
    for (const [code, expectedQty] of Object.entries(c.groundTruth.expectedQuantities)) {
      if (expectedQty === null) continue;
      const item = v2.items.find((i) => i.productCode === code);
      if (item && item.quantity !== null && item.quantity !== expectedQty) difficultyRaw[difficulty].wrongQuantities++;
    }
    byDifficulty[difficulty]++;
    difficultyRaw[difficulty].tp += v2M.tp;
    difficultyRaw[difficulty].fp += v2M.fp;
    difficultyRaw[difficulty].fn += v2M.fn;
    if (c.source === 'real') {
      realV2.tp += v2M.tp; realV2.fp += v2M.fp; realV2.fn += v2M.fn;
    } else {
      syntheticV2.tp += v2M.tp; syntheticV2.fp += v2M.fp; syntheticV2.fn += v2M.fn;
    }
    const failure = inferFailures(c, v2.graph, v2.items, messages.length > 0);
    for (const f of failure.failures) failureCounts[f] = (failureCounts[f] ?? 0) + 1;
    if (failure.failures.includes('media_unavailable')) mediaLimitedCases++;
    if (failure.failures.includes('transliteration_failure')) transliterationFailureCases++;
    safetyCriticalErrorCount += failure.safetyCritical.length;

    // Confidence calibration: score only what Ground Truth can actually verify; everything else
    // remains explicitly unverifiable. This prevents confidence charts from rewarding unlabeled
    // predictions by default.
    for (const p of v2.graph.productMentions) {
      const bucket = confidenceBucket(p.confidence);
      productCalibration[bucket].total++;
      const code = p.canonicalProductCode;
      if (!code) productCalibration[bucket].unverifiable++;
      else if (!expected.has(code)) productCalibration[bucket].verifiedIncorrect++;
      else if (expected.has(code)) productCalibration[bucket].verifiedCorrect++;
      else productCalibration[bucket].unverifiable++;
    }

    const codeByProductNodeId = new Map(v2.graph.productMentions.map((p) => [p.id, p.canonicalProductCode] as const));
    const quantityByNodeIdForCalibration = new Map(v2.graph.quantities.map((q) => [q.id, q] as const));
    for (const edge of v2.graph.edges.filter((e) => e.type === 'quantity_applies_to_product')) {
      const bucket = confidenceBucket(edge.confidence);
      quantityCalibration[bucket].total++;
      const code = codeByProductNodeId.get(edge.toNodeId) ?? null;
      const q = quantityByNodeIdForCalibration.get(edge.fromNodeId);
      const expectedQty = code ? c.groundTruth.expectedQuantities[code] : undefined;
      if (code && q && typeof expectedQty === 'number') {
        q.value === expectedQty ? quantityCalibration[bucket].verifiedCorrect++ : quantityCalibration[bucket].verifiedIncorrect++;
      } else if (code && !expected.has(code)) {
        quantityCalibration[bucket].verifiedIncorrect++;
      } else {
        quantityCalibration[bucket].unverifiable++;
      }
    }

    for (const edge of v2.graph.edges.filter((e) => e.type === 'reference_points_to_product')) {
      const bucket = confidenceBucket(edge.confidence);
      referenceCalibration[bucket].total++;
      const code = codeByProductNodeId.get(edge.toNodeId) ?? null;
      if (code && !expected.has(code)) referenceCalibration[bucket].verifiedIncorrect++;
      else if (code && c.groundTruth.expectedAddedProductCodes.length === 1 && c.groundTruth.expectedAddedProductCodes[0] === code) referenceCalibration[bucket].verifiedCorrect++;
      else referenceCalibration[bucket].unverifiable++;
    }

    // I.B.4 safe-edge calibration. We only score an edge when this Ground Truth case can actually
    // verify it. Everything else is explicitly "unverifiable" rather than being counted correct.
    // This prevents an attractive but meaningless near-100% safe-edge number.
    const productCodeByNodeId = new Map(v2.graph.productMentions.map((p) => [p.id, p.canonicalProductCode] as const));
    const quantityByNodeId = new Map(v2.graph.quantities.map((q) => [q.id, q] as const));
    for (const edge of v2.graph.edges.filter((e) => e.safety === 'safe' && (e.type === 'quantity_applies_to_product' || e.type === 'reference_points_to_product'))) {
      safeEdgeTotal++;
      const targetCode = productCodeByNodeId.get(edge.toNodeId) ?? null;
      if (targetCode && !expected.has(targetCode)) {
        safeEdgeIncorrect++;
        continue;
      }
      if (edge.type === 'quantity_applies_to_product') {
        const q = quantityByNodeId.get(edge.fromNodeId);
        const expectedQty = targetCode ? c.groundTruth.expectedQuantities[targetCode] : undefined;
        if (q && targetCode && typeof expectedQty === 'number') {
          q.value === expectedQty ? safeEdgeCorrect++ : safeEdgeIncorrect++;
        } else {
          safeEdgeUnverifiable++;
        }
      } else if (targetCode && c.groundTruth.expectedAddedProductCodes.length === 1 && c.groundTruth.expectedAddedProductCodes[0] === targetCode) {
        // Only one expected ordered SKU: a safe reference to that exact SKU is verifiable.
        safeEdgeCorrect++;
      } else {
        safeEdgeUnverifiable++;
      }
    }

    return {
      caseId: c.id,
      source: c.source,
      category: c.category,
      difficulty,
      classification,
      groundTruth: {
        addedProductCodes: [...c.groundTruth.expectedAddedProductCodes],
        neverAddedProductCodes: [...c.groundTruth.expectedNeverAddedProductCodes],
        quantities: { ...c.groundTruth.expectedQuantities },
        expectedStatus: c.groundTruth.expectedStatus,
        expectUnresolvedSignal: c.groundTruth.expectUnresolvedSignal,
      },
      old: {
        productCodes: Array.from(oldCodes).sort(),
        status: old.status,
      },
      v2: {
        productCodes: Array.from(v2Codes).sort(),
        quantities: Object.fromEntries(v2.items.filter((i) => i.productCode).map((i) => [i.productCode!, i.quantity])),
        status: v2.status,
        unresolved: v2.unresolved,
        basketVersionCount: v2.versionCount,
      },
      failures: failure.failures,
      safetyCritical: failure.safetyCritical,
      firstDivergence: failure.firstDivergence,
    };
  });

  const difficultyMetrics = Object.fromEntries(
    (['easy', 'medium', 'hard'] as BenchmarkDifficulty[]).map((difficulty) => {
      const raw = difficultyRaw[difficulty];
      return [difficulty, {
        cases: byDifficulty[difficulty],
        tp: raw.tp,
        fp: raw.fp,
        fn: raw.fn,
        precision: ratio(raw.tp, raw.tp + raw.fp),
        recall: ratio(raw.tp, raw.tp + raw.fn),
        falseAddedProducts: raw.falseAddedProducts,
        wrongQuantities: raw.wrongQuantities,
      }];
    })
  ) as Record<BenchmarkDifficulty, DifficultyBenchmarkMetricsV2>;

  const metrics: SalesIntelligenceBenchmarkMetrics = {
    datasetVersion,
    totalCases: cases.length,
    realCases: cases.filter((c) => c.source === 'real').length,
    syntheticCases: cases.filter((c) => c.source === 'synthetic').length,
    realPositiveOrderCases: cases.filter((c) => c.source === 'real' && c.groundTruth.expectedAddedProductCodes.length > 0).length,
    realHardCases: cases.filter((c) => c.source === 'real' && difficultyFor(c) === 'hard').length,
    byDifficulty,
    difficultyMetrics,
    realOnlyV2Product: { ...realV2, precision: ratio(realV2.tp, realV2.tp + realV2.fp), recall: ratio(realV2.tp, realV2.tp + realV2.fn) },
    syntheticOnlyV2Product: { ...syntheticV2, precision: ratio(syntheticV2.tp, syntheticV2.tp + syntheticV2.fp), recall: ratio(syntheticV2.tp, syntheticV2.tp + syntheticV2.fn) },
    oldProduct: { tp: oldTP, fp: oldFP, fn: oldFN, precision: ratio(oldTP, oldTP + oldFP), recall: ratio(oldTP, oldTP + oldFN) },
    v2Product: { tp: v2TP, fp: v2FP, fn: v2FN, precision: ratio(v2TP, v2TP + v2FP), recall: ratio(v2TP, v2TP + v2FN) },
    canonicalSkuAccuracy: ratio(v2TP, v2TP + v2FP),
    basketMatch: {
      exactCases: exactBasketCases,
      partialCases: partialBasketCases,
      wrongCases: wrongBasketCases,
      intentionallyUnresolvedCases,
      exactRate: ratio(exactBasketCases, cases.length),
      partialRate: ratio(partialBasketCases, cases.length),
    },
    quantityTargetAudit: {
      labeled: labeledQuantities,
      correct: correctQuantities,
      incorrect: wrongQty,
      missed: missedQty,
      accuracy: ratio(correctQuantities, labeledQuantities),
    },
    falseAddedProductToBasket: { old: falseOld, v2: falseV2 },
    safeEdgeAudit: {
      total: safeEdgeTotal,
      verifiedCorrect: safeEdgeCorrect,
      verifiedIncorrect: safeEdgeIncorrect,
      unverifiable: safeEdgeUnverifiable,
      empiricalErrorRate: ratio(safeEdgeIncorrect, safeEdgeCorrect + safeEdgeIncorrect),
    },
    confidenceCalibration: {
      productMentions: finalizeCalibration(productCalibration),
      quantityLinks: finalizeCalibration(quantityCalibration),
      referenceLinks: finalizeCalibration(referenceCalibration),
    },
    humanReviewQuality: {
      trueReviewNeeded,
      unnecessaryReview,
      missedReview,
      correctlyNoReview,
      precision: ratio(trueReviewNeeded, trueReviewNeeded + unnecessaryReview),
      recall: ratio(trueReviewNeeded, trueReviewNeeded + missedReview),
    },
    eventSequenceAudit: {
      labeledCases: eventLabeled,
      correct: eventCorrect,
      incorrect: eventIncorrect,
      unverifiable: cases.length - eventLabeled,
      accuracy: ratio(eventCorrect, eventLabeled),
    },
    versioningAudit: {
      labeledCases: versionLabeled,
      correct: versionCorrect,
      incorrect: versionIncorrect,
      unverifiable: cases.length - versionLabeled,
      accuracy: ratio(versionCorrect, versionLabeled),
    },
    wrongQuantityAppliedToCorrectProduct: wrongQty,
    missedExpectedQuantity: missedQty,
    unresolvedCases,
    mediaLimitedCases,
    transliterationFailureCases,
    safetyCriticalErrorCount,
    regressions,
    failureCounts,
  };

  const reportWithoutRenderers = {
    datasetVersion,
    generatedBy: 'runSalesIntelligenceBenchmarkV2' as const,
    metrics,
    cases: results,
  };
  const machineReadableJson = stableStringify(reportWithoutRenderers);
  const humanSummary = [
    `Dataset: ${datasetVersion}`,
    `Cases: ${metrics.totalCases} (real ${metrics.realCases}, synthetic ${metrics.syntheticCases})`,
    `Real positive-order cases: ${metrics.realPositiveOrderCases}; real hard cases: ${metrics.realHardCases}`,
    `V2 product precision: ${(metrics.v2Product.precision * 100).toFixed(1)}%`,
    `V2 product recall: ${(metrics.v2Product.recall * 100).toFixed(1)}%`,
    `Exact basket match: ${metrics.basketMatch.exactCases}/${metrics.totalCases} (${(metrics.basketMatch.exactRate * 100).toFixed(1)}%); partial: ${metrics.basketMatch.partialCases}`,
    `Quantity target accuracy: ${metrics.quantityTargetAudit.correct}/${metrics.quantityTargetAudit.labeled} (${(metrics.quantityTargetAudit.accuracy * 100).toFixed(1)}%)`,
    `Real-only V2 product precision/recall: ${(metrics.realOnlyV2Product.precision * 100).toFixed(1)}% / ${(metrics.realOnlyV2Product.recall * 100).toFixed(1)}%`,
    `False-added products: ${metrics.falseAddedProductToBasket.v2}`,
    `Safe edges: ${metrics.safeEdgeAudit.total} (verified wrong ${metrics.safeEdgeAudit.verifiedIncorrect}, unverifiable ${metrics.safeEdgeAudit.unverifiable})`,
    `Human review precision/recall: ${(metrics.humanReviewQuality.precision * 100).toFixed(1)}% / ${(metrics.humanReviewQuality.recall * 100).toFixed(1)}%`,
    `Event sequence audit: ${metrics.eventSequenceAudit.correct}/${metrics.eventSequenceAudit.labeledCases} labeled correct; versioning: ${metrics.versioningAudit.correct}/${metrics.versioningAudit.labeledCases}`,
    `Wrong quantity links: ${metrics.wrongQuantityAppliedToCorrectProduct}`,
    `V2 regressions: ${metrics.regressions}`,
    `Unresolved/review cases: ${metrics.unresolvedCases}`,
    `Media-limited cases: ${metrics.mediaLimitedCases}; transliteration failures: ${metrics.transliterationFailureCases}`,
    `Safety-critical errors: ${metrics.safetyCriticalErrorCount}`,
  ].join('\n');

  return { ...reportWithoutRenderers, machineReadableJson, humanSummary };
}
