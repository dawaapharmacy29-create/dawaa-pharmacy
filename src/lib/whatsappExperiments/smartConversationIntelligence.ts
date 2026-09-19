// طبقة تحليل "ذكية" إضافية لصفحات تجارب مقارنة واتساب فقط — قراءة فقط، بدون أي كتابة.
// بتعيد استخدام المحركات المعتمدة الموجودة بدل ما تبني محرك موازي جديد:
//  - تصنيف نوع المحادثة الخام (initiator/primaryIntent): whatsappOperationalIntelligenceV6
//  - رحلة المحادثة الكاملة (journey-aware): conversationJourneyClassifier.ts (مشتقة من V6/V4،
//    مش بديلة لهم — راجع التعليق في أول الملف ده لتفاصيل المشكلة اللي بيحلها)
//  - تحديد هوية العميل + الفرع: whatsappCustomerResolverV4 (نفس المحرك اللي بيستخدم customerSearch.ts)
//  - تحديد دور كل رسالة (عميل/خدمة عملاء/صيدلي...) + فرع الموظف المطابق: whatsappParticipantRoleResolverV15
//  - التحقق الفعلي من البيع بمطابقة الفاتورة: whatsappUnifiedIntelligenceV4 (verifySessionAgainstInvoices
//    -> readCustomerInvoices، الـ boundary المعتمد في docs/ARCHITECTURE_TARGET.md)
// الجديد هنا: (أ) burst-aware مجهود كل موظف خدمة عملاء (outboundMessageBursts.ts)، و(ب) تطبيع
// قوالب الرسائل لـ"أفضل الرسائل" (messageTemplateNormalization.ts).
import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { resolveWhatsAppParticipantRolesV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { resolveWhatsAppCustomerIdentity, type WhatsAppResolvedCustomer } from '@/lib/whatsappCustomerResolverV4';
import {
  buildUnifiedConversationIntelligence,
  verifySessionAgainstInvoices,
  type UnifiedInvoiceVerification,
} from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';
import { resolveConversationBranchHint, type BranchHintResult } from '@/lib/whatsappConversationBranchHint';
import { classifyConversationJourney, type ConversationJourneyResult } from './conversationJourneyClassifier';
import { groupOutboundBursts, computeStaffBurstEffort, type StaffMessageEffort } from './outboundMessageBursts';
import { buildMessageTemplateKey, aggregateBestMessages, type BestMessageCandidate } from './messageTemplateNormalization';
import { buildSmartIntelligenceSnapshotV1, type SmartIntelligenceSnapshotV1 } from './smartIntelligenceSnapshot';

export type { StaffMessageEffort } from './outboundMessageBursts';
export type { BestMessageCandidate, BestMessageAggregate } from './messageTemplateNormalization';
export { aggregateBestMessages } from './messageTemplateNormalization';
export type { ConversationJourneyResult, ConversationJourneyType, SaleState } from './conversationJourneyClassifier';

export interface CustomerPurchaseHistory {
  totalPurchases: number | null;
  totalSpent: number | null;
  avgMonthly: number | null;
  lastPurchaseAt: string | null;
  fetchError: string | null;
}

export interface SmartConversationIntelligenceResult {
  sessionId: string;
  sessionStartedAt: string;
  customerName: string | null;
  journey: ConversationJourneyResult;
  primaryIntent: string;
  initiator: string;
  operationalOutcome: string;
  customer: WhatsAppResolvedCustomer;
  branchHint: string | null;
  branchHintSource: BranchHintResult['source'];
  branchHintReason: string;
  purchaseHistory: CustomerPurchaseHistory | null;
  invoiceVerification: UnifiedInvoiceVerification;
  staffEffort: StaffMessageEffort[];
  messageEffectiveness: BestMessageCandidate[];
  snapshot: SmartIntelligenceSnapshotV1;
}

async function fetchPurchaseHistory(customerId: string): Promise<CustomerPurchaseHistory> {
  const { data, error } = await supabase
    .from('customers')
    .select('total_purchases,total_spent,avg_monthly,last_purchase')
    .eq('id', customerId)
    .maybeSingle();
  if (error) {
    return { totalPurchases: null, totalSpent: null, avgMonthly: null, lastPurchaseAt: null, fetchError: error.message };
  }
  return {
    totalPurchases: data?.total_purchases ?? null,
    totalSpent: data?.total_spent ?? null,
    avgMonthly: data?.avg_monthly ?? null,
    lastPurchaseAt: data?.last_purchase ?? null,
    fetchError: null,
  };
}

export async function analyzeSmartConversationIntelligence(
  session: WhatsAppConversationSession,
  options?: { sourceBranch?: string | null }
): Promise<SmartConversationIntelligenceResult> {
  const base = buildUnifiedConversationIntelligence(session);
  const operational = buildWhatsAppOperationalIntelligenceV6(session, base);

  const roles = await resolveWhatsAppParticipantRolesV15(session);
  const branchHintResult = await resolveConversationBranchHint(session, roles, options?.sourceBranch ?? null);
  const branchHint = branchHintResult.value;
  const customer = await resolveWhatsAppCustomerIdentity(session.customerName, branchHint);

  const [invoiceVerification, purchaseHistory] = await Promise.all([
    verifySessionAgainstInvoices(session, {
      customerId: customer.customer?.id ?? null,
      customerCode: customer.customer?.code || null,
      customerPhone: customer.customer?.phone || null,
      customerName: customer.customer?.name || session.customerName,
      branch: customer.customer?.branch || branchHint,
    }),
    customer.customer?.id ? fetchPurchaseHistory(customer.customer.id) : Promise.resolve(null),
  ]);

  const journey = classifyConversationJourney(session, operational, base, invoiceVerification);

  const bursts = groupOutboundBursts(session, roles);
  const staffEffort = computeStaffBurstEffort(bursts);

  const roleByMessageId = new Map(roles.messages.map((m) => [m.messageId, m]));
  const messageEffectiveness: BestMessageCandidate[] = [];
  for (const burst of bursts) {
    // Credit the reply outcome to one representative message per burst (the last meaningful
    // outbound message), not every message in the burst. This avoids multiplying success credit.
    const representativeId = [...burst.messageIds].reverse().find((id) => {
      const message = session.messages.find((m) => m.id === id);
      return Boolean(message?.text?.trim());
    }) || burst.messageIds[burst.messageIds.length - 1];
    const message = session.messages.find((m) => m.id === representativeId);
    if (!message) continue;
    const roleInfo = roleByMessageId.get(representativeId);
    const { templateKey } = buildMessageTemplateKey(message.text, session.customerName);
    messageEffectiveness.push({
      messageId: representativeId,
      text: message.text,
      templateKey,
      staffName: roleInfo?.staffName || null,
      burstId: burst.burstId,
      gotReply: burst.gotReply,
      replyLatencySeconds: burst.replyLatencySeconds,
    });
  }

  const snapshot = buildSmartIntelligenceSnapshotV1({
    journey,
    staffEffort,
    invoiceVerification,
    customer,
    purchaseHistory: purchaseHistory
      ? {
          totalPurchases: purchaseHistory.totalPurchases,
          totalSpent: purchaseHistory.totalSpent,
          avgMonthly: purchaseHistory.avgMonthly,
          lastPurchaseAt: purchaseHistory.lastPurchaseAt,
        }
      : null,
    branchHint: branchHintResult,
    bestMessageSignals: aggregateBestMessages(messageEffectiveness, 1, 5),
  });

  return {
    sessionId: session.id,
    sessionStartedAt: session.startedAt.toISOString(),
    customerName: session.customerName,
    journey,
    primaryIntent: operational.primaryIntent,
    initiator: operational.initiator,
    operationalOutcome: operational.operationalOutcome,
    customer,
    branchHint,
    branchHintSource: branchHintResult.source,
    branchHintReason: branchHintResult.reason,
    purchaseHistory,
    invoiceVerification,
    staffEffort,
    messageEffectiveness,
    snapshot,
  };
}
