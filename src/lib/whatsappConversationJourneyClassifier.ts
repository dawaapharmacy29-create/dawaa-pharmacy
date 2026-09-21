// تصنيف "رحلة" المحادثة — طبقة مشتقة (pure) فوق whatsappOperationalIntelligenceV6 (V6) و
// whatsappUnifiedIntelligenceV4 (V4)، من غير ما تغيّر أي منطق تصنيف كانوني جواهم.
//
// المشكلة اللي الطبقة دي بتحلها: V6 بيختار primaryIntent واحد بالسكور الأعلى فقط
// (whatsappOperationalIntelligenceV6.ts:144-161)، فلو رسالة "بنطمن عليك" (proactive_checkin،
// سكور 96) موجودة مع طلب صنف بعد كده (customer_request، سكور 91)، الـprimaryIntent
// هيبقى proactive_checkin ويستحوذ على العرض — رغم إن V6 نفسه بيحفظ customer_request في
// secondaryIntents. إحنا هنا بنقرأ primaryIntent + secondaryIntents + evidence (V6) مع
// ordering حقيقي لمواقع الرسائل، من غير أي تكرار لـregex التصنيف نفسه.
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import type { UnifiedConversationIntelligence } from '@/lib/whatsappUnifiedIntelligenceV4';
import type { UnifiedInvoiceVerification } from '@/lib/whatsappUnifiedIntelligenceV4';
import type { WhatsAppOperationalIntelligenceV6 } from '@/lib/whatsappOperationalIntelligenceV6';

export type SaleState = 'chat_sale_signal' | 'probable_sale' | 'invoice_verified_sale' | 'no_verified_invoice';

export type ConversationJourneyType =
  | 'checkin_ack_only'
  | 'checkin_then_order'
  | 'checkin_then_consultation'
  | 'checkin_then_verified_sale'
  | 'service_recovery_outreach'
  | 'service_recovery_then_request'
  | 'service_recovery_then_verified_sale'
  | 'direct_customer_request'
  | 'other';

export interface ConversationJourneyResult {
  journeyType: ConversationJourneyType;
  journeyLabel: string;
  checkinDetected: boolean;
  requestAfterCheckin: boolean;
  consultationAfterCheckin: boolean;
  saleState: SaleState;
  saleStateLabel: string;
}

const JOURNEY_LABELS: Record<ConversationJourneyType, string> = {
  checkin_ack_only: 'خدمة عملاء بدأت متابعة والعميل رد فقط (اطمئنان بدون طلب)',
  checkin_then_order: 'خدمة عملاء بدأت متابعة، وبعدها العميل طلب صنف/كمّل أوردر',
  checkin_then_consultation: 'متابعة بدأت من الصيدلية ثم تحوّلت لاستشارة',
  checkin_then_verified_sale: 'متابعة بدأت من الصيدلية ثم تحوّلت لعملية بيع مؤكدة بالفاتورة',
  service_recovery_outreach: 'خدمة العملاء بدأت باعتذار/استعادة خدمة بسبب مشكلة أو تأخير سابق',
  service_recovery_then_request: 'اعتذار/استعادة خدمة ثم ظهر طلب جديد من العميل',
  service_recovery_then_verified_sale: 'اعتذار/استعادة خدمة ثم تحولت المحادثة لبيع مؤكد',
  direct_customer_request: 'العميل بدأ المحادثة بطلب مباشر',
  other: 'نوع محادثة غير محسوم',
};

const SERVICE_RECOVERY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|اسفين|آسفين|عن\s+التاخير|عن\s+التأخير|تاخير\s+(?:الطلب|الاوردر|الأوردر)|تأخير\s+(?:الطلب|الاوردر|الأوردر)|هنعوض|نعوض حضرتك|نتابع مع الفريق|هنتابع مع الفريق|وصول طلب حضرتك)/i;

const SALE_STATE_LABELS: Record<SaleState, string> = {
  chat_sale_signal: 'إشارة بيع من الشات فقط (غير مؤكدة)',
  probable_sale: 'بيع مرجّح (تطابق فاتورة غير قوي بما يكفي)',
  invoice_verified_sale: 'بيع مؤكد بمطابقة فاتورة فعلية',
  no_verified_invoice: 'لا يوجد بيع أو إشارة بيع',
};

export function mapSaleState(
  base: Pick<UnifiedConversationIntelligence, 'commercialEligible' | 'chatSuggestedSold'>,
  invoiceVerification: Pick<UnifiedInvoiceVerification, 'status'>
): SaleState {
  if (invoiceVerification.status === 'verified') return 'invoice_verified_sale';
  if (invoiceVerification.status === 'probable') return 'probable_sale';
  if (base.commercialEligible || base.chatSuggestedSold) return 'chat_sale_signal';
  return 'no_verified_invoice';
}

function messageIndexById(session: WhatsAppConversationSession, id: string) {
  return session.messages.findIndex((m) => m.id === id);
}

function firstIndex(session: WhatsAppConversationSession, ids: string[]) {
  const indices = ids.map((id) => messageIndexById(session, id)).filter((i) => i >= 0);
  return indices.length ? Math.min(...indices) : -1;
}

function anyAfter(session: WhatsAppConversationSession, ids: string[], afterIndex: number) {
  return ids.some((id) => {
    const idx = messageIndexById(session, id);
    return idx >= 0 && idx > afterIndex;
  });
}

export function classifyConversationJourney(
  session: WhatsAppConversationSession,
  operational: WhatsAppOperationalIntelligenceV6,
  base: UnifiedConversationIntelligence,
  invoiceVerification: UnifiedInvoiceVerification
): ConversationJourneyResult {
  const checkinIds = operational.evidence.checkin?.messageIds || [];
  const checkinDetected = checkinIds.length > 0;
  const firstCheckinIdx = firstIndex(session, checkinIds);

  const requestIds = operational.evidence.request?.messageIds || [];
  const hasRequestSignal =
    operational.primaryIntent === 'customer_request' ||
    operational.secondaryIntents.includes('customer_request') ||
    operational.customerRequests.length > 0 ||
    operational.products.some((p) => p.status === 'requested');
  const requestAfterCheckin = checkinDetected
    ? hasRequestSignal && (firstCheckinIdx < 0 || anyAfter(session, requestIds, firstCheckinIdx))
    : false;

  const hasConsultationSignal =
    operational.primaryIntent === 'medical_consultation' || operational.secondaryIntents.includes('medical_consultation');
  // مفيش evidence مستقلة لـmedical_consultation في V6 (evidence map بيغطي request/recommendation/
  // complaint/checkin/saleClose/customerState بس) — فبنعتمد على وجود الإشارة نفسها من V6 من غير
  // ترتيب دقيق للرسايل بدل ما نكرر regex التصنيف الطبي هنا.
  const consultationAfterCheckin = checkinDetected && hasConsultationSignal;

  const saleState = mapSaleState(base, invoiceVerification);
  const recoveryMessages = session.messages.filter(
    (message) => message.direction === 'outbound' && SERVICE_RECOVERY_RX.test(String(message.text || ''))
  );
  const recoveryDetected = recoveryMessages.length > 0;
  const firstRecoveryIdx = recoveryDetected
    ? Math.min(...recoveryMessages.map((message) => messageIndexById(session, message.id)).filter((index) => index >= 0))
    : -1;
  const requestAfterRecovery = recoveryDetected
    ? hasRequestSignal && (firstRecoveryIdx < 0 || anyAfter(session, requestIds, firstRecoveryIdx))
    : false;

  let journeyType: ConversationJourneyType;
  if (recoveryDetected && saleState === 'invoice_verified_sale') {
    journeyType = 'service_recovery_then_verified_sale';
  } else if (recoveryDetected && requestAfterRecovery) {
    journeyType = 'service_recovery_then_request';
  } else if (recoveryDetected) {
    journeyType = 'service_recovery_outreach';
  } else if (checkinDetected && saleState === 'invoice_verified_sale') {
    journeyType = 'checkin_then_verified_sale';
  } else if (checkinDetected && requestAfterCheckin) {
    journeyType = 'checkin_then_order';
  } else if (checkinDetected && consultationAfterCheckin) {
    journeyType = 'checkin_then_consultation';
  } else if (checkinDetected) {
    journeyType = 'checkin_ack_only';
  } else if (operational.initiator === 'customer') {
    journeyType = 'direct_customer_request';
  } else {
    journeyType = 'other';
  }

  return {
    journeyType,
    journeyLabel: JOURNEY_LABELS[journeyType],
    checkinDetected,
    requestAfterCheckin,
    consultationAfterCheckin,
    saleState,
    saleStateLabel: SALE_STATE_LABELS[saleState],
  };
}
