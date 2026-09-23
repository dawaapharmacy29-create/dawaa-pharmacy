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

export const SALES_INTELLIGENCE_GROUND_TRUTH_VERSION = 'dawaa-intelligence-ground-truth-v1';

export type BenchmarkSource = 'real' | 'synthetic';
export type BenchmarkDifficulty = 'easy' | 'medium' | 'hard';

export interface SalesIntelligenceGroundTruthCase {
  id: string;
  source: BenchmarkSource;
  category: string;
  difficulty?: BenchmarkDifficulty;
  sourceNote: string;
  raw: string;
  groundTruth: {
    expectedAddedProductCodes: string[];
    expectedNeverAddedProductCodes: string[];
    expectedQuantities: Record<string, number | null>;
    expectedStatus: BasketStatusV2 | null;
    expectUnresolvedSignal: boolean;
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

export interface SalesIntelligenceBenchmarkMetrics {
  datasetVersion: string;
  totalCases: number;
  realCases: number;
  syntheticCases: number;
  byDifficulty: Record<BenchmarkDifficulty, number>;
  oldProduct: { tp: number; fp: number; fn: number; precision: number; recall: number };
  v2Product: { tp: number; fp: number; fn: number; precision: number; recall: number };
  falseAddedProductToBasket: { old: number; v2: number };
  wrongQuantityAppliedToCorrectProduct: number;
  missedExpectedQuantity: number;
  unresolvedCases: number;
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

function messagesFrom(raw: string): NormalizedConversationMessageV32[] {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
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
} {
  const graph = buildConversationEntityGraphV2(caseId, messages, { productIndex: index });
  const timestamps = new Map(messages.map((m) => [m.id, m.timestamp.toISOString()] as const));
  const result = reconstructBasketV2(graph, timestamps);
  const items = result.currentBasket.items
    .filter((i) => !['removed', 'rejected', 'substituted'].includes(i.itemState))
    .map((i) => ({ productCode: i.canonicalProductCode, quantity: i.currentQuantity }));
  const unresolved = result.currentBasket.unresolvedCandidates.length > 0 || result.currentBasket.pendingReviewSignals.length > 0;
  return { graph, items, status: result.currentBasket.status, unresolved, versionCount: result.basketVersions.length + 1 };
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
      failures.push(graphCodes.has(code) ? 'basket_mutation_error' : 'product_not_detected');
    }
  }

  for (const code of never) {
    if (predicted.has(code)) {
      failures.push(graphCodes.has(code) ? 'basket_mutation_error' : 'product_wrong_sku');
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

  if (c.groundTruth.expectUnresolvedSignal && /image|media|voice/i.test(c.sourceNote)) failures.push('media_unavailable');

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

export function runSalesIntelligenceBenchmarkV2(
  cases: SalesIntelligenceGroundTruthCase[],
  productIndex: PharmacyProductIndex,
  datasetVersion = SALES_INTELLIGENCE_GROUND_TRUTH_VERSION
): SalesIntelligenceBenchmarkReport {
  let oldTP = 0, oldFP = 0, oldFN = 0;
  let v2TP = 0, v2FP = 0, v2FN = 0;
  let falseOld = 0, falseV2 = 0;
  let wrongQty = 0, missedQty = 0, unresolvedCases = 0, regressions = 0;
  const byDifficulty: Record<BenchmarkDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
  const failureCounts: Partial<Record<BenchmarkFailureCategory, number>> = {};

  const results: SalesIntelligenceBenchmarkCaseResult[] = cases.map((c) => {
    const messages = messagesFrom(c.raw);
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
    for (const code of never) {
      if (oldCodes.has(code)) falseOld++;
      if (v2Codes.has(code)) falseV2++;
    }

    for (const [code, expectedQty] of Object.entries(c.groundTruth.expectedQuantities)) {
      if (expectedQty === null) continue;
      const item = v2.items.find((i) => i.productCode === code);
      if (!item || item.quantity === null) missedQty++;
      else if (item.quantity !== expectedQty) wrongQty++;
    }

    if (v2.unresolved) unresolvedCases++;
    const classification = classifyCase(c, old.items, v2.items, v2.unresolved);
    if (classification === 'old_correct_v2_regression') regressions++;

    const difficulty = difficultyFor(c);
    byDifficulty[difficulty]++;
    const failure = inferFailures(c, v2.graph, v2.items, messages.length > 0);
    for (const f of failure.failures) failureCounts[f] = (failureCounts[f] ?? 0) + 1;

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

  const metrics: SalesIntelligenceBenchmarkMetrics = {
    datasetVersion,
    totalCases: cases.length,
    realCases: cases.filter((c) => c.source === 'real').length,
    syntheticCases: cases.filter((c) => c.source === 'synthetic').length,
    byDifficulty,
    oldProduct: { tp: oldTP, fp: oldFP, fn: oldFN, precision: ratio(oldTP, oldTP + oldFP), recall: ratio(oldTP, oldTP + oldFN) },
    v2Product: { tp: v2TP, fp: v2FP, fn: v2FN, precision: ratio(v2TP, v2TP + v2FP), recall: ratio(v2TP, v2TP + v2FN) },
    falseAddedProductToBasket: { old: falseOld, v2: falseV2 },
    wrongQuantityAppliedToCorrectProduct: wrongQty,
    missedExpectedQuantity: missedQty,
    unresolvedCases,
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
    `V2 product precision: ${(metrics.v2Product.precision * 100).toFixed(1)}%`,
    `V2 product recall: ${(metrics.v2Product.recall * 100).toFixed(1)}%`,
    `False-added products: ${metrics.falseAddedProductToBasket.v2}`,
    `Wrong quantity links: ${metrics.wrongQuantityAppliedToCorrectProduct}`,
    `V2 regressions: ${metrics.regressions}`,
    `Unresolved/review cases: ${metrics.unresolvedCases}`,
  ].join('\n');

  return { ...reportWithoutRenderers, machineReadableJson, humanSummary };
}
