import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { WhatsAppOperationalIntelligenceV6, WhatsAppProductSignal } from './whatsappOperationalIntelligenceV6';

export type WhatsAppProductJourneyStage =
  | 'mentioned'
  | 'requested'
  | 'availability_confirmed'
  | 'unavailable'
  | 'alternative_offered'
  | 'recommended'
  | 'accepted'
  | 'rejected'
  | 'order_confirmed'
  | 'awaiting_invoice'
  | 'needs_followup'
  | 'unresolved';

export interface WhatsAppProductJourneyEventV7 {
  stage: WhatsAppProductJourneyStage;
  messageIds: string[];
  confidence: number;
  note: string;
}

export type WhatsAppLeakageCodeV8 =
  | 'stock_unavailable'
  | 'no_alternative'
  | 'price_objection'
  | 'response_delay'
  | 'closing_gap'
  | 'customer_no_reply'
  | 'recommendation_pending'
  | 'delivery_issue'
  | 'customer_rejected'
  | 'unknown';

export interface WhatsAppProductJourneyV7 {
  productName: string;
  productCode: string | null;
  productId: string | null;
  quantity: number | null;
  currentStage: WhatsAppProductJourneyStage;
  events: WhatsAppProductJourneyEventV7[];
  saleIntent: boolean;
  closedInChat: boolean;
  followupCandidate: boolean;
  leakageReason: string | null;
  leakageCode?: WhatsAppLeakageCodeV8 | null;
  nextAction: string;
  confidence: number;
}

export interface WhatsAppProductJourneySummaryV7 {
  version: 'whatsapp-product-journey-v7';
  journeys: WhatsAppProductJourneyV7[];
  requestedProducts: number;
  unavailableProducts: number;
  alternativesOffered: number;
  recommendationsAccepted: number;
  chatClosedProducts: number;
  unresolvedProducts: number;
  followupProducts: number;
  saleLeakageCount: number;
  dominantLeakageReason: string | null;
  nextBestCommercialAction: string;
}

const AVAILABLE_RX = /(موجود|متوفر|متاح|عندنا|موجود عندنا|متوفر عندنا)/i;
const UNAVAILABLE_RX = /(مش موجود|غير موجود|غير متوفر|ناقص|مش متاح|خلص|مش عندنا)/i;
const ALTERNATIVE_RX = /(بديل|بداله|بدلها|نرشح|ارشح|أرشح|ممكن بدل|ممكن تستخدم|ممكن تاخد|ممكن تاخدي)/i;
const ACCEPT_RX = /(^|\s)(تمام|ماشي|موافق|اوكي|أوكي|خلاص|ابعت|ابعته|ابعتي|هات|هاته|هاخده|هاخدها|هجربه|هجربها|تمام كده|تمام كدا)(\s|$)/i;
const REJECT_RX = /(لا شكرا|مش عايز|مش عاوز|مش محتاج|غالي|مش مناسب|مش هاخد|مش هطلب|بلاش)/i;
const CLOSE_RX = /(تم تأكيد|تم التاكيد|الأوردر اتأكد|الاوردر اتاكد|أكدنا الطلب|اكدنا الطلب|جاري الارسال|جاري الإرسال|خرج لحضرتك|الإجمالي|الاجمالي|فاتوره|فاتورة)/i;
const PRICE_OBJECTION_RX = /(غالي|غالية|السعر عالي|السعر غالي|كتير عليا|كتير جدًا|مش مناسب.*السعر|السعر مش مناسب)/i;
const DELIVERY_PROBLEM_RX = /(المندوب.*متأخر|التوصيل.*متأخر|ماوصلش|موصلش|لسه مجاش)/i;
const MAX_HEALTHY_RESPONSE_MINUTES = 10;

const normalize = (value: unknown) => String(value ?? '')
  .trim().toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '')
  .replace(/[^\p{L}\p{N}\s.+%-]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const unique = <T,>(rows: T[]) => [...new Set(rows)];

function messageMatchesProduct(message: WhatsAppParsedMessage, product: WhatsAppProductSignal) {
  if (product.evidenceMessageIds.includes(message.id)) return true;
  const key = normalize(product.canonicalName || product.rawName);
  if (key.length < 3) return false;
  const body = normalize(message.text);
  return body.includes(key) || key.includes(body);
}

function windowAroundProduct(session: WhatsAppConversationSession, product: WhatsAppProductSignal) {
  const explicitIndexes = session.messages
    .map((m, index) => messageMatchesProduct(m, product) ? index : -1)
    .filter((index) => index >= 0);
  if (!explicitIndexes.length) return session.messages;
  const start = Math.max(0, Math.min(...explicitIndexes) - 1);
  const end = Math.min(session.messages.length, Math.max(...explicitIndexes) + 7);
  return session.messages.slice(start, end);
}

function event(stage: WhatsAppProductJourneyStage, messages: WhatsAppParsedMessage[], confidence: number, note: string): WhatsAppProductJourneyEventV7 {
  return { stage, messageIds: unique(messages.map((m) => m.id)).slice(0, 12), confidence, note };
}

function currentStage(events: WhatsAppProductJourneyEventV7[], followupCandidate: boolean): WhatsAppProductJourneyStage {
  const stages = new Set(events.map((e) => e.stage));
  if (stages.has('order_confirmed')) return 'awaiting_invoice';
  if (followupCandidate) return 'needs_followup';
  if (stages.has('rejected')) return 'rejected';
  if (stages.has('accepted')) return 'accepted';
  if (stages.has('alternative_offered')) return 'alternative_offered';
  if (stages.has('unavailable')) return 'unavailable';
  if (stages.has('availability_confirmed')) return 'availability_confirmed';
  if (stages.has('recommended')) return 'recommended';
  if (stages.has('requested')) return 'unresolved';
  return 'mentioned';
}

function firstResponseDelayMinutes(messages: WhatsAppParsedMessage[]) {
  for (let i = 0; i < messages.length; i += 1) {
    if (messages[i].direction !== 'inbound') continue;
    const reply = messages.slice(i + 1).find((m) => m.direction === 'outbound');
    if (!reply) continue;
    return Math.max(0, (reply.timestamp.getTime() - messages[i].timestamp.getTime()) / 60000);
  }
  return null;
}

function leakageFor(
  events: WhatsAppProductJourneyEventV7[],
  product: WhatsAppProductSignal,
  messages: WhatsAppParsedMessage[]
): { code: WhatsAppLeakageCodeV8 | null; reason: string | null } {
  const stages = new Set(events.map((e) => e.stage));
  if (stages.has('order_confirmed') || stages.has('accepted')) return { code: null, reason: null };

  const inboundText = messages.filter((m) => m.direction === 'inbound').map((m) => m.text).join('\n');
  const allText = messages.map((m) => m.text).join('\n');
  const delay = firstResponseDelayMinutes(messages);

  if (stages.has('unavailable') && !stages.has('alternative_offered')) {
    return { code: 'stock_unavailable', reason: 'الصنف غير متوفر ولم يظهر عرض بديل واضح.' };
  }
  if (stages.has('unavailable') && stages.has('alternative_offered') && !stages.has('accepted') && !stages.has('rejected')) {
    return { code: 'no_alternative', reason: 'تم عرض بديل بعد عدم توفر الصنف لكن لم يظهر حسم من العميل.' };
  }
  if (PRICE_OBJECTION_RX.test(inboundText)) {
    return { code: 'price_objection', reason: 'ظهر اعتراض صريح من العميل على السعر.' };
  }
  if (delay != null && delay > MAX_HEALTHY_RESPONSE_MINUTES) {
    return { code: 'response_delay', reason: `تأخر أول رد مفيد على طلب العميل قرابة ${Math.round(delay)} دقيقة.` };
  }
  if (DELIVERY_PROBLEM_RX.test(allText)) {
    return { code: 'delivery_issue', reason: 'ظهرت مشكلة في التنفيذ أو التوصيل أثرت على رحلة الطلب.' };
  }
  if (stages.has('rejected')) {
    return { code: 'customer_rejected', reason: 'العميل رفض الصنف أو الترشيح بشكل صريح.' };
  }
  if (stages.has('alternative_offered') || stages.has('recommended')) {
    return { code: 'recommendation_pending', reason: 'تم عرض بديل أو ترشيح ولم يظهر قرار نهائي من العميل.' };
  }
  if (stages.has('availability_confirmed') && !stages.has('order_confirmed')) {
    return { code: 'closing_gap', reason: 'الصنف كان متاحًا وظهرت نية شراء، لكن لم يظهر إغلاق واضح للعملية البيعية.' };
  }
  if (messages.some((m) => m.direction === 'outbound') && !messages.slice().reverse().some((m) => m.direction === 'inbound')) {
    return { code: 'customer_no_reply', reason: 'لم يظهر رد من العميل بعد آخر تواصل من الصيدلية.' };
  }
  if (product.status === 'requested') {
    return { code: 'unknown', reason: 'طلب العميل لم يصل إلى نتيجة بيع أو رفض واضحة، والسبب غير محسوم من الأدلة الحالية.' };
  }
  return { code: null, reason: null };
}

function nextActionFor(events: WhatsAppProductJourneyEventV7[], leakage: string | null, followupCandidate: boolean) {
  const stages = new Set(events.map((e) => e.stage));
  if (followupCandidate) return 'إنشاء متابعة بعد الاستخدام لقياس النتيجة ورضا العميل.';
  if (stages.has('order_confirmed')) return 'انتظار/مطابقة الفاتورة الفعلية قبل احتساب البيع رسميًا.';
  if (stages.has('unavailable') && !stages.has('alternative_offered')) return 'البحث عن بديل مناسب أو تسجيل طلب توفير الصنف ثم متابعة العميل.';
  if (stages.has('alternative_offered') && !stages.has('accepted') && !stages.has('rejected')) return 'متابعة العميل لحسم البديل المقترح.';
  if (stages.has('availability_confirmed') && !stages.has('order_confirmed')) return 'إغلاق العملية البيعية وسؤال العميل هل يؤكد الطلب.';
  if (leakage) return 'متابعة الفرصة البيعية قبل إغلاقها كمفقودة.';
  return 'لا يوجد إجراء تجاري إضافي مثبت من هذه الجلسة.';
}

export function buildWhatsAppProductJourneyV7(
  session: WhatsAppConversationSession,
  operational: WhatsAppOperationalIntelligenceV6,
): WhatsAppProductJourneySummaryV7 {
  const journeys = operational.products.map((product) => {
    const messages = windowAroundProduct(session, product);
    const inbound = messages.filter((m) => m.direction === 'inbound');
    const outbound = messages.filter((m) => m.direction === 'outbound');
    const events: WhatsAppProductJourneyEventV7[] = [];

    if (product.status === 'requested' || (product.sourceDirection === 'inbound' && product.status !== 'mentioned')) {
      events.push(event('requested', session.messages.filter((m) => product.evidenceMessageIds.includes(m.id)), Math.max(75, product.confidence), 'العميل طلب/استفسر عن الصنف.'));
    }
    if (product.status === 'recommended') {
      events.push(event('recommended', session.messages.filter((m) => product.evidenceMessageIds.includes(m.id)), Math.max(78, product.confidence), 'الصنف ظهر كترشيح من الصيدلية.'));
    }

    const available = outbound.filter((m) => AVAILABLE_RX.test(m.text) && !UNAVAILABLE_RX.test(m.text));
    const unavailable = messages.filter((m) => UNAVAILABLE_RX.test(m.text));
    const alternative = outbound.filter((m) => ALTERNATIVE_RX.test(m.text));
    const accepted = inbound.filter((m) => ACCEPT_RX.test(m.text));
    const rejected = inbound.filter((m) => REJECT_RX.test(m.text));
    const closed = messages.filter((m) => CLOSE_RX.test(m.text));

    if (available.length) events.push(event('availability_confirmed', available, 84, 'تم تأكيد توفر الصنف/الطلب في المحادثة.'));
    if (unavailable.length || product.status === 'unavailable') events.push(event('unavailable', unavailable.length ? unavailable : messages.filter((m) => product.evidenceMessageIds.includes(m.id)), 90, 'ظهر أن الصنف غير متوفر/ناقص.'));
    if (alternative.length) events.push(event('alternative_offered', alternative, 86, 'تم عرض بديل أو ترشيح بديل.'));

    const matchingRecommendation = operational.recommendations.find((r) => {
      const a = normalize(r.productName);
      const b = normalize(product.canonicalName || product.rawName);
      return a && b && (a === b || a.includes(b) || b.includes(a));
    });
    if (matchingRecommendation?.accepted === true || accepted.length) {
      events.push(event('accepted', accepted, matchingRecommendation?.accepted === true ? 94 : 82, 'ظهر قبول العميل للترشيح/الطلب.'));
    } else if (matchingRecommendation?.accepted === false || rejected.length) {
      events.push(event('rejected', rejected, matchingRecommendation?.accepted === false ? 94 : 86, 'ظهر رفض العميل للترشيح/الطلب.'));
    }
    if (closed.length) events.push(event('order_confirmed', closed, 91, 'ظهر إغلاق/تأكيد للأوردر داخل المحادثة.'));

    const followupCandidate = Boolean(matchingRecommendation?.accepted === true);
    const leakage = leakageFor(events, product, messages);
    const leakageReason = leakage.reason;
    const stage = currentStage(events, followupCandidate);
    const confidence = Math.round(Math.min(98, Math.max(product.confidence, ...events.map((e) => e.confidence), 55)));

    return {
      productName: product.canonicalName || product.rawName,
      productCode: product.productCode || null,
      productId: product.productId || null,
      quantity: product.quantity,
      currentStage: stage,
      events,
      saleIntent: product.status === 'requested' || product.status === 'recommended' || events.some((e) => ['availability_confirmed','alternative_offered','accepted','order_confirmed'].includes(e.stage)),
      closedInChat: events.some((e) => e.stage === 'order_confirmed'),
      followupCandidate,
      leakageReason,
      leakageCode: leakage.code,
      nextAction: nextActionFor(events, leakageReason, followupCandidate),
      confidence,
    } satisfies WhatsAppProductJourneyV7;
  });

  const leakage = journeys.filter((j) => Boolean(j.leakageReason));
  const reasons = leakage.map((j) => j.leakageReason!).filter(Boolean);
  const dominantLeakageReason = reasons.length
    ? [...new Set(reasons)].sort((a, b) => reasons.filter((r) => r === b).length - reasons.filter((r) => r === a).length)[0]
    : null;
  const unresolvedProducts = journeys.filter((j) => ['unresolved','availability_confirmed','alternative_offered','recommended'].includes(j.currentStage)).length;
  const followupProducts = journeys.filter((j) => j.followupCandidate).length;
  const chatClosedProducts = journeys.filter((j) => j.closedInChat).length;

  let nextBestCommercialAction = 'لا توجد فرصة بيع غير محسومة مثبتة من الأصناف المستخرجة.';
  if (journeys.some((j) => j.currentStage === 'unavailable' && j.leakageReason)) nextBestCommercialAction = 'ابدأ بالأصناف غير المتوفرة التي لم يُعرض لها بديل وسجّل طلب توفير عند الحاجة.';
  else if (journeys.some((j) => j.currentStage === 'alternative_offered')) nextBestCommercialAction = 'راجع البدائل المعروضة التي لم يحسمها العميل وتابع قبولها.';
  else if (journeys.some((j) => j.currentStage === 'availability_confirmed')) nextBestCommercialAction = 'راجع الأصناف المتوفرة التي لم يتحول تأكيد توفرها إلى إغلاق أوردر.';
  else if (chatClosedProducts > 0) nextBestCommercialAction = 'طابق الأوردرات المغلقة مع الفواتير اليومية قبل احتساب التحويل البيعي.';
  else if (followupProducts > 0) nextBestCommercialAction = 'حوّل الترشيحات المقبولة إلى متابعات بعد الاستخدام.';

  return {
    version: 'whatsapp-product-journey-v7',
    journeys,
    requestedProducts: journeys.filter((j) => j.events.some((e) => e.stage === 'requested')).length,
    unavailableProducts: journeys.filter((j) => j.events.some((e) => e.stage === 'unavailable')).length,
    alternativesOffered: journeys.filter((j) => j.events.some((e) => e.stage === 'alternative_offered')).length,
    recommendationsAccepted: journeys.filter((j) => j.events.some((e) => e.stage === 'accepted')).length,
    chatClosedProducts,
    unresolvedProducts,
    followupProducts,
    saleLeakageCount: leakage.length,
    dominantLeakageReason,
    nextBestCommercialAction,
  };
}

export function enrichWhatsAppOperationalJourneysV7(
  session: WhatsAppConversationSession,
  operational: WhatsAppOperationalIntelligenceV6,
) {
  return { ...operational, productJourney: buildWhatsAppProductJourneyV7(session, operational) };
}
