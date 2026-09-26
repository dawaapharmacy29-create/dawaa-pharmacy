import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { SmartDeepConversationAnalysis, SmartIntent } from './whatsappSmartConversationIntelligence';

const COMPLAINT_RX = /(شكوى|شكوي|متضايق|زعلان|تاخير|تأخير|مش راضي|مشكله|مشكلة|وحش|سيئ|رفض|محدش رد)/i;
const COMPLAINT_NEGATION_RX = /(مفيش|مافيش|ما فيش|مش|لا يوجد|ولا)\s+(?:اي\s+)?(?:مشكله|مشكلة|شكوى|شكوي)|(?:مشكله|مشكلة)\s*(?:مفيش|مافيش)/i;
const STRONG_CONSULT_RX = /(جرع[هة]|طريق[هة] الاستخدام|ازاي استخدم|استخدامه|اعراض|أعراض|كح[هة]|حرار[هة]|اسهال|إسهال|ترجيع|قيء|غثيان|مغص|الم|ألم|طفل|حامل|رضاع[هة]|تعبان|مفعول|ينفع|مناسب|بديل علاجي)/i;
const CONDITION_CONTEXT_RX = /(عندي|عنده|عندها|حاسس|حاسه|حاسة|بيعاني|تعاني|مريض)[^\n]{0,40}(حموض|ضغط|سكر)/i;
const PRODUCT_RX = /(محتاج|محتاجه|عايز|عايزه|عاوز|عاوزه|بكام|سعر|علب[هة]|شريط|سرنج|موجود|متاح)/i;
const AVAILABILITY_RX = /(متاح|موجود|ناقص|مش موجود|غير متوفر|مش متوفر|خلصان|متوفر)/i;
const ORDER_RX = /(ابعت|ابعته|ابعتهم|العنوان|الدليفري|المندوب|تم الارسال|تم الإرسال|تم تأكيد|هطلب|عايز واحد|محتاج واحد)/i;

function orderedInbound(session: WhatsAppConversationSession) {
  return session.messages
    .filter((message) => message.direction === 'inbound' && message.kind !== 'system' && message.kind !== 'deleted')
    .slice()
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function isComplaint(message: WhatsAppParsedMessage) {
  const text = String(message.text || '');
  return COMPLAINT_RX.test(text) && !COMPLAINT_NEGATION_RX.test(text);
}

function isStrongConsult(message: WhatsAppParsedMessage) {
  const text = String(message.text || '');
  return STRONG_CONSULT_RX.test(text) || CONDITION_CONTEXT_RX.test(text);
}

function firstCustomerIntent(session: WhatsAppConversationSession): SmartIntent {
  for (const message of orderedInbound(session)) {
    const text = String(message.text || '');
    if (isComplaint(message)) return 'complaint';
    if (isStrongConsult(message)) return 'consultation';
    if (PRODUCT_RX.test(text)) return 'product_request';
    if (AVAILABILITY_RX.test(text)) return 'availability_check';
    if (ORDER_RX.test(text)) return 'order';
  }
  return 'unknown';
}

export function refineSmartDeepConversationAnalysis(
  session: WhatsAppConversationSession,
  deep: SmartDeepConversationAnalysis,
): SmartDeepConversationAnalysis {
  const inbound = orderedInbound(session);
  const hasStrongConsult = inbound.some(isStrongConsult);
  const intentJourney = hasStrongConsult ? deep.intentJourney : deep.intentJourney.filter((intent) => intent !== 'consultation');
  const suggestedCriteria = hasStrongConsult
    ? deep.suggestedCriteria
    : deep.suggestedCriteria.filter((criterion) => criterion !== 'consultation_quality' && criterion !== 'dosage_explanation');

  const primaryIntent: SmartIntent = deep.entryOrigin === 'customer_service_outreach'
    ? 'service_followup'
    : firstCustomerIntent(session);

  return {
    ...deep,
    primaryIntent: primaryIntent === 'unknown' && deep.primaryIntent !== 'consultation' ? deep.primaryIntent : primaryIntent,
    intentJourney,
    consultationCommunication: hasStrongConsult ? deep.consultationCommunication : 'not_applicable',
    consultationEvidenceMessageIds: hasStrongConsult ? deep.consultationEvidenceMessageIds : [],
    suggestedCriteria,
  };
}
