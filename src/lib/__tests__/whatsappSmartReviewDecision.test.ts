import { describe, expect, it } from 'vitest';
import type { SmartConversationReviewResult } from '../whatsappSmartReviewResult';
import { buildSmartQuickDecision } from '../whatsappSmartReviewDecision';

function review(overrides: Partial<SmartConversationReviewResult> = {}): SmartConversationReviewResult {
  return {
    sessionId: 's1',
    staffSummaries: [{
      staffName: 'اسلام', role: 'pharmacist',
      startedAt: new Date('2026-09-13T03:00:00'), endedAt: new Date('2026-09-13T03:10:00'),
      messageIds: ['m1','m2'], inboundCount: 1, outboundCount: 1,
      primaryTypes: ['product_request'], journey: ['product_request'], finalIntent: 'product_request',
      outcome: 'order_requested_unverified', responseTurnCount: 1, unansweredTurns: 0,
      slowResponseTurns: 0, maxResponseSeconds: 120, suggestedReviewCriteria: [],
      reviewReasons: [], evidenceMessageIds: ['m1','m2'], requiresHumanReview: false,
    }],
    unassignedMessageIds: [], handoffs: [], safeForOfficialScoring: true, blockingReasons: [], ...overrides,
  };
}

describe('whatsappSmartReviewDecision', () => {
  it('keeps a clean grounded conversation eligible for quick approve', () => {
    const result = buildSmartQuickDecision(review());
    expect(result.decision).toBe('clear');
    expect(result.safeToQuickApprove).toBe(true);
  });

  it('treats applicable criteria as guidance, not as proof of an issue', () => {
    const base = review();
    base.staffSummaries[0] = {
      ...base.staffSummaries[0],
      suggestedReviewCriteria: ['sales_closing', 'consultation_quality'],
      reviewReasons: [],
      requiresHumanReview: false,
    };
    const result = buildSmartQuickDecision(base);
    expect(result.decision).toBe('clear');
    expect(result.affectedCriteria).toContain('sales_closing');
    expect(result.safeToQuickApprove).toBe(true);
  });

  it('forces detailed review when the review has blocking reasons', () => {
    const result = buildSmartQuickDecision(review({ safeForOfficialScoring: false, blockingReasons: ['يوجد رسائل غير منسوبة'] }));
    expect(result.decision).toBe('detailed_review');
    expect(result.safeToQuickApprove).toBe(false);
  });

  it('forces detailed review for unanswered customer turns or an explicit human-review gate', () => {
    const base = review();
    base.staffSummaries[0] = {
      ...base.staffSummaries[0],
      suggestedReviewCriteria: ['order_delay_handling'],
      unansweredTurns: 1, requiresHumanReview: true, reviewReasons: ['تأخير أوردر'],
    };
    const result = buildSmartQuickDecision(base);
    expect(result.decision).toBe('detailed_review');
    expect(result.affectedCriteria).toContain('order_delay_handling');
  });

  it('returns issue only when there is an actual review reason, not merely an applicable criterion', () => {
    const base = review();
    base.staffSummaries[0] = {
      ...base.staffSummaries[0],
      suggestedReviewCriteria: ['sales_closing'],
      reviewReasons: ['ظهرت فرصة بيع واضحة بدون إغلاق كافٍ'],
      requiresHumanReview: false,
    };
    const result = buildSmartQuickDecision(base);
    expect(result.decision).toBe('issue');
    expect(result.safeToQuickApprove).toBe(false);
  });

  it('selects the same name by role when identities collide', () => {
    const base = review();
    base.staffSummaries.push({
      ...base.staffSummaries[0],
      role: 'customer_service',
      messageIds: ['x1'],
      reviewReasons: ['متابعة خدمة العملاء تحتاج مراجعة'],
    });
    const pharmacist = buildSmartQuickDecision(base, 'اسلام', 'pharmacist');
    const service = buildSmartQuickDecision(base, 'اسلام', 'customer_service');
    expect(pharmacist.decision).toBe('clear');
    expect(service.decision).toBe('issue');
  });
});
