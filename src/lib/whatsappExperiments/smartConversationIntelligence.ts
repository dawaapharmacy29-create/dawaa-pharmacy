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
import { classifyConversationJourney, type ConversationJourneyResult } from './conversationJourneyClassifier';
import { groupOutboundBursts, computeStaffBurstEffort, type StaffMessageEffort } from './outboundMessageBursts';
import { buildMessageTemplateKey, aggregateBestMessages, type BestMessageCandidate } from './messageTemplateNormalization';

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
  journey: ConversationJourneyResult;
  primaryIntent: string;
  initiator: string;
  operationalOutcome: string;
  customer: WhatsAppResolvedCustomer;
  branchHint: string | null;
  purchaseHistory: CustomerPurchaseHistory | null;
  invoiceVerification: UnifiedInvoiceVerification;
  staffEffort: StaffMessageEffort[];
  messageEffectiveness: BestMessageCandidate[];
}

function deriveBranchHint(roles: Awaited<ReturnType<typeof resolveWhatsAppParticipantRolesV15>>): string | null {
  const branches = roles.staff.map((s) => s.branch).filter((b): b is string => Boolean(b && b.trim()));
  if (!branches.length) return null;
  const counts = new Map<string, number>();
  for (const b of branches) counts.set(b, (counts.get(b) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
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
  session: WhatsAppConversationSession
): Promise<SmartConversationIntelligenceResult> {
  const base = buildUnifiedConversationIntelligence(session);
  const operational = buildWhatsAppOperationalIntelligenceV6(session, base);

  const roles = await resolveWhatsAppParticipantRolesV15(session);
  const branchHint = deriveBranchHint(roles);
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
    for (const messageId of burst.messageIds) {
      const message = session.messages.find((m) => m.id === messageId);
      if (!message) continue;
      const roleInfo = roleByMessageId.get(messageId);
      const { templateKey } = buildMessageTemplateKey(message.text, session.customerName);
      messageEffectiveness.push({
        messageId,
        text: message.text,
        templateKey,
        staffName: roleInfo?.staffName || null,
        burstId: burst.burstId,
        gotReply: burst.gotReply,
        replyLatencySeconds: burst.replyLatencySeconds,
      });
    }
  }

  return {
    journey,
    primaryIntent: operational.primaryIntent,
    initiator: operational.initiator,
    operationalOutcome: operational.operationalOutcome,
    customer,
    branchHint,
    purchaseHistory,
    invoiceVerification,
    staffEffort,
    messageEffectiveness,
  };
}
