import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildSmartConversationEvaluationV2 } from '@/lib/whatsappConversationEvaluationV2';
import type { UnifiedInvoiceVerification } from '@/lib/whatsappUnifiedIntelligenceV4';

function oneSession(raw: string) {
  const sessions = splitWhatsAppSessions(parseWhatsAppExport(raw), 120);
  expect(sessions.length).toBeGreaterThan(0);
  return sessions[0];
}

function invoice(status: UnifiedInvoiceVerification['status'], amount: number | null = null): UnifiedInvoiceVerification {
  return {
    status,
    bestCandidate: status === 'verified'
      ? {
          invoiceId: 'inv-1',
          invoiceNumber: '12345',
          invoiceDate: '2026-09-15T09:05:00.000Z',
          branch: 'فرع الشامي',
          sellerName: 'د هبة',
          customerCode: 'C1',
          customerName: 'Customer',
          amount,
          score: 95,
          confidence: 0.96,
          reasons: ['test'],
          matchedIdentityStrategies: ['customer_id'],
        }
      : null,
    candidates: [],
    verificationConfidence: status === 'verified' ? 0.96 : 0.75,
    revenue: amount,
    reason: status === 'verified' ? 'تطابق فاتورة قوي' : 'لم توجد فاتورة مرتبطة بقوة كافية.',
    warnings: [],
  };
}

const COMPLETE_SALE = `[9/15/26, 9:00:00 AM] Customer: صباح الخير، عايز فيتامين د
[9/15/26, 9:01:00 AM] You: صباح النور، مع حضرتك د هبة من صيدليات دواء، تحت أمر حضرتك
[9/15/26, 9:02:00 AM] You: متوفر بسعر 250 جنيه، تحب نضيفه على الأوردر؟
[9/15/26, 9:03:00 AM] Customer: تمام ابعته عدد 1، العنوان المحلة شارع البحر، رقمي 01012345678
[9/15/26, 9:04:00 AM] You: تم تأكيد الطلب، هيوصل خلال 30 دقيقة. لو في أي حاجة تانية إحنا تحت أمر حضرتك في أي وقت`;

const ACCEPTED_NOT_VERIFIED = `[9/15/26, 9:00:00 AM] Customer: عايز شامبو للشعر
[9/15/26, 9:01:00 AM] You: موجود
[9/15/26, 9:02:00 AM] Customer: تمام ابعته`;

describe('SmartConversationEvaluationV2', () => {
  it('distinguishes a verified sale from chat acceptance and keeps evidence coverage separate from quality score', () => {
    const session = oneSession(COMPLETE_SALE);
    const result = buildSmartConversationEvaluationV2(session, {
      invoiceVerification: invoice('verified', 250),
      salesOpportunities: [{ handling: 'handled_well', triggerMessageId: session.messages[0].id, reason: 'converted' }],
      consultationCommunication: 'not_applicable',
    });
    expect(result.sale.outcome).toBe('invoice_verified_sale');
    expect(result.sale.invoiceNumber).toBe('12345');
    expect(result.sale.revenue).toBe(250);
    expect(result.qualityScore).not.toBeNull();
    expect(result.evidenceCoverage).toBeGreaterThan(0);
    expect(result.scoreDisplayLabel).toContain('جودة');
  });

  it('does not call customer acceptance a completed sale when no invoice or execution evidence exists', () => {
    const result = buildSmartConversationEvaluationV2(oneSession(ACCEPTED_NOT_VERIFIED), {
      invoiceVerification: invoice('not_found'),
      salesOpportunities: [{ handling: 'partial', reason: 'customer accepted' }],
      consultationCommunication: 'not_applicable',
    });
    expect(result.sale.outcome).toBe('customer_accepted');
    expect(result.warnings.join(' ')).toContain('لا تعني بيعًا مكتملًا');
  });

  it('scores opening from its required elements instead of any greeting keyword alone', () => {
    const complete = buildSmartConversationEvaluationV2(oneSession(COMPLETE_SALE), {
      invoiceVerification: invoice('verified', 250),
      salesOpportunities: [],
      consultationCommunication: 'not_applicable',
    });
    const weak = buildSmartConversationEvaluationV2(oneSession(ACCEPTED_NOT_VERIFIED), {
      invoiceVerification: invoice('not_found'),
      salesOpportunities: [],
      consultationCommunication: 'not_applicable',
    });
    expect(complete.opening.score).toBeGreaterThan(weak.opening.score || 0);
    expect(complete.opening.missing).toHaveLength(0);
    expect(weak.opening.missing.length).toBeGreaterThan(0);
  });

  it('builds an order-completeness checklist and detects missing critical fields', () => {
    const complete = buildSmartConversationEvaluationV2(oneSession(COMPLETE_SALE), {
      invoiceVerification: invoice('verified', 250),
      salesOpportunities: [],
      consultationCommunication: 'not_applicable',
    });
    const incomplete = buildSmartConversationEvaluationV2(oneSession(ACCEPTED_NOT_VERIFIED), {
      invoiceVerification: invoice('not_found'),
      salesOpportunities: [],
      consultationCommunication: 'not_applicable',
    });
    expect(complete.orderCompleteness.applicable).toBe(true);
    expect(complete.orderCompleteness.confirmedCount).toBeGreaterThan(incomplete.orderCompleteness.confirmedCount);
    expect(incomplete.orderCompleteness.missingCritical.length).toBeGreaterThan(0);
  });

  it('scores proactive order-delay apology as service recovery without inventing a new sale journey', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] You: أهلاً بحضرتك، مع حضرتك نور من خدمة عملاء صيدليات دواء. بنعتذر عن التأخير اللي حصل في طلب حضرتك، وبنتابع مع الفريق المختص علشان يتم التوصيل في أسرع وقت ممكن ونطمن حضرتك على وصوله
[9/15/26, 9:03:00 AM] Customer: تمام شكراً`);
    const result = buildSmartConversationEvaluationV2(session, {
      invoiceVerification: invoice('not_found'),
      salesOpportunities: [],
      consultationCommunication: 'not_applicable',
    });
    expect(result.sale.outcome).toBe('not_applicable');
    expect(result.serviceRecovery.detected).toBe(true);
    expect(result.serviceRecovery.issueType).toBe('order_delay');
    expect(result.serviceRecovery.score).toBeGreaterThanOrEqual(65);
    expect(result.axes.find((axis) => axis.key === 'fulfillment')?.score).not.toBeNull();
    expect(result.followups.some((item) => item.type === 'delivery_confirmation')).toBe(true);
  });

  it('extracts multiple follow-up opportunities without auto-saving any action', () => {
    const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: عندي حموضة وعايز المنتج بس مش موجود عندكم؟
[9/15/26, 9:01:00 AM] You: مع حضرتك د هبة، الصنف ناقص وهطلبه لحضرتك وأبلغك أول ما يتوفر`);
    const result = buildSmartConversationEvaluationV2(session, {
      invoiceVerification: invoice('not_found'),
      purchaseHistory: { totalPurchases: 4, totalSpent: 1200, avgMonthly: 300, lastPurchaseAt: '2026-08-20' },
      salesOpportunities: [{ handling: 'needs_review', triggerMessageId: session.messages[0].id, reason: 'stockout' }],
      consultationCommunication: 'needs_review',
    });
    expect(result.followups.some((x) => x.type === 'stockout_recovery')).toBe(true);
    expect(result.followups.some((x) => x.type === 'clinical_checkin')).toBe(true);
  });

  // Golden Case: Saved Sale (stockout -> alternative offered -> explicit customer
  // acceptance -> order confirmed/invoice verified). ما لقيناش حالة حقيقية مؤكدة
  // في قاعدة البيانات لحد دلوقتي، فده Fixture اصطناعي واضح لتثبيت السلوك المطلوب:
  // الثلاثة شروط لازم تتحقق مع بعض، وأي شرط ناقص = صفر Saved Sale.
  describe('Golden Case: Saved Sale requires stockout + alternative offered + explicit acceptance together', () => {
    const STOCKOUT_ALT_ACCEPTED = `[9/15/26, 9:00:00 AM] Customer: عايز بانادول اكسترا
[9/15/26, 9:01:00 AM] You: للأسف الصنف مش موجود حاليًا، ممكن نرشح لحضرتك بديل بنفس المادة الفعالة
[9/15/26, 9:02:00 AM] Customer: تمام ابعته
[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب وهيتم التوصيل`;

    it('marks the sale as rescued by an alternative when stockout + alternative + explicit acceptance all hold', () => {
      const session = oneSession(STOCKOUT_ALT_ACCEPTED);
      const result = buildSmartConversationEvaluationV2(session, {
        invoiceVerification: invoice('verified', 180),
        salesOpportunities: [{ handling: 'handled_well', triggerMessageId: session.messages[0].id, reason: 'stockout rescued by alternative' }],
        consultationCommunication: 'not_applicable',
      });
      expect(result.sale.outcome).toBe('invoice_verified_sale');
      expect(result.opportunities.rescuedByAlternative).toBe(1);
    });

    it('does NOT mark a saved sale when no stockout was ever detected (bare cross-sell suggestion)', () => {
      const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: عايز بانادول اكسترا
[9/15/26, 9:01:00 AM] You: متوفر، وممكن نرشح لحضرتك فيتامين سي معاه
[9/15/26, 9:02:00 AM] Customer: تمام ابعته
[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب وهيتم التوصيل`);
      const result = buildSmartConversationEvaluationV2(session, {
        invoiceVerification: invoice('verified', 180),
        salesOpportunities: [],
        consultationCommunication: 'not_applicable',
      });
      expect(result.opportunities.rescuedByAlternative).toBe(0);
    });

    it('does NOT mark a saved sale when a stockout is detected but no alternative was ever offered', () => {
      const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: عايز بانادول اكسترا
[9/15/26, 9:01:00 AM] You: للأسف الصنف مش موجود حاليًا، هنحاول نوفره لحضرتك
[9/15/26, 9:02:00 AM] Customer: تمام هستنى`);
      const result = buildSmartConversationEvaluationV2(session, {
        invoiceVerification: invoice('not_found'),
        salesOpportunities: [],
        consultationCommunication: 'not_applicable',
      });
      expect(result.opportunities.rescuedByAlternative).toBe(0);
    });

    it('does NOT mark a saved sale when stockout + alternative both exist but the customer never explicitly accepted it', () => {
      const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: عايز بانادول اكسترا
[9/15/26, 9:01:00 AM] You: للأسف الصنف مش موجود حاليًا، ممكن نرشح لحضرتك بديل بنفس المادة الفعالة
[9/15/26, 9:02:00 AM] Customer: هفكر وارجعلك
[9/15/26, 9:03:00 AM] You: تحت أمر حضرتك في أي وقت`);
      const result = buildSmartConversationEvaluationV2(session, {
        invoiceVerification: invoice('not_found'),
        salesOpportunities: [],
        consultationCommunication: 'not_applicable',
      });
      expect(result.opportunities.rescuedByAlternative).toBe(0);
    });

    it('does NOT mark a saved sale when the customer explicitly declines the alternative', () => {
      const session = oneSession(`[9/15/26, 9:00:00 AM] Customer: عايز بانادول اكسترا
[9/15/26, 9:01:00 AM] You: للأسف الصنف مش موجود حاليًا، ممكن نرشح لحضرتك بديل بنفس المادة الفعالة
[9/15/26, 9:02:00 AM] Customer: لا شكرا مش عايز بديل`);
      const result = buildSmartConversationEvaluationV2(session, {
        invoiceVerification: invoice('not_found'),
        salesOpportunities: [],
        consultationCommunication: 'not_applicable',
      });
      expect(result.opportunities.rescuedByAlternative).toBe(0);
    });
  });
});
