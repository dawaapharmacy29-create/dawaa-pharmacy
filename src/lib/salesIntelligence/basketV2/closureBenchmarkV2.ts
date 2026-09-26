// Phase I.B.4 — deterministic shadow benchmark for Historical Commercial Closure.
//
// This compares the CURRENT legacy closure assessment against the Basket-V2-informed SHADOW
// assessment on independently-labelled cases. Read-only only: no persistence, no policy, no scoring.
import { parseWhatsAppExport, splitWhatsAppSessions } from '../../whatsappConversationParser';
import { buildConversationUnderstandingV32 } from '../../whatsappConversationUnderstandingV32';
import type { NormalizedConversationMessageV32 } from '../../whatsappConversationUnderstandingV32';
import { buildCaseBaskets } from '../caseBasketEngine';
import { deriveCommercialConfirmationState } from '../commercialConfirmationEngine';
import { deriveHistoricalCommercialClosureAssessment } from '../historicalCommercialClosureEngine';
import type { HistoricalClosureLevel } from '../types';
import type { PharmacyProductIndex } from '../pharmacyProducts/pharmacyProductResolverV2';
import { buildConversationEntityGraphV2 } from './conversationEntityGraphV2';
import { reconstructBasketV2 } from './basketReconstructionV2';
import { deriveHistoricalClosureShadowFromBasketV2 } from './historicalClosureShadowV2';

export interface ClosureGroundTruthCaseV2 {
  id: string;
  source: 'real' | 'synthetic';
  sourceNote: string;
  raw: string;
  expectedLevel: HistoricalClosureLevel;
}

export interface ClosureBenchmarkCaseResultV2 {
  caseId: string;
  source: 'real' | 'synthetic';
  expectedLevel: HistoricalClosureLevel;
  currentLevel: HistoricalClosureLevel;
  shadowLevel: HistoricalClosureLevel;
  currentExact: boolean;
  shadowExact: boolean;
  currentOverclaim: boolean;
  shadowOverclaim: boolean;
}

export interface BinaryClosureMetricsV2 {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  falseClosureRate: number;
}

export interface ClosureBenchmarkReportV2 {
  totalCases: number;
  realCases: number;
  syntheticCases: number;
  realExpectedClosedCases: number;
  realExpectedNotClosedCases: number;
  currentExactMatches: number;
  shadowExactMatches: number;
  currentOverclaims: number;
  shadowOverclaims: number;
  currentBinary: BinaryClosureMetricsV2;
  shadowBinary: BinaryClosureMetricsV2;
  falseClosuresPreventedByShadow: number;
  genuineClosuresLostByShadow: number;
  cases: ClosureBenchmarkCaseResultV2[];
}

function messagesFrom(raw: string): NormalizedConversationMessageV32[] {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  if (sessions.length === 0) return [];
  return buildConversationUnderstandingV32(sessions[0]).messages;
}

function closureAchieved(level: HistoricalClosureLevel): boolean {
  return level === 'strongly_inferred' || level === 'explicit';
}

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

function binaryMetrics(cases: ClosureGroundTruthCaseV2[], results: ClosureBenchmarkCaseResultV2[], useShadow: boolean): BinaryClosureMetricsV2 {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  results.forEach((r, index) => {
    const expected = closureAchieved(cases[index].expectedLevel);
    const actual = closureAchieved(useShadow ? r.shadowLevel : r.currentLevel);
    if (expected && actual) tp++;
    else if (!expected && actual) fp++;
    else if (expected && !actual) fn++;
    else tn++;
  });
  return {
    tp, fp, fn, tn,
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    falseClosureRate: ratio(fp, fp + tn),
  };
}

function overclaimRank(level: HistoricalClosureLevel): number {
  switch (level) {
    case 'unknown':
    case 'not_closed':
      return 0;
    case 'weakly_inferred':
      return 1;
    case 'strongly_inferred':
      return 2;
    case 'explicit':
      return 3;
  }
}

export function runHistoricalClosureBenchmarkV2(
  cases: ClosureGroundTruthCaseV2[],
  productIndex: PharmacyProductIndex
): ClosureBenchmarkReportV2 {
  const results: ClosureBenchmarkCaseResultV2[] = cases.map((c) => {
    const messages = messagesFrom(c.raw);
    const caseId = `closure-benchmark:${c.id}`;

    const oldBasket = buildCaseBaskets(caseId, messages);
    const oldCommercial = deriveCommercialConfirmationState(
      caseId,
      oldBasket.baskets,
      oldBasket.summaryEvents,
      oldBasket.customerConfirmationEvents,
      oldBasket.staffFinalConfirmationEvents
    );
    const oldLatest = oldBasket.baskets[oldBasket.baskets.length - 1] ?? null;
    const oldItems = oldLatest ? (oldBasket.itemsByBasketId[oldLatest.basketId] ?? []) : [];
    const current = deriveHistoricalCommercialClosureAssessment(
      caseId,
      messages,
      oldCommercial,
      oldItems,
      oldLatest?.announcedTotal != null
    );

    const graph = buildConversationEntityGraphV2(caseId, messages, { productIndex });
    const timestamps = new Map(messages.map((m) => [m.id, m.timestamp.toISOString()] as const));
    const basketV2 = reconstructBasketV2(graph, timestamps).currentBasket;
    const shadow = deriveHistoricalClosureShadowFromBasketV2(caseId, messages, oldCommercial, basketV2);

    return {
      caseId: c.id,
      source: c.source,
      expectedLevel: c.expectedLevel,
      currentLevel: current.closureLevel,
      shadowLevel: shadow.closureLevel,
      currentExact: current.closureLevel === c.expectedLevel,
      shadowExact: shadow.closureLevel === c.expectedLevel,
      currentOverclaim: overclaimRank(current.closureLevel) > overclaimRank(c.expectedLevel),
      shadowOverclaim: overclaimRank(shadow.closureLevel) > overclaimRank(c.expectedLevel),
    };
  });

  const currentBinary = binaryMetrics(cases, results, false);
  const shadowBinary = binaryMetrics(cases, results, true);
  // Rank-based, not binary-`closureAchieved`-based: the known advisory-politeness false positive
  // (C01 — staff says "من عنيا" mid-advisory, no product ever accepted) has current=`weakly_inferred`
  // against expected=`not_closed`, a real overclaim, but `weakly_inferred` never satisfies
  // `closureAchieved` (which only counts strongly_inferred/explicit) — so the strict binary
  // definition could never credit the shadow assessment for correctly settling it back down to
  // `not_closed`, even though that IS the exact false positive this metric exists to catch. Overclaim
  // RANK (already computed per-case above) captures every degree of overclaim, not just the ones that
  // cross the binary "achieved" line.
  const falseClosuresPreventedByShadow = results.filter((r, index) => {
    const expectedRank = overclaimRank(cases[index].expectedLevel);
    return overclaimRank(r.currentLevel) > expectedRank && overclaimRank(r.shadowLevel) <= expectedRank;
  }).length;
  const genuineClosuresLostByShadow = results.filter((r, index) => {
    const expectedClosed = closureAchieved(cases[index].expectedLevel);
    return expectedClosed && closureAchieved(r.currentLevel) && !closureAchieved(r.shadowLevel);
  }).length;

  return {
    totalCases: cases.length,
    realCases: cases.filter((c) => c.source === 'real').length,
    syntheticCases: cases.filter((c) => c.source === 'synthetic').length,
    realExpectedClosedCases: cases.filter((c) => c.source === 'real' && closureAchieved(c.expectedLevel)).length,
    realExpectedNotClosedCases: cases.filter((c) => c.source === 'real' && !closureAchieved(c.expectedLevel)).length,
    currentExactMatches: results.filter((r) => r.currentExact).length,
    shadowExactMatches: results.filter((r) => r.shadowExact).length,
    currentOverclaims: results.filter((r) => r.currentOverclaim).length,
    shadowOverclaims: results.filter((r) => r.shadowOverclaim).length,
    currentBinary,
    shadowBinary,
    falseClosuresPreventedByShadow,
    genuineClosuresLostByShadow,
    cases: results,
  };
}
