import { describe, expect, it, vi } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';
import { classifyConversationJourney, mapSaleState } from '@/lib/whatsappConversationJourneyClassifier';

const NOT_APPLICABLE = {
  status: 'not_applicable' as const,
  bestCandidate: null,
  candidates: [],
  verificationConfidence: 1,
  revenue: null,
  reason: '',
  warnings: [],
};

function oneSession(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return sessions[0];
}

function classify(raw: string, invoiceVerification = NOT_APPLICABLE) {
  const session = oneSession(raw);
  const base = buildUnifiedConversationIntelligence(session);
  const operational = buildWhatsAppOperationalIntelligenceV6(session, base);
  return classifyConversationJourney(session, operational, base, invoiceVerification as any);
}

describe('classifyConversationJourney', () => {
  it('CS starts a check-in and the customer only acknowledges ("الحمد لله أحسن") -> checkin_ack_only', () => {
    const result = classify(
      `[9/15/26, 9:00:00 AM] You: عامل ايه حضرتك؟ حبينا نطمن عليك بعد العلاج\n[9/15/26, 9:01:00 AM] Customer: الحمد لله أحسن`
    );
    expect(result.checkinDetected).toBe(true);
    expect(result.requestAfterCheckin).toBe(false);
    expect(result.consultationAfterCheckin).toBe(false);
    expect(result.journeyType).toBe('checkin_ack_only');
  });

  it('CS starts a check-in, then the customer requests a product -> checkin_then_order', () => {
    const result = classify(
      `[9/15/26, 9:00:00 AM] You: عامل ايه حضرتك؟ حبينا نطمن عليك\n[9/15/26, 9:01:00 AM] Customer: الحمد لله كويس، بس عايز اطلب علبة فيتامين د\n[9/15/26, 9:02:00 AM] You: تمام هظبطلك الطلب`
    );
    expect(result.checkinDetected).toBe(true);
    expect(result.requestAfterCheckin).toBe(true);
    expect(result.journeyType).toBe('checkin_then_order');
  });

  it('CS starts a check-in -> doctor joins -> medical consultation -> checkin_then_consultation', () => {
    const result = classify(
      `[9/15/26, 9:00:00 AM] You: عامل ايه حضرتك؟ حبينا نطمن عليك\n[9/15/26, 9:01:00 AM] Customer: الحمد لله بس لسه عندي كحة\n[9/15/26, 9:02:00 AM] You: الجرعة المناسبة قرص مرتين يوميا\n[9/15/26, 9:03:00 AM] Customer: تمام هجربها`
    );
    expect(result.checkinDetected).toBe(true);
    expect(result.requestAfterCheckin).toBe(false);
    expect(result.consultationAfterCheckin).toBe(true);
    expect(result.journeyType).toBe('checkin_then_consultation');
  });

  it('pharmacy proactively apologizes for delayed order -> service_recovery_outreach', () => {
    const result = classify(
      `[9/15/26, 9:00:00 AM] You: مع حضرتك نور من خدمة عملاء صيدليات دواء، بنعتذر عن تأخير الأوردر وبنتابع مع الفريق المختص علشان يوصل في أسرع وقت ممكن
[9/15/26, 9:02:00 AM] Customer: تمام شكراً`
    );
    expect(result.journeyType).toBe('service_recovery_outreach');
    expect(result.saleState).toBe('no_verified_invoice');
  });

  it('customer opens the conversation with a direct request -> direct_customer_request', () => {
    const result = classify(
      `[9/15/26, 9:00:00 AM] Customer: عايز اطلب فيتامين د للتوصيل\n[9/15/26, 9:01:00 AM] You: تمام هظبطلك الطلب بسعر 100 جنيه`
    );
    expect(result.checkinDetected).toBe(false);
    expect(result.journeyType).toBe('direct_customer_request');
  });

  it('a check-in that leads to an invoice-verified sale -> checkin_then_verified_sale', () => {
    const result = classify(
      `[9/15/26, 9:00:00 AM] You: عامل ايه حضرتك؟ حبينا نطمن عليك\n[9/15/26, 9:01:00 AM] Customer: الحمد لله كويس، عايز اطلب فيتامين د\n[9/15/26, 9:02:00 AM] You: تم تأكيد الطلب`,
      { ...NOT_APPLICABLE, status: 'verified' }
    );
    expect(result.saleState).toBe('invoice_verified_sale');
    expect(result.journeyType).toBe('checkin_then_verified_sale');
  });
});

describe('mapSaleState', () => {
  it('chat suggests a sale but no matching invoice -> chat_sale_signal', () => {
    const state = mapSaleState({ commercialEligible: true, chatSuggestedSold: true }, { status: 'not_found' });
    expect(state).toBe('chat_sale_signal');
  });

  it('a real matching invoice confirms the sale -> invoice_verified_sale', () => {
    const state = mapSaleState({ commercialEligible: true, chatSuggestedSold: true }, { status: 'verified' });
    expect(state).toBe('invoice_verified_sale');
  });

  it('a weak invoice match is only probable, never treated as confirmed', () => {
    const state = mapSaleState({ commercialEligible: true, chatSuggestedSold: false }, { status: 'probable' });
    expect(state).toBe('probable_sale');
  });

  it('no commercial signal at all -> no_verified_invoice', () => {
    const state = mapSaleState({ commercialEligible: false, chatSuggestedSold: false }, { status: 'not_applicable' });
    expect(state).toBe('no_verified_invoice');
  });
});

describe('verifySessionAgainstInvoices end-to-end feeds mapSaleState correctly', () => {
  it('a real matching invoice from readCustomerInvoices resolves to invoice_verified_sale', async () => {
    vi.resetModules();
    vi.doMock('@/lib/readModels/customerInvoiceReadModel', () => ({
      readCustomerInvoices: async () => ({
        rows: [
          {
            id: 'inv-1',
            invoice_number: 'INV-1',
            invoice_date: '2026-09-15T09:05:00Z',
            net_total: 250,
            branch: 'الفرع الرئيسي',
            customer_code: 'C-1',
          },
        ],
        matchedBy: 'mixed',
        matchedStrategies: ['code', 'phone'],
        source: 'sales_invoices_adapter',
        warnings: [],
      }),
    }));
    const { verifySessionAgainstInvoices } = await import('@/lib/whatsappUnifiedIntelligenceV4');
    const { mapSaleState } = await import('@/lib/whatsappConversationJourneyClassifier');
    const session = oneSession(
      `[9/15/26, 9:00:00 AM] Customer: عايز اطلب فيتامين د\n[9/15/26, 9:01:00 AM] You: تم تأكيد الطلب`
    );
    const { buildUnifiedConversationIntelligence: build } = await import('@/lib/whatsappUnifiedIntelligenceV4');
    const base = build(session);
    const verification = await verifySessionAgainstInvoices(session, {
      customerId: 'cust-1',
      customerCode: 'C-1',
      customerPhone: '01000000000',
      customerName: 'Customer',
      branch: 'الفرع الرئيسي',
    });
    expect(verification.status).toBe('verified');
    expect(mapSaleState(base, verification)).toBe('invoice_verified_sale');
    vi.doUnmock('@/lib/readModels/customerInvoiceReadModel');
  });
});
