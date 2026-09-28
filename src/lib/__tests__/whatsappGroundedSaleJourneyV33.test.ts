import { describe, expect, it } from 'vitest';
import { parseWhatsAppExport, splitWhatsAppSessions } from '@/lib/whatsappConversationParser';
import { buildUnifiedConversationIntelligence, type UnifiedInvoiceVerification } from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';
import { buildSmartConversationEvaluationV2 } from '@/lib/whatsappConversationEvaluationV2';
import { buildConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';
import { buildGroundedSaleJourneyV33 } from '@/lib/whatsappGroundedSaleJourneyV33';
import { buildConversationUnderstandingV32 } from '@/lib/whatsappConversationUnderstandingV32';
import type { WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';

function session(raw: string) {
  return splitWhatsAppSessions(parseWhatsAppExport(raw), 240)[0];
}

function noInvoice(): UnifiedInvoiceVerification {
  return {
    status: 'not_found',
    bestCandidate: null,
    candidates: [],
    verificationConfidence: 0.75,
    revenue: null,
    reason: 'لا توجد فاتورة',
    warnings: [],
  };
}

function rolesFor(
  s: ReturnType<typeof session>,
  ownerByText: Array<{ text: RegExp; staffName: string }>
): WhatsAppParticipantRoleModelV15 {
  const messages = s.messages.map((message) => {
    if (message.direction === 'inbound') {
      return {
        messageId: message.id,
        sender: message.sender,
        role: 'customer' as const,
        accountId: null,
        staffId: null,
        staffName: null,
        branch: null,
        confidence: 98,
        reason: 'test customer',
      };
    }
    const owner = ownerByText.find((row) => row.text.test(message.text));
    return {
      messageId: message.id,
      sender: message.sender,
      role: 'pharmacist' as const,
      accountId: owner ? `acc-${owner.staffName}` : 'acc-hiba',
      staffId: owner ? `staff-${owner.staffName}` : 'staff-hiba',
      staffName: owner?.staffName || 'هبة',
      branch: 'فرع الشامي',
      confidence: 99,
      reason: 'test resolved staff',
    };
  });
  const staff = Array.from(new Set(messages.map((row) => row.staffName).filter(Boolean))).map((staffName) => ({
    accountId: `acc-${staffName}`,
    staffId: `staff-${staffName}`,
    staffName: String(staffName),
    role: 'pharmacist' as const,
    branch: 'فرع الشامي',
    confidence: 99,
  }));
  return { version: 'whatsapp-participant-role-v15', messages, staff };
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

    expect(journey.outcome).toBe('invoice_candidate_strong');
    expect(journey.truthQuality.invoiceCandidateStrong).toBe(true);
    expect(journey.saleWindow.startMessageId).toBe(s.messages.find((m) => /عايز فيتامين/.test(m.text))?.id);
    expect(journey.saleWindow.startedAt).toContain('09:02');
    expect(journey.stages.find((stage) => stage.key === 'order_confirmation')?.detected).toBe(true);
  });

  it('ends the chat sale window at explicit confirmation, never at a statistical invoice timestamp', () => {
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
    expect(journey.saleWindow.endedAt).toContain('09:04');
    expect(journey.saleWindow.endSource).toBe('message');
    expect(complaintId).toBeTruthy();
    expect(journey.saleWindow.messageIds).not.toContain(complaintId);
    expect(journey.customerJourneyWindow.messageIds).toContain(complaintId);
    expect(journey.complaintMessageIds).toContain(complaintId);
    expect(journey.coaching.complaintPoints.length).toBeGreaterThan(0);
  });

  it('counts explicit doctor item review as real order confirmation', () => {
    const s = session(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر يا فندم
[9/15/26, 9:02:00 AM] You: حضرتك كده معانا فيتامين د عدد 1 تمام؟
[9/15/26, 9:02:30 AM] Customer: تمام
[9/15/26, 9:03:00 AM] You: جاري الارسال`);
    const invoice = noInvoice();
    const roles = rolesFor(s, [{ text: /.*/, staffName: 'هبة' }]);
    const operational = buildWhatsAppOperationalIntelligenceV6(s, buildUnifiedConversationIntelligence(s));
    const evaluation = buildSmartConversationEvaluationV2(s, { invoiceVerification: invoice });
    const timing = buildConversationTimingV28(s, roles, invoice);
    const understanding = buildConversationUnderstandingV32(s);
    const journey = buildGroundedSaleJourneyV33({
      session: s,
      operational,
      invoiceVerification: invoice,
      evaluation,
      timing,
      participantRoles: roles,
      understanding,
    });

    const stage = journey.stages.find((row) => row.key === 'order_confirmation');
    const coach = journey.staffCoaching.find((row) => row.staffName === 'هبة');
    expect(stage?.detected).toBe(true);
    expect(stage?.evidenceMessageIds.some((id) => s.messages.find((m) => m.id === id)?.text.includes('حضرتك كده معانا'))).toBe(true);
    expect(coach?.confirmationCount).toBeGreaterThan(0);
  });

  it('does not count order registration or dispatch as item confirmation', () => {
    const s = session(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر يا فندم
[9/15/26, 9:02:00 AM] Customer: تمام ابعته
[9/15/26, 9:03:00 AM] You: تم تأكيد الطلب
[9/15/26, 9:04:00 AM] You: جاري الارسال`);
    const invoice = noInvoice();
    const roles = rolesFor(s, [{ text: /.*/, staffName: 'هبة' }]);
    const operational = buildWhatsAppOperationalIntelligenceV6(s, buildUnifiedConversationIntelligence(s));
    const evaluation = buildSmartConversationEvaluationV2(s, { invoiceVerification: invoice });
    const timing = buildConversationTimingV28(s, roles, invoice);
    const understanding = buildConversationUnderstandingV32(s);
    const journey = buildGroundedSaleJourneyV33({
      session: s,
      operational,
      invoiceVerification: invoice,
      evaluation,
      timing,
      participantRoles: roles,
      understanding,
    });

    const stage = journey.stages.find((row) => row.key === 'order_confirmation');
    const coach = journey.staffCoaching.find((row) => row.staffName === 'هبة');
    expect(stage?.detected).toBe(false);
    expect(coach?.confirmationCount).toBe(0);
    expect(coach?.findings.some((finding) => finding.type === 'order_confirmation' && finding.tone === 'strong')).toBe(false);
  });

  it('keeps customer acceptance separate from doctor item confirmation', () => {
    const s = session(`[9/15/26, 9:00:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:01:00 AM] You: متوفر يا فندم
[9/15/26, 9:02:00 AM] Customer: تمام
[9/15/26, 9:03:00 AM] You: جاري الارسال`);
    const invoice = noInvoice();
    const roles = rolesFor(s, [{ text: /.*/, staffName: 'هبة' }]);
    const operational = buildWhatsAppOperationalIntelligenceV6(s, buildUnifiedConversationIntelligence(s));
    const evaluation = buildSmartConversationEvaluationV2(s, { invoiceVerification: invoice });
    const timing = buildConversationTimingV28(s, roles, invoice);
    const understanding = buildConversationUnderstandingV32(s);
    const journey = buildGroundedSaleJourneyV33({
      session: s,
      operational,
      invoiceVerification: invoice,
      evaluation,
      timing,
      participantRoles: roles,
      understanding,
    });

    expect(journey.stages.find((row) => row.key === 'customer_acceptance')?.detected).toBe(true);
    expect(journey.stages.find((row) => row.key === 'order_confirmation')?.detected).toBe(false);
  });

  it('attributes official welcome and closing only to the staff who owns those edge messages', () => {
    const s = session(`[9/15/26, 9:00:00 AM] Customer: السلام عليكم
[9/15/26, 9:00:30 AM] You: أهلًا وسهلًا بحضرتك نورتنا في صيدليات دواء مع حضرتك د هبة
[9/15/26, 9:01:00 AM] Customer: عايز فيتامين د
[9/15/26, 9:02:00 AM] You: متوفر يا فندم
[9/15/26, 9:03:00 AM] Customer: تمام ابعته
[9/15/26, 9:04:00 AM] You: جاري الارسال نتشرف بخدمة حضرتك ٢٤ ساعة`);
    const invoice = noInvoice();
    const roles = rolesFor(s, [
      { text: /أهلًا وسهلًا/, staffName: 'هبة' },
      { text: /متوفر|جاري الارسال/, staffName: 'ندى' },
    ]);
    const operational = buildWhatsAppOperationalIntelligenceV6(s, buildUnifiedConversationIntelligence(s));
    const evaluation = buildSmartConversationEvaluationV2(s, {
      invoiceVerification: invoice,
      officialWelcomeTemplates: ['أهلًا وسهلًا بحضرتك نورتنا في صيدليات دواء مع حضرتك د هبة'],
      officialClosingTemplates: ['جاري الارسال نتشرف بخدمة حضرتك ٢٤ ساعة'],
    });
    const timing = buildConversationTimingV28(s, roles, invoice);
    const understanding = buildConversationUnderstandingV32(s);
    const journey = buildGroundedSaleJourneyV33({
      session: s,
      operational,
      invoiceVerification: invoice,
      evaluation,
      timing,
      participantRoles: roles,
      understanding,
    });

    const hiba = journey.staffCoaching.find((row) => row.staffName === 'هبة');
    const nada = journey.staffCoaching.find((row) => row.staffName === 'ندى');

    expect(hiba?.findings.some((finding) => finding.type === 'opening' && finding.title === 'ترحيب رسمي معتمد')).toBe(true);
    expect(hiba?.findings.some((finding) => finding.type === 'closing' && finding.title === 'ختام رسمي معتمد')).toBe(false);
    expect(nada?.findings.some((finding) => finding.type === 'closing' && finding.title === 'ختام رسمي معتمد')).toBe(true);
    expect(nada?.findings.some((finding) => finding.type === 'opening' && finding.tone === 'improvement')).toBe(false);
  });

  it('attributes a customer correction only to the staff message that was corrected', () => {
    const s = session(`[9/15/26, 9:00:00 AM] Customer: عايز جل للبشرة
[9/15/26, 9:01:00 AM] You: الكريم ده متوفر يا فندم
[9/15/26, 9:02:00 AM] Customer: لا قصدي الجل مش الكريم
[9/15/26, 9:03:00 AM] You: تمام فهمت حضرتك الجل، هراجع توفره`);
    const invoice = noInvoice();
    const roles = rolesFor(s, [
      { text: /الكريم ده متوفر/, staffName: 'هبة' },
      { text: /تمام فهمت/, staffName: 'ندى' },
    ]);
    const operational = buildWhatsAppOperationalIntelligenceV6(s, buildUnifiedConversationIntelligence(s));
    const evaluation = buildSmartConversationEvaluationV2(s, { invoiceVerification: invoice });
    const timing = buildConversationTimingV28(s, roles, invoice);
    const understanding = buildConversationUnderstandingV32(s);
    const journey = buildGroundedSaleJourneyV33({
      session: s,
      operational,
      invoiceVerification: invoice,
      evaluation,
      timing,
      participantRoles: roles,
      understanding,
    });

    const hiba = journey.staffCoaching.find((row) => row.staffName === 'هبة');
    const nada = journey.staffCoaching.find((row) => row.staffName === 'ندى');
    expect(hiba?.findings.some((finding) => finding.type === 'understanding_correction' && finding.tone === 'improvement')).toBe(true);
    expect(nada?.findings.some((finding) => finding.type === 'understanding_correction')).toBe(false);
  });

  it('scores complaint handling without claiming the doctor caused the complaint', () => {
    const s = session(`[9/15/26, 9:00:00 AM] Customer: الطلب لسه ماوصلش وفيه تأخير ومشكلة
[9/15/26, 9:02:00 AM] You: بنعتذر لحضرتك وهنتابع مع المندوب فورًا`);
    const invoice = noInvoice();
    const roles = rolesFor(s, [{ text: /بنعتذر/, staffName: 'هبة' }]);
    const operational = buildWhatsAppOperationalIntelligenceV6(s, buildUnifiedConversationIntelligence(s));
    const evaluation = buildSmartConversationEvaluationV2(s, { invoiceVerification: invoice });
    const timing = buildConversationTimingV28(s, roles, invoice);
    const understanding = buildConversationUnderstandingV32(s);
    const journey = buildGroundedSaleJourneyV33({
      session: s,
      operational,
      invoiceVerification: invoice,
      evaluation,
      timing,
      participantRoles: roles,
      understanding,
    });

    const finding = journey.staffCoaching
      .find((row) => row.staffName === 'هبة')
      ?.findings.find((row) => row.type === 'complaint_handling');
    expect(finding).toBeTruthy();
    expect(finding?.tone).toBe('strong');
    expect(finding?.detail).toContain('الشكوى نفسها لا تُنسب للموظف');
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
