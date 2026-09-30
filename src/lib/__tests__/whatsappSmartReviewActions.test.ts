import { describe, expect, it } from 'vitest';
import { buildSmartReviewActionPlan } from '../whatsappSmartReviewActions';
import type { SmartDeepConversationAnalysis } from '../whatsappSmartConversationIntelligence';

function deep(overrides: Partial<SmartDeepConversationAnalysis> = {}): SmartDeepConversationAnalysis {
  return {
    entryOrigin: 'customer_initiated',
    primaryIntent: 'product_request',
    intentJourney: ['product_request'],
    confidence: 1,
    humanReviewRequired: false,
    salesOpportunities: [],
    consultationCommunication: 'not_applicable',
    consultationEvidenceMessageIds: [],
    unavailableItem: { detected: false, evidenceMessageIds: [], alternativeOffered: false, alternativeExplained: false, requestRegistered: false, customerToldRequestRegistered: false, suggestedCriteria: [] },
    customerRequest: { detected: false, productName: null, customerName: null, customerCode: null, customerPhone: null, quantity: null, concentration: null, evidenceMessageIds: [], confidence: 'low', needsConfirmation: false },
    followup: { detected: false, reason: null, evidenceMessageIds: [], needsConfirmation: false },
    suggestedCriteria: [],
    evidenceMessageIds: [],
    ...overrides,
  };
}

describe('whatsappSmartReviewActions', () => {
  it('creates a confirmable customer request handoff without auto-registering it', () => {
    const plan = buildSmartReviewActionPlan({
      staffName: 'اسلام',
      fallbackCustomerName: 'أحمد',
      intelligence: deep({
        unavailableItem: { detected: true, evidenceMessageIds: ['m1'], alternativeOffered: false, alternativeExplained: false, requestRegistered: false, customerToldRequestRegistered: false, suggestedCriteria: ['unavailable_items'] },
        customerRequest: { detected: true, productName: 'فلورست', customerName: null, customerCode: '4250', customerPhone: '01000000000', quantity: '2', concentration: null, evidenceMessageIds: ['m2'], confidence: 'high', needsConfirmation: false },
      }),
    });
    expect(plan.customerRequest?.productName).toBe('فلورست');
    expect(plan.customerRequest?.quantity).toBe(2);
    expect(plan.customerRequest?.customerName).toBe('أحمد');
    expect(plan.customerRequest?.needsConfirmation).toBe(true);
    expect(plan.customerRequest?.evidenceMessageIds).toEqual(expect.arrayContaining(['m1', 'm2']));
  });

  it('creates a followup handoff from illness or recommendation evidence', () => {
    const plan = buildSmartReviewActionPlan({
      staffName: 'هدى',
      fallbackCustomerName: 'محمد',
      intelligence: deep({
        followup: { detected: true, reason: 'illness', evidenceMessageIds: ['c1'], needsConfirmation: true },
      }),
    });
    expect(plan.followup?.reason).toContain('حالة مرضية');
    expect(plan.followup?.customerName).toBe('محمد');
    expect(plan.followup?.needsConfirmation).toBe(true);
  });
});
