import { describe, expect, it } from 'vitest';
import { buildCustomerJourneyDecisionV8 } from '../whatsappCustomerJourneyDecisionV8';

const now = new Date('2026-09-15T18:00:00.000Z');
const src = (overrides: any = {}) => ({
  id: 's1',
  conversationStartedAt: new Date('2026-09-14T10:00:00.000Z'),
  conversationEndedAt: new Date('2026-09-14T10:30:00.000Z'),
  primaryIntent: 'general_service',
  outcome: 'unknown',
  priority: 'normal',
  invoiceStatus: 'not_found',
  invoiceValue: 0,
  followupRequired: false,
  initiator: 'customer',
  ...overrides,
});

describe('WhatsApp Customer Journey Decision V8', () => {
  it('prioritizes unresolved complaint immediately', () => {
    const result = buildCustomerJourneyDecisionV8({
      now,
      sources: [src({ id: 'complaint', primaryIntent: 'complaint', outcome: 'complaint_unresolved', priority: 'urgent' })],
      actions: [],
    });
    expect(result.state).toBe('urgent_complaint');
    expect(result.shouldContact).toBe(true);
    expect(result.urgency).toBe('urgent');
  });

  it('does not message again immediately for a recent unresolved request', () => {
    const result = buildCustomerJourneyDecisionV8({
      now,
      sources: [src({
        id: 'request',
        outcome: 'unresolved_request',
        conversationEndedAt: new Date('2026-09-15T12:30:00.000Z'),
      })],
      actions: [],
    });
    expect(result.state).toBe('pending_request');
    expect(result.shouldContact).toBe(false);
    expect(result.suggestedDelayHours).toBe(18);
  });

  it('waits for invoice before treating a probable sale as post-purchase', () => {
    const result = buildCustomerJourneyDecisionV8({
      now,
      sources: [src({ id: 'sale', outcome: 'probable_sale', invoiceStatus: 'probable' })],
      actions: [],
      cycle: { verifiedRevenue: 0, verifiedInvoiceCount: 0, verifiedRevenueOver500: false },
    });
    expect(result.state).toBe('sale_pending_invoice');
    expect(result.shouldContact).toBe(false);
  });

  it('creates post-purchase contact for verified cycle revenue over 500 when contact is not recent', () => {
    const result = buildCustomerJourneyDecisionV8({
      now,
      sources: [src({
        id: 'old-sale',
        outcome: 'completed_sale',
        invoiceStatus: 'verified',
        invoiceValue: 750,
        conversationEndedAt: new Date('2026-09-13T10:00:00.000Z'),
      })],
      actions: [],
      cycle: { verifiedRevenue: 750, verifiedInvoiceCount: 1, verifiedRevenueOver500: true },
    });
    expect(result.state).toBe('post_purchase_followup');
    expect(result.shouldContact).toBe(true);
  });

  it('keeps recently contacted +500 customer suppressed temporarily', () => {
    const result = buildCustomerJourneyDecisionV8({
      now,
      sources: [src({
        id: 'recent-sale',
        outcome: 'completed_sale',
        invoiceStatus: 'verified',
        invoiceValue: 900,
        conversationEndedAt: new Date('2026-09-15T10:00:00.000Z'),
      })],
      actions: [],
      cycle: { verifiedRevenue: 900, verifiedInvoiceCount: 1, verifiedRevenueOver500: true },
    });
    expect(result.state).toBe('recently_contacted');
    expect(result.shouldContact).toBe(false);
  });

  it('prioritizes overdue operational action before normal recommendation follow-up', () => {
    const result = buildCustomerJourneyDecisionV8({
      now,
      sources: [src({ id: 'rec', primaryIntent: 'doctor_recommendation', outcome: 'needs_followup' })],
      actions: [{
        id: 'a1', type: 'recommendation_followup', status: 'ready',
        dueAt: new Date('2026-09-15T08:00:00.000Z'), reason: 'متابعة نتيجة الترشيح', productName: 'منتج تجريبي',
      }],
    });
    expect(result.state).toBe('overdue_action');
    expect(result.shouldContact).toBe(true);
    expect(result.openActionIds).toContain('a1');
  });
});
