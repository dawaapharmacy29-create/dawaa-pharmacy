import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import { extractSmartStaffIdentity } from './whatsappSmartReviewOwnership';

export type SmartEntryOrigin = 'customer_service_outreach' | 'customer_initiated' | 'unknown';
export type SmartIntent = 'service_followup' | 'product_request' | 'availability_check' | 'consultation' | 'complaint' | 'order' | 'unknown';
export type OpportunityHandling = 'handled_well' | 'partial' | 'missed' | 'needs_review' | 'not_applicable';
export type ConsultationCommunication = 'clear' | 'partial' | 'weak' | 'not_applicable';

export interface SmartSalesOpportunity {
  triggerMessageId: string;
  handling: OpportunityHandling;
  evidenceMessageIds: string[];
  reason: string;
}

export interface SmartUnavailableItemAnalysis {
  detected: boolean;
  evidenceMessageIds: string[];
  alternativeOffered: boolean;
  alternativeExplained: boolean;
  requestRegistered: boolean;
  customerToldRequestRegistered: boolean;
  suggestedCriteria: string[];
}

export interface SmartCustomerRequestCandidate {
  detected: boolean;
  productName: string | null;
  customerName: string | null;
  customerCode: string | null;
  customerPhone: string | null;
  quantity: string | null;
  concentration: string | null;
  evidenceMessageIds: string[];
  confidence: 'high' | 'medium' | 'low';
  needsConfirmation: boolean;
}

export interface SmartFollowupCandidate {
  detected: boolean;
  reason: 'illness' | 'recommendation' | 'service_issue' | 'explicit_promise' | null;
  evidenceMessageIds: string[];
  needsConfirmation: boolean;
}

export interface SmartDeepConversationAnalysis {
  entryOrigin: SmartEntryOrigin;
  primaryIntent: SmartIntent;
  intentJourney: SmartIntent[];
  confidence: number;
  humanReviewRequired: boolean;
  salesOpportunities: SmartSalesOpportunity[];
  consultationCommunication: ConsultationCommunication;
  consultationEvidenceMessageIds: string[];
  unavailableItem: SmartUnavailableItemAnalysis;
  customerRequest: SmartCustomerRequestCandidate;
  followup: SmartFollowupCandidate;
  suggestedCriteria: string[];
  evidenceMessageIds: string[];
}

const normalize = (value: unknown) => String(value || '')
  .trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '').replace(/\s+/g, ' ');

const SERVICE_FOLLOWUP_RX = /(خدم[هة]\s*عملاء|حابين نطمن|حبيت اطمن|مستوى الخدم[هة]|رضا حضرتك|رأيك في الخدم[هة]|اخر تجرب[هة]|آخر تجرب[هة])/i;
const PRODUCT_RX = /(محتاج|محتاجه|عايز|عايزه|متاح|موجود|بكام|سعر|عاوز|ابعت|ابعته|علب[هة]|شريط|سرنج|اوردر|أوردر)/i;
const AVAILABILITY_RX = /(متاح|موجود|ناقص|مش موجود|غير متوفر|مش متوفر|خلصان|متوفر)/i;
const CONSULT_RX = /(جرع[هة]|طريق[هة] الاستخدام|ازاي استخدم|استخدامه|اعراض|أعراض|كح[هة]|حرار[هة]|ضغط|سكر|حموض[هة]|اسهال|إسهال|ترجيع|قيء|طفل|حامل|رضاع[هة]|تعبان|مفعول|ينفع|مناسب|ارشح|ترشح|بديل علاجي)/i;
const COMPLAINT_RX = /(شكوى|شكوي|متضايق|زعلان|تاخير|تأخير|مش راضي|مشكله|مشكلة|وحش|سيئ|رفض|محدش رد)/i;
const ORDER_RX = /(ابعت|ابعته|ابعتهم|تمام ابعت|العنوان|الدليفري|المندوب|تم الارسال|تم الإرسال|تم تأكيد|هطلب|عايز واحد|محتاج واحد)/i;
const UNAVAILABLE_RX = /(مش موجود|غير متوفر|مش متوفر|ناقص|خلصان|معجز|غير متاح)/i;
const ALTERNATIVE_RX = /(بديل|ممكن بدل|ارشح|أرشح|نقدر نوفر|فيه بديل|في بديل|بديله|بديلة)/i;
const EXPLAIN_RX = /(الفرق|لانه|لأن|بيعمل|بيساعد|طريق[هة]|جرع[هة]|استخدام|نفس الماد[هة]|نفس التركيبه|نفس التركيبة|بديل مناسب)/i;
const REQUEST_REGISTERED_RX = /(تم تسجيل طلب|سجلنا طلب|اتسجل طلب|تم تسجيل الصنف|هنسجل طلب|سجلت طلب)/i;
const CS_FOLLOWUP_TOLD_RX = /(خدم[هة] العملاء.*هتتابع|هيتم متابعه|هيتم متابعة|هنخلي خدم[هة] العملاء|متابع[هة] من خدم[هة] العملاء)/i;
const SALES_CLOSE_RX = /(ابعت لحضرتك|ابعته لحضرتك|ابعتهم لحضرتك|أبعته لحضرتك|تحب.*نبعته|تحبي.*نبعته|اكمل الطلب|أكمل الطلب|على عنوان|علي عنوان)/i;
const CHOICE_RX = /(تحب|تحبي|حضرتك تفضل|حضرتك تفضلي|مقاس|تركيز|حجم|عدد)/i;
const FOLLOWUP_PROMISE_RX = /(هتابع|هنتابع|بنتابع|هرجع لحضرتك|هنرجع لحضرتك|اطمن على حضرتك|نطمن على حضرتك)/i;
const ILLNESS_RX = /(تعبان|تعبانه|اعراض|أعراض|كحه|كحة|حراره|حرارة|اسهال|إسهال|ترجيع|قيء|احتقان|الم|ألم|ضغط)/i;
const RECOMMENDATION_RX = /(رشح|ترشيح|أرشح|جرع[هة]|طريق[هة] الاستخدام|استخدم|خد|خدي|خديها|خده)/i;

function unique<T>(values: T[]) { return Array.from(new Set(values)); }
function orderedMessages(session: WhatsAppConversationSession) {
  return session.messages.filter((m) => m.direction !== 'system' && m.kind !== 'system').slice().sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}
function meaningful(messages: WhatsAppParsedMessage[]) {
  return messages.filter((m) => String(m.text || '').trim() && m.kind !== 'deleted');
}
function intentFor(message: WhatsAppParsedMessage): SmartIntent[] {
  const text = message.text || '';
  const out: SmartIntent[] = [];
  if (SERVICE_FOLLOWUP_RX.test(text)) out.push('service_followup');
  if (message.direction === 'inbound' && COMPLAINT_RX.test(text)) out.push('complaint');
  if (CONSULT_RX.test(text)) out.push('consultation');
  if (PRODUCT_RX.test(text)) out.push('product_request');
  if (AVAILABILITY_RX.test(text)) out.push('availability_check');
  if (ORDER_RX.test(text)) out.push('order');
  return unique(out);
}
function extractField(text: string, labels: string[]) {
  for (const label of labels) {
    const rx = new RegExp(`${label}\\s*[:：-]\\s*([^\\n|]+)`, 'i');
    const match = text.match(rx);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}
function firstCustomerMessage(messages: WhatsAppParsedMessage[]) { return messages.find((m) => m.direction === 'inbound') || null; }

function analyzeRequestCandidate(messages: WhatsAppParsedMessage[]): SmartCustomerRequestCandidate {
  const structured = messages.filter((m) => /طلب\s*عميل|customer\s*request/i.test(m.text || ''));
  const registered = messages.filter((m) => REQUEST_REGISTERED_RX.test(m.text || ''));
  const evidence = unique([...structured, ...registered].map((m) => m.id));
  const source = structured.map((m) => m.text || '').join('\n');
  if (!evidence.length) return { detected: false, productName: null, customerName: null, customerCode: null, customerPhone: null, quantity: null, concentration: null, evidenceMessageIds: [], confidence: 'low', needsConfirmation: false };
  const productName = extractField(source, ['الصنف', 'اسم الصنف', 'product']);
  const customerName = extractField(source, ['العميل', 'اسم العميل', 'customer']);
  const customerCode = extractField(source, ['كود العميل', 'الكود', 'code']);
  const customerPhone = extractField(source, ['رقم العميل', 'الهاتف', 'الموبايل', 'phone']);
  const quantity = extractField(source, ['الكمية', 'كميه', 'qty']);
  const concentration = extractField(source, ['التركيز', 'تركيز']);
  const complete = Boolean(productName && customerName && customerCode && customerPhone);
  return { detected: true, productName, customerName, customerCode, customerPhone, quantity, concentration, evidenceMessageIds: evidence, confidence: complete ? 'high' : structured.length ? 'medium' : 'low', needsConfirmation: !complete };
}

export function analyzeSmartConversationDeep(session: WhatsAppConversationSession): SmartDeepConversationAnalysis {
  const messages = meaningful(orderedMessages(session));
  const first = messages[0] || null;
  const firstIdentity = first ? extractSmartStaffIdentity(first) : null;
  const firstInbound = firstCustomerMessage(messages);
  const entryOrigin: SmartEntryOrigin = first?.direction === 'outbound' && firstIdentity?.role === 'customer_service'
    ? 'customer_service_outreach'
    : first?.direction === 'inbound' ? 'customer_initiated' : 'unknown';

  const intentEvents = messages.flatMap((m) => intentFor(m).map((intent) => ({ intent, id: m.id, direction: m.direction })));
  const intentJourney = unique(intentEvents.map((e) => e.intent));
  const primaryIntent: SmartIntent = entryOrigin === 'customer_service_outreach' ? 'service_followup'
    : intentJourney.find((x) => x === 'complaint')
      || intentJourney.find((x) => x === 'consultation')
      || intentJourney.find((x) => x === 'product_request')
      || intentJourney.find((x) => x === 'availability_check')
      || intentJourney.find((x) => x === 'order')
      || 'unknown';

  const opportunities: SmartSalesOpportunity[] = [];
  messages.forEach((m, index) => {
    if (m.direction !== 'inbound' || !PRODUCT_RX.test(m.text || '')) return;
    const following = messages.slice(index + 1, index + 5).filter((x) => x.direction === 'outbound');
    const evidence = [m.id, ...following.map((x) => x.id)];
    const closed = following.some((x) => SALES_CLOSE_RX.test(x.text || ''));
    const guided = following.some((x) => CHOICE_RX.test(x.text || '') || ALTERNATIVE_RX.test(x.text || ''));
    opportunities.push({
      triggerMessageId: m.id,
      handling: closed && guided ? 'handled_well' : closed || guided ? 'partial' : following.length ? 'missed' : 'needs_review',
      evidenceMessageIds: evidence,
      reason: closed && guided ? 'تم توجيه العميل ومحاولة إغلاق الطلب' : closed ? 'تم الإغلاق بدون استكشاف/توجيه واضح' : guided ? 'تمت مساعدة العميل بدون إغلاق واضح' : following.length ? 'ظهرت فرصة بيع ولم يظهر توجيه أو إغلاق واضح' : 'لا توجد استجابة مؤكدة بعد فرصة البيع',
    });
  });

  const consultInbound = messages.filter((m) => m.direction === 'inbound' && CONSULT_RX.test(m.text || ''));
  const consultEvidence = new Set<string>();
  let consultScore = 0;
  for (const inbound of consultInbound) {
    consultEvidence.add(inbound.id);
    const idx = messages.findIndex((m) => m.id === inbound.id);
    const replies = messages.slice(idx + 1, idx + 5).filter((m) => m.direction === 'outbound');
    replies.forEach((r) => consultEvidence.add(r.id));
    if (replies.some((r) => EXPLAIN_RX.test(r.text || ''))) consultScore += 2;
    else if (replies.some((r) => String(r.text || '').trim().length >= 25)) consultScore += 1;
  }
  const consultationCommunication: ConsultationCommunication = !consultInbound.length ? 'not_applicable' : consultScore >= consultInbound.length * 2 ? 'clear' : consultScore >= consultInbound.length ? 'partial' : 'weak';

  const unavailableMessages = messages.filter((m) => UNAVAILABLE_RX.test(m.text || ''));
  const unavailableIds = new Set(unavailableMessages.map((m) => m.id));
  const alternativeOffered = messages.some((m) => m.direction === 'outbound' && ALTERNATIVE_RX.test(m.text || ''));
  const alternativeExplained = alternativeOffered && messages.some((m) => m.direction === 'outbound' && EXPLAIN_RX.test(m.text || ''));
  const requestRegistered = messages.some((m) => REQUEST_REGISTERED_RX.test(m.text || ''));
  const customerToldRequestRegistered = messages.some((m) => REQUEST_REGISTERED_RX.test(m.text || '') || CS_FOLLOWUP_TOLD_RX.test(m.text || ''));
  if (alternativeOffered) messages.filter((m) => ALTERNATIVE_RX.test(m.text || '')).forEach((m) => unavailableIds.add(m.id));
  if (requestRegistered || customerToldRequestRegistered) messages.filter((m) => REQUEST_REGISTERED_RX.test(m.text || '') || CS_FOLLOWUP_TOLD_RX.test(m.text || '')).forEach((m) => unavailableIds.add(m.id));
  const unavailableDetected = unavailableMessages.length > 0;
  const unavailableItem: SmartUnavailableItemAnalysis = {
    detected: unavailableDetected,
    evidenceMessageIds: Array.from(unavailableIds),
    alternativeOffered,
    alternativeExplained,
    requestRegistered,
    customerToldRequestRegistered,
    suggestedCriteria: unavailableDetected ? ['unavailable_items', ...(requestRegistered || customerToldRequestRegistered ? ['customer_request_registration'] : [])] : [],
  };

  const customerRequest = analyzeRequestCandidate(messages);
  const explicitPromise = messages.find((m) => m.direction === 'outbound' && FOLLOWUP_PROMISE_RX.test(m.text || ''));
  const illness = firstInbound && ILLNESS_RX.test(firstInbound.text || '') ? firstInbound : messages.find((m) => m.direction === 'inbound' && ILLNESS_RX.test(m.text || ''));
  const recommendation = messages.find((m) => m.direction === 'outbound' && RECOMMENDATION_RX.test(m.text || ''));
  const serviceIssue = messages.find((m) => m.direction === 'inbound' && COMPLAINT_RX.test(m.text || ''));
  const followReason = explicitPromise ? 'explicit_promise' : illness ? 'illness' : recommendation ? 'recommendation' : serviceIssue ? 'service_issue' : null;
  const followEvidence = [explicitPromise?.id, illness?.id, recommendation?.id, serviceIssue?.id].filter(Boolean) as string[];
  const followup: SmartFollowupCandidate = { detected: Boolean(followReason), reason: followReason, evidenceMessageIds: unique(followEvidence), needsConfirmation: followReason !== 'explicit_promise' };

  const suggested = new Set<string>();
  if (opportunities.length) suggested.add('sales_closing');
  if (opportunities.some((o) => o.handling === 'partial' || o.handling === 'missed')) suggested.add('cross_sell_upsell');
  if (consultInbound.length) suggested.add('consultation_quality');
  if (consultInbound.length && messages.some((m) => /جرع[هة]|طريق[هة] الاستخدام|كام مره|كام مرة|قبل الاكل|بعد الاكل/i.test(m.text || ''))) suggested.add('dosage_explanation');
  unavailableItem.suggestedCriteria.forEach((x) => suggested.add(x));
  if (followup.detected) suggested.add('exceptional_followup_recognition');
  if (requestRegistered || customerRequest.detected) suggested.add('customer_request_registration');

  const evidence = unique([
    ...intentEvents.map((e) => e.id),
    ...opportunities.flatMap((o) => o.evidenceMessageIds),
    ...Array.from(consultEvidence),
    ...unavailableItem.evidenceMessageIds,
    ...customerRequest.evidenceMessageIds,
    ...followup.evidenceMessageIds,
  ]);
  let confidence = 1;
  if (primaryIntent === 'unknown') confidence -= 0.35;
  if (entryOrigin === 'unknown') confidence -= 0.15;
  if (customerRequest.needsConfirmation) confidence -= 0.1;
  if (opportunities.some((o) => o.handling === 'needs_review')) confidence -= 0.1;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    entryOrigin,
    primaryIntent,
    intentJourney,
    confidence,
    humanReviewRequired: confidence < 0.8 || customerRequest.needsConfirmation || opportunities.some((o) => o.handling === 'needs_review'),
    salesOpportunities: opportunities,
    consultationCommunication,
    consultationEvidenceMessageIds: Array.from(consultEvidence),
    unavailableItem,
    customerRequest,
    followup,
    suggestedCriteria: Array.from(suggested),
    evidenceMessageIds: evidence,
  };
}
