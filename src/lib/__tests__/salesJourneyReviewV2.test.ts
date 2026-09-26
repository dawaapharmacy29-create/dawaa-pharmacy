import { describe, expect, it } from 'vitest';
import {
  defaultReviewState,
  defaultSevereErrors,
  evaluateConversationReview,
} from '@/lib/conversationReviews';
import { evaluateSalesJourneyReviewV2 } from '@/lib/salesJourneyReviewV2';
import type { SmartConversationEvaluationV2 } from '@/lib/whatsappConversationEvaluationV2';

function evaluation(overrides?: Partial<SmartConversationEvaluationV2>): SmartConversationEvaluationV2 {
  return {
    version: 'smart-conversation-evaluation-v2',
    generatedAt: new Date().toISOString(),
    sale: {
      outcome: 'invoice_verified_sale',
      label: 'بيع مؤكد بالفاتورة',
      confidence: 98,
      revenue: 500,
      invoiceNumber: 'INV-1',
      reason: 'test',
      evidenceMessageIds: [],
    },
    opening: {
      score: 100,
      coverage: 100,
      status: 'strong',
      passed: [],
      missing: [],
      evidence: { messageIds: [], reason: 'test', confidence: 95 },
    },
    closing: {
      score: 100,
      coverage: 100,
      status: 'strong',
      passed: [],
      missing: [],
      evidence: { messageIds: [], reason: 'test', confidence: 95 },
    },
    orderCompleteness: {
      applicable: true,
      score: 100,
      confirmedCount: 5,
      requiredCount: 5,
      items: [],
      missingCritical: [],
    },
    opportunities: {
      detected: 1,
      handled: 1,
      missed: 0,
      rescuedByAlternative: 0,
      explicitCrossSellOffers: 1,
      summary: 'test',
      evidenceMessageIds: [],
    },
    serviceRecovery: {
      detected: false,
      score: null,
      status: 'not_applicable',
      issueType: 'unknown',
      passed: [],
      missing: [],
      evidenceMessageIds: [],
      confidence: 90,
      summary: 'test',
    },
    followups: [],
    axes: [],
    qualityScore: 95,
    evidenceCoverage: 95,
    confidence: 95,
    scoreDisplayLabel: 'test',
    strongestAxis: null,
    weakestAxis: null,
    warnings: [],
    ...overrides,
  };
}

describe('review penalty de-duplication', () => {
  it('does not double-penalize missing order confirmation outside the criterion score', () => {
    const state = defaultReviewState();
    state.order_confirmation = { applies: true, choice: 'important_missing' };

    const result = evaluateConversationReview(state, defaultSevereErrors());

    expect(result.reviewItems.find((x) => x.key === 'order_confirmation')?.pointsEarned).toBe(0);
    expect(result.extraPenalties.some((p) => p.key === 'missing_order_confirmation')).toBe(false);
  });

  it('keeps operational/severe penalties separate from the criterion score', () => {
    const state = defaultReviewState();
    state.followup_after_wait = { applies: true, choice: 'never' };

    const result = evaluateConversationReview(state, defaultSevereErrors());

    expect(result.extraPenalties.some((p) => p.key === 'forgotten_customer')).toBe(true);
  });
});

describe('SalesJourneyReviewV2', () => {
  it('weights conversion more heavily than service polish for smart drafts', () => {
    const state = defaultReviewState();

    state.greeting = { applies: true, choice: 'official_full' };
    state.doctor_name = { applies: true, choice: 'start' };
    state.tone = { applies: true, choice: 'professional' };
    state.understanding = { applies: true, choice: 'strong' };

    state.sales_closing = { applies: true, choice: 'missed' };
    state.cross_sell_upsell = { applies: true, choice: 'missed' };
    state.order_confirmation = { applies: true, choice: 'full' };
    state.closing_message = { applies: true, choice: 'official' };

    const result = evaluateSalesJourneyReviewV2(
      state,
      defaultSevereErrors(),
      evaluation({
        sale: {
          outcome: 'opportunity_detected',
          label: 'فرصة بيع مفتوحة',
          confidence: 80,
          revenue: null,
          invoiceNumber: null,
          reason: 'لم يتم الإغلاق',
          evidenceMessageIds: [],
        },
      })
    );

    const conversion = result.salesJourneyAxes.find((x) => x.key === 'conversion');
    const discovery = result.salesJourneyAxes.find((x) => x.key === 'discovery');

    expect(discovery?.score).toBeGreaterThan(conversion?.score || 0);
    expect(conversion?.weight).toBe(35);
    expect(result.finalScore).toBeLessThan(result.legacyScore);
  });

  it('marks verified sale and order completeness as growth signals', () => {
    const state = defaultReviewState();
    state.sales_closing = { applies: true, choice: 'clear_order' };
    state.order_confirmation = { applies: true, choice: 'full' };

    const result = evaluateSalesJourneyReviewV2(
      state,
      defaultSevereErrors(),
      evaluation()
    );

    expect(result.growthSignals.convertedSale).toBe(true);
    expect(result.growthSignals.verifiedSale).toBe(true);
    expect(result.growthSignals.orderCompletenessScore).toBe(100);
    expect(result.saleOutcomeLabel).toBe('بيع مؤكد بالفاتورة');
  });
});
