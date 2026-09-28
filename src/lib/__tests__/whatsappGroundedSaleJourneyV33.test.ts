import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence, type UnifiedInvoiceVerification } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';
import { buildSmartConversationEvaluationV2 } from '@/lib/whatsappConversationEvaluationV2';
import { buildConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';
import { buildGroundedSaleJourneyV33 } from '@/lib/whatsappGroundedSaleJourneyV33';

function session(raw: string) {
  return splitWhatsAppSessions(parseWhatsAppExport(raw), 240)[0];
}

function verifiedInvoice(at = '2026-09-15T09:06:00.000Z'): UnifiedInvoiceVerification {
  return {
    status: 'verified',
    bestCandidate: {
      invoiceId: 'inv-1',
      invoiceNumber: '12345',
      invoiceDate: at,
      branch: 'فرع الشامي',
      sellerName: 'د هبة',
      customerCode: 'C1',
      customerName: 'Customer',
      customerPhone: '01012345678',
      customerAddress: 'المحلة شارع البحر',
      amount: 250,
      score: 95,
      confidence: 0.96,
      reasons: ['test'],
      matchedIdentityStrategies: ['customer_id'],
    },
    candidates: [],
    verificationConfidence: 0.96,
    revenue: 250,
    reason: 'تطابق فاتورة قوي',
    warnings: [],
  };
}

describe('GroundedSaleJourneyV33', () => {
  it('starts at the actual customer request instead of the greeting', () => {
    const s = session(`[9/15/26, 9:00:00 AM] Customer: السلام عليكم
[9/15/26, 9:01:00 AM] You: مساء الخير يا فندم مع حضرتك د هبة من صيدليات دواء
[9/15/26, 9:02:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:03:00 AM] You: متوفر
[9/15/26, 9:04:00 AM] Customer: تمام ابعته
[9/15/26, 9:05:00 AM] You: حضرتك كده معانا فيتامين د عدد 1 تمام؟
[9/15/26, 9:05:30 AM] Customer: تمام
[9/15/26, 9:06:00 AM] You: تحت أمر حضرتك`);
    const invoice = verifiedInvoice();
    const operational = buildWhatsAppOperationalIntelligenceV6(s, buildUnifiedConversationIntelligence(s));
    const evaluation = buildSmartConversationEvaluationV2(s, { invoiceVerification: invoice });
    const timing = buildConversationTimingV28(s, null, invoice);
    const journey = buildGroundedSaleJourneyV33({ session: s, operational, invoiceVerification: invoice, evaluation, timing });

    expect(journey.outcome).toBe('verified_sale');
    expect(journey.saleWindow.startMessageId).toBe(s.messages.find((m) => /عايز فيتامين/.test(m.text))?.id);
    expect(journey.saleWindow.startedAt).toContain('09:02');
    expect(journey.stages.find((stage) => stage.key === 'order_confirmation')?.detected).toBe(true);
  });

  it('ends the sale at the verified invoice and keeps a later complaint in the wider customer journey only', () => {
    const s = session(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر
[9/15/26, 9:03:00 AM] Customer: تمام ابعته
[9/15/26, 9:04:00 AM] You: تم تأكيد الطلب
[9/15/26, 10:00:00 AM] Customer: الطلب لسه ماوصلش وفيه تأخير
[9/15/26, 10:02:00 AM] You: بنعتذر لحضرتك وهنتابع مع المندوب`);
    const invoice = verifiedInvoice('2026-09-15T09:06:00.000Z');
    const operational = buildWhatsAppOperationalIntelligenceV6(s, buildUnifiedConversationIntelligence(s));
    const evaluation = buildSmartConversationEvaluationV2(s, { invoiceVerification: invoice });
    const timing = buildConversationTimingV28(s, null, invoice);
    const journey = buildGroundedSaleJourneyV33({ session: s, operational, invoiceVerification: invoice, evaluation, timing });

    const complaintId = s.messages.find((m) => /لسه ماوصلش/.test(m.text))?.id;
    expect(journey.saleWindow.endedAt).toBe('2026-09-15T09:06:00.000Z');
    expect(complaintId).toBeTruthy();
    expect(journey.saleWindow.messageIds).not.toContain(complaintId);
    expect(journey.customerJourneyWindow.messageIds).toContain(complaintId);
    expect(journey.complaintMessageIds).toContain(complaintId);
    expect(journey.coaching.complaintPoints.length).toBeGreaterThan(0);
  });

  it('does not invent a commercial journey when there is only a greeting', () => {
    const s = session(`[9/15/26, 9:00:00 AM] Customer: السلام عليكم يادكتور
[9/15/26, 9:01:00 AM] You: وعليكم السلام تحت أمر حضرتك`);
    const invoice: UnifiedInvoiceVerification = {
      status: 'not_found',
      bestCandidate: null,
      candidates: [],
      verificationConfidence: 0.75,
      revenue: null,
      reason: 'لا توجد فاتورة',
      warnings: [],
    };
    const operational = buildWhatsAppOperationalIntelligenceV6(s, buildUnifiedConversationIntelligence(s));
    const evaluation = buildSmartConversationEvaluationV2(s, { invoiceVerification: invoice });
    const timing = buildConversationTimingV28(s, null, invoice);
    const journey = buildGroundedSaleJourneyV33({ session: s, operational, invoiceVerification: invoice, evaluation, timing });

    expect(journey.commercial).toBe(false);
    expect(journey.outcome).toBe('non_commercial');
    expect(journey.saleWindow.startMessageId).toBeNull();
  });
});
