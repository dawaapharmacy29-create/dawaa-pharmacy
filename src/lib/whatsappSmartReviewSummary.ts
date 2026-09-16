import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import { extractConversationSignals } from './whatsappConversationSignals';

export type SmartPrimaryType = 'customer_service_followup' | 'customer_request' | 'pharmacy_consultation' | 'complaint' | 'mixed' | 'general';
export type SmartOutcome = 'sale_intent' | 'closed_no_sale' | 'needs_followup' | 'open' | 'resolved';

export interface SmartConversationReviewSummary {
  primaryType: SmartPrimaryType;
  primaryTypeLabel: string;
  journey: string[];
  finalIntent: string;
  outcome: SmartOutcome;
  outcomeLabel: string;
  lastOwner: string | null;
  doctors: string[];
  startedAt: Date;
  endedAt: Date;
  messageCount: number;
  firstResponseSeconds: number | null;
  longestWaitSeconds: number | null;
  unansweredInboundCount: number;
  lastMeaningfulMessage: WhatsAppParsedMessage | null;
  flags: string[];
  confidence: number;
}

const CUSTOMER_SERVICE_RX = /(خدمة العملاء|حبيت اطمن|حابين نطمن|متابعة|اطمن على حضرتك|رأيك يهمنا)/i;
const REQUEST_RX = /(موجود|متوفر|عايز|عاوز|محتاج|ابعت|ابعث|اوردر|أوردر|طلب|روشته|روشتة|سعر|بكام|احجز)/i;
const CONSULT_RX = /(جرعة|اعراض|أعراض|حرارة|كحة|ضغط|سكر|دواء|علاج|حامل|رضاعة|طفل|سن كام|الوزن|حساسية)/i;
const COMPLAINT_RX = /(شكوى|مشكلة|متأخر|تأخير|زعلان|مش راضي|سيئة|وحش|ملاحظة على الخدمة)/i;
const FOLLOWUP_RX = /(اطمن|متابعة|بقى احسن|بقت احسن|تحسن|اخبار حضرتك|أخبار حضرتك)/i;
const NO_SALE_RX = /(مش متوفر|غير متوفر|غير متاح|مش موجود|مش هنقدر|لا يمكن|مش بيتصرف|من الجدول)/i;
const CLOSE_RX = /(تحت أمر حضرتك|تحت امر حضرتك|في أي وقت|فى أى وقت|شكرا لحضرتك|شكرًا لحضرتك|العفو)/i;

function joined(session: WhatsAppConversationSession) {
  return session.messages.map((message) => message.text).join('\n');
}

function lastMeaningful(messages: WhatsAppParsedMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const text = String(message.text || '').trim();
    if (!text) continue;
    if (message.direction === 'system') continue;
    if (CLOSE_RX.test(text) && text.length < 120) continue;
    return message;
  }
  return messages.at(-1) || null;
}

export function buildSmartConversationReviewSummary(session: WhatsAppConversationSession): SmartConversationReviewSummary {
  const text = joined(session);
  const signals = extractConversationSignals(session);
  const journey: string[] = [];
  const hasCustomerService = CUSTOMER_SERVICE_RX.test(text) || FOLLOWUP_RX.test(text);
  const hasRequest = REQUEST_RX.test(text);
  const hasConsultation = CONSULT_RX.test(text);
  const hasComplaint = COMPLAINT_RX.test(text) || Boolean(signals.complaintOrEscalationDetected);

  if (hasCustomerService) journey.push('متابعة خدمة عملاء');
  if (hasConsultation) journey.push('استشارة صيدلية');
  if (hasRequest) journey.push('طلب/استفسار عن صنف');
  if (hasComplaint) journey.push('شكوى/ملاحظة خدمة');
  if (!journey.length) journey.push('تواصل عام');

  let primaryType: SmartPrimaryType = 'general';
  let primaryTypeLabel = 'تواصل عام';
  if (hasComplaint) { primaryType = 'complaint'; primaryTypeLabel = 'شكوى / ملاحظة خدمة'; }
  else if (hasCustomerService && (hasRequest || hasConsultation)) { primaryType = 'mixed'; primaryTypeLabel = 'محادثة متعددة المراحل'; }
  else if (hasCustomerService) { primaryType = 'customer_service_followup'; primaryTypeLabel = 'متابعة خدمة عملاء'; }
  else if (hasRequest) { primaryType = 'customer_request'; primaryTypeLabel = 'طلب عميل'; }
  else if (hasConsultation) { primaryType = 'pharmacy_consultation'; primaryTypeLabel = 'استشارة صيدلية'; }

  const last = lastMeaningful(session.messages);
  const lastText = last?.text || '';
  let finalIntent = 'غير محدد — يحتاج مراجعة';
  if (REQUEST_RX.test(lastText) || hasRequest) finalIntent = 'طلب/استفسار عن صنف أو توفره';
  else if (FOLLOWUP_RX.test(lastText) || hasCustomerService) finalIntent = 'متابعة واطمئنان';
  else if (hasConsultation) finalIntent = 'استشارة صيدلية';
  else if (hasComplaint) finalIntent = 'حل شكوى أو ملاحظة';

  let outcome: SmartOutcome = 'open';
  let outcomeLabel = 'مفتوحة / غير محسومة';
  if (NO_SALE_RX.test(text)) { outcome = 'closed_no_sale'; outcomeLabel = 'لم يتم البيع / الصنف غير متاح أو تعذر الصرف'; }
  else if (Boolean(signals.saleIntentDetected)) { outcome = 'sale_intent'; outcomeLabel = 'نية شراء موجودة — تحتاج تحقق فاتورة'; }
  else if (Boolean(signals.followupPromiseDetected)) { outcome = 'needs_followup'; outcomeLabel = 'تحتاج متابعة'; }
  else if (Boolean(signals.closingDetected)) { outcome = 'resolved'; outcomeLabel = 'مغلقة نصيًا — بدون إثبات بيع'; }

  const flags: string[] = [];
  if ((signals.waitsOver10Minutes || 0) > 0) flags.push('تأخير رد أكثر من 10 دقائق');
  if ((signals.unansweredInboundCount || 0) > 0) flags.push('رسائل عميل بلا رد');
  if (hasComplaint) flags.push('شكوى/تصعيد محتمل');
  if (session.missingMediaCount) flags.push('ميديا ناقصة أو غير مفهومة');
  if (!session.outboundStaffNames.length) flags.push('مسؤول المحادثة غير مؤكد');

  const evidenceSignals = [hasCustomerService, hasRequest, hasConsultation, hasComplaint, Boolean(last)].filter(Boolean).length;
  const confidence = Math.max(45, Math.min(96, 55 + evidenceSignals * 8 - flags.length * 3));

  return {
    primaryType,
    primaryTypeLabel,
    journey,
    finalIntent,
    outcome,
    outcomeLabel,
    lastOwner: session.outboundStaffNames.at(-1) || null,
    doctors: session.outboundStaffNames,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    messageCount: session.messages.length,
    firstResponseSeconds: signals.firstResponseSeconds ?? null,
    longestWaitSeconds: signals.longestCustomerWaitSeconds ?? null,
    unansweredInboundCount: signals.unansweredInboundCount ?? 0,
    lastMeaningfulMessage: last,
    flags,
    confidence,
  };
}
