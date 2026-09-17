import { describe, expect, it } from 'vitest';
import type { SmartConversationReviewResult } from '../whatsappSmartReviewResult';
import { buildSmartQuickDecision } from '../whatsappSmartReviewDecision';

function review(overrides: Partial<SmartConversationReviewResult> = {}): SmartConversationReviewResult {
  return {
    sessionId: 's1',
    staffSummaries: [{
      staffName: 'اسلام',
      role: 'pharmacist',
      startedAt: new Date('2026-09-13T03:00:00'),
      endedAt: new Date('2026-09-13T03:10:00'),
      messageIds: ['m1','m2'],
      inboundCount: 1,
      outboundCount: 1,
      primaryTypes: ['product_request'],
      journey: ['product_request'],
      finalIntent: 'product_request',
      outcome: 'order_requested_unverified',
      responseTurnCount: 1,
      unansweredTurns: 0,
      slowResponseTurns: 0,
      maxResponseSeconds: 120,
      suggestedReviewCriteria: [],
      reviewReasons: [],
      evidenceMessageIds: ['m1','m2'],
      requiresHumanReview: false,
    }],
    unassignedMessageIds: [],
    handoffs: [],
    safeForOfficialScoring: true,
    blockingReasons: [],
    ...overrides,
  };
}

describe('whatsappSmartReviewDecision', () => {
  it('keeps a clean grounded conversation eligible for quick approve', () => {
    const result = buildSmartQuickDecision(review());
    expect(result.decision).toBe('clear');
    expect(result.safeToQuickApprove).toBe(true);
  });

  it('forces detailed review when the review has blocking reasons', () => {
    const result = buildSmartQuickDecision(review({
      safeForOfficialScoring: false,
      blockingReasons: ['يوجد رسائل غير منسوبة'],
    }));
    expect(result.decision).toBe('detailed_review');
    expect(result.safeToQuickApprove).toBe(false);
  });

  it('forces detailed review for critical criteria or unanswered customer turns', () => {
    const base = review();
    base.staffSummaries[0] = {
      ...base.staffSummaries[0],
      suggestedReviewCriteria: ['order_delay_handling'],
      unansweredTurns: 1,
      requiresHumanReview: true,
      reviewReasons: ['تأخير أوردر'],
    };
    const result = buildSmartQuickDecision(base);
    expect(result.decision).toBe('detailed_review');
    expect(result.affectedCriteria).toContain('order_delay_handling');
  });

  it('returns issue for non-critical evidence without pretending to score it', () => {
    const base = review();
    base.staffSummaries[0] = {
      ...base.staffSummaries[0],
      suggestedReviewCriteria: ['sales_closing'],
      requiresHumanReview: false,
    };
    const result = buildSmartQuickDecision(base);
    expect(result.decision).toBe('issue');
    expect(result.safeToQuickApprove).toBe(false);
  });
});
