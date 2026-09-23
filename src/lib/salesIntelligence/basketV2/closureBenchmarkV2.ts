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

export interface ClosureBenchmarkReportV2 {
  totalCases: number;
  realCases: number;
  syntheticCases: number;
  currentExactMatches: number;
  shadowExactMatches: number;
  currentOverclaims: number;
  shadowOverclaims: number;
  cases: ClosureBenchmarkCaseResultV2[];
}

function messagesFrom(raw: string): NormalizedConversationMessageV32[] {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  if (sessions.length === 0) return [];
  return buildConversationUnderstandingV32(sessions[0]).messages;
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

  return {
    totalCases: cases.length,
    realCases: cases.filter((c) => c.source === 'real').length,
    syntheticCases: cases.filter((c) => c.source === 'synthetic').length,
    currentExactMatches: results.filter((r) => r.currentExact).length,
    shadowExactMatches: results.filter((r) => r.shadowExact).length,
    currentOverclaims: results.filter((r) => r.currentOverclaim).length,
    shadowOverclaims: results.filter((r) => r.shadowOverclaim).length,
    cases: results,
  };
}
