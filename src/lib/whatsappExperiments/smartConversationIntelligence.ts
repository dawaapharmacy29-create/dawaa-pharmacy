// طبقة تحليل "ذكية" إضافية لصفحات تجارب مقارنة واتساب فقط — قراءة فقط، بدون أي كتابة.
// بتعيد استخدام المحركات المعتمدة الموجودة بدل ما تبني محرك موازي جديد:
//  - تصنيف نوع المحادثة (initiator/primaryIntent): whatsappOperationalIntelligenceV6
//  - تحديد هوية العميل + الفرع: whatsappCustomerResolverV4 (نفس المحرك اللي بيستخدم customerSearch.ts)
//  - تحديد دور كل رسالة (عميل/خدمة عملاء/صيدلي...): whatsappParticipantRoleResolverV15
//  - التحقق الفعلي من البيع بمطابقة الفاتورة: whatsappUnifiedIntelligenceV4 (verifySessionAgainstInvoices
//    -> readCustomerInvoices، الـ boundary المعتمد في docs/ARCHITECTURE_TARGET.md)
// الجديد الوحيد هنا هو: (أ) تجميع مجهود كل موظف خدمة عملاء على مستوى الرسائل داخل الجلسة،
// و(ب) تمكين "أفضل الرسائل" عن طريق تعليم كل رسالة صادرة هل اترد عليها ولا لأ.
import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { resolveWhatsAppParticipantRolesV15, type WhatsAppParticipantRoleModelV15 } from '@/lib/whatsappParticipantRoleResolverV15';
import { resolveWhatsAppCustomerIdentity, type WhatsAppResolvedCustomer } from '@/lib/whatsappCustomerResolverV4';
import {
  buildUnifiedConversationIntelligence,
  verifySessionAgainstInvoices,
  type UnifiedInvoiceVerification,
} from '@/lib/whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6, type WhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';

export interface StaffMessageEffort {
  staffName: string;
  staffId: string | null;
  outboundMessages: number;
  repliedMessages: number;
  replyRatePct: number;
}

export interface BestMessageCandidate {
  messageId: string;
  text: string;
  staffName: string | null;
  gotReply: boolean;
  replyLatencySeconds: number | null;
}

export interface CustomerPurchaseHistory {
  totalPurchases: number | null;
  totalSpent: number | null;
  lastPurchaseAt: string | null;
  avgMonthly: number | null;
  fetchError: string | null;
}

export interface SmartConversationIntelligenceResult {
  conversationTypeLabel: string;
  primaryIntent: string;
  initiator: string;
  operationalOutcome: string;
  customer: WhatsAppResolvedCustomer;
  purchaseHistory: CustomerPurchaseHistory | null;
  invoiceVerification: UnifiedInvoiceVerification;
  staffEffort: StaffMessageEffort[];
  messageEffectiveness: BestMessageCandidate[];
}

function conversationTypeLabel(op: WhatsAppOperationalIntelligenceV6): string {
  if (op.primaryIntent === 'proactive_checkin') return 'خدمة عملاء بادرت بالتواصل (متابعة)';
  if (op.primaryIntent === 'followup_response') return 'العميل رد على متابعة وأكمل الطلب';
  if (op.initiator === 'customer') return 'العميل بدأ المحادثة وطلب مباشرة';
  return `${op.primaryIntent} (${op.initiator})`;
}

// "الرد" هنا = أي رسالة واردة من العميل ظهرت بعد رسالة الموظف الصادرة، قبل أي رسالة صادرة
// تالية (أو نهاية الجلسة). ده التعريف العملي المتاح فعليًا من تصدير واتساب النصي، لأن
// ملفات .txt/.md مفيهاش بيانات "reaction"/emoji tapback خالص — واتساب نفسه ما بيصدّرهاش.
async function computeStaffEffortAndMessageEffectiveness(
  session: WhatsAppConversationSession,
  roles: WhatsAppParticipantRoleModelV15
): Promise<{ staffEffort: StaffMessageEffort[]; messageEffectiveness: BestMessageCandidate[] }> {
  const roleByMessageId = new Map(roles.messages.map((m) => [m.messageId, m]));
  const messages = session.messages;
  const effortByStaff = new Map<string, StaffMessageEffort>();
  const messageEffectiveness: BestMessageCandidate[] = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message.direction !== 'outbound') continue;
    const roleInfo = roleByMessageId.get(message.id);
    if (!roleInfo || roleInfo.role === 'customer' || roleInfo.role === 'system') continue;

    let gotReply = false;
    let replyLatencySeconds: number | null = null;
    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j];
      if (next.direction === 'outbound') break;
      if (next.direction === 'inbound') {
        gotReply = true;
        replyLatencySeconds = Math.max(0, Math.round((next.timestamp.getTime() - message.timestamp.getTime()) / 1000));
        break;
      }
    }

    const staffName = roleInfo.staffName || roleInfo.sender || 'غير محدد';
    const key = roleInfo.staffId || staffName;
    const existing = effortByStaff.get(key) || {
      staffName,
      staffId: roleInfo.staffId,
      outboundMessages: 0,
      repliedMessages: 0,
      replyRatePct: 0,
    };
    existing.outboundMessages += 1;
    if (gotReply) existing.repliedMessages += 1;
    effortByStaff.set(key, existing);

    messageEffectiveness.push({
      messageId: message.id,
      text: message.text,
      staffName: roleInfo.staffName,
      gotReply,
      replyLatencySeconds,
    });
  }

  const staffEffort = [...effortByStaff.values()].map((entry) => ({
    ...entry,
    replyRatePct: entry.outboundMessages ? Math.round((entry.repliedMessages / entry.outboundMessages) * 1000) / 10 : 0,
  }));

  return { staffEffort, messageEffectiveness };
}

async function fetchPurchaseHistory(customerId: string): Promise<CustomerPurchaseHistory> {
  const { data, error } = await supabase
    .from('customers')
    .select('total_purchases,total_spent,avg_monthly,last_purchase')
    .eq('id', customerId)
    .maybeSingle();
  if (error) {
    return { totalPurchases: null, totalSpent: null, lastPurchaseAt: null, avgMonthly: null, fetchError: error.message };
  }
  return {
    totalPurchases: data?.total_purchases ?? null,
    totalSpent: data?.total_spent ?? null,
    lastPurchaseAt: data?.last_purchase ?? null,
    avgMonthly: data?.avg_monthly ?? null,
    fetchError: null,
  };
}

export async function analyzeSmartConversationIntelligence(
  session: WhatsAppConversationSession
): Promise<SmartConversationIntelligenceResult> {
  const base = buildUnifiedConversationIntelligence(session);
  const operational = buildWhatsAppOperationalIntelligenceV6(session, base);

  const [roles, customer] = await Promise.all([
    resolveWhatsAppParticipantRolesV15(session),
    resolveWhatsAppCustomerIdentity(session.customerName, null),
  ]);

  const [invoiceVerification, purchaseHistory, effort] = await Promise.all([
    verifySessionAgainstInvoices(session, {
      customerId: customer.customer?.id ?? null,
      customerCode: customer.customer?.code || null,
      customerPhone: customer.customer?.phone || null,
      customerName: customer.customer?.name || session.customerName,
      branch: customer.customer?.branch || null,
    }),
    customer.customer?.id ? fetchPurchaseHistory(customer.customer.id) : Promise.resolve(null),
    computeStaffEffortAndMessageEffectiveness(session, roles),
  ]);

  return {
    conversationTypeLabel: conversationTypeLabel(operational),
    primaryIntent: operational.primaryIntent,
    initiator: operational.initiator,
    operationalOutcome: operational.operationalOutcome,
    customer,
    purchaseHistory,
    invoiceVerification,
    staffEffort: effort.staffEffort,
    messageEffectiveness: effort.messageEffectiveness,
  };
}

// تجميع "أفضل الرسائل" عبر أكتر من تشغيلة/جلسة — بتجمع على نص الرسالة نفسه (بعد تقليم المسافات).
export interface BestMessageAggregate {
  text: string;
  sentCount: number;
  repliedCount: number;
  replyRatePct: number;
}

export function aggregateBestMessages(candidates: BestMessageCandidate[], minSent = 2): BestMessageAggregate[] {
  const byText = new Map<string, { sentCount: number; repliedCount: number }>();
  for (const c of candidates) {
    const key = c.text.trim();
    if (!key) continue;
    const existing = byText.get(key) || { sentCount: 0, repliedCount: 0 };
    existing.sentCount += 1;
    if (c.gotReply) existing.repliedCount += 1;
    byText.set(key, existing);
  }
  return [...byText.entries()]
    .map(([text, v]) => ({ text, sentCount: v.sentCount, repliedCount: v.repliedCount, replyRatePct: Math.round((v.repliedCount / v.sentCount) * 1000) / 10 }))
    .filter((x) => x.sentCount >= minSent)
    .sort((a, b) => b.replyRatePct - a.replyRatePct || b.sentCount - a.sentCount)
    .slice(0, 10);
}
