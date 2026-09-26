import { supabase } from '@/lib/supabase';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { UnifiedConversationIntelligence } from './whatsappUnifiedIntelligenceV4';
import { buildCanonicalProduct, countNormalizedNames, type RawProductRow } from './salesIntelligence/pharmacyProducts/canonicalProduct';
import { normalizePharmacyText } from './salesIntelligence/pharmacyProducts/pharmacyNormalization';
import { buildPharmacyProductIndex, resolveProductMention, CROSS_SCRIPT_SEED } from './salesIntelligence/pharmacyProducts/pharmacyProductResolverV2';
import { isDirectCommercialProductMessageV22 } from './whatsappDirectProductIntentV22';

export type WhatsAppPrimaryIntent =
  | 'customer_request'
  | 'product_inquiry'
  | 'medical_consultation'
  | 'proactive_checkin'
  | 'complaint'
  | 'doctor_recommendation'
  | 'delivery_issue'
  | 'followup_response'
  | 'general_service'
  | 'other';

export type WhatsAppOperationalOutcome =
  | 'completed_sale'
  | 'probable_sale'
  | 'no_sale'
  | 'needs_followup'
  | 'unresolved_request'
  | 'complaint_resolved'
  | 'complaint_unresolved'
  | 'consultation_only'
  | 'checkin_complete'
  | 'unknown';

export type WhatsAppInitiator = 'customer' | 'pharmacy' | 'unknown';

export interface WhatsAppEvidence {
  messageIds: string[];
  quote: string;
  confidence: number;
}

export interface WhatsAppProductSignal {
  rawName: string;
  normalizedName: string;
  quantity: number | null;
  status: 'requested' | 'recommended' | 'accepted' | 'rejected' | 'unavailable' | 'mentioned';
  sourceDirection: 'inbound' | 'outbound' | 'system';
  evidenceMessageIds: string[];
  confidence: number;
  productId?: string | null;
  productCode?: string | null;
  canonicalName?: string | null;
  catalogConfidence?: 'proven' | 'strongly_inferred' | 'weakly_inferred' | 'unknown';
}

export interface WhatsAppRecommendationSignal {
  productName: string | null;
  accepted: boolean | null;
  rejected: boolean;
  doctorName: string | null;
  evidenceMessageIds: string[];
  confidence: number;
}

export interface WhatsAppRequestSignal {
  productName: string | null;
  quantity: number | null;
  urgency: 'normal' | 'urgent';
  unresolved: boolean;
  evidenceMessageIds: string[];
  confidence: number;
}

export interface WhatsAppFollowupPlan {
  required: boolean;
  reason: string | null;
  ownerRole: 'team_dawaa_alpha' | 'customer_service' | null;
  dueInDays: number | null;
  priority: 'normal' | 'important' | 'urgent';
  evidenceMessageIds: string[];
}

export interface WhatsAppOperationalIntelligenceV6 {
  version: 'whatsapp-operational-v6';
  primaryIntent: WhatsAppPrimaryIntent;
  secondaryIntents: WhatsAppPrimaryIntent[];
  initiator: WhatsAppInitiator;
  operationalOutcome: WhatsAppOperationalOutcome;
  customerState: 'improved' | 'worse' | 'same' | 'unknown';
  products: WhatsAppProductSignal[];
  customerRequests: WhatsAppRequestSignal[];
  recommendations: WhatsAppRecommendationSignal[];
  followupPlan: WhatsAppFollowupPlan;
  nextBestAction: string;
  officialScoringEligible: boolean;
  intentConfidence: number;
  outcomeConfidence: number;
  evidence: Record<string, WhatsAppEvidence>;
}

export interface WhatsAppOperationalContext {
  sourceId: string;
  branch?: string | null;
  customerId?: string | null;
  customerCode?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  staffId?: string | null;
  staffName?: string | null;
  createdBy?: string | null;
}


export interface WhatsAppMultiSessionOperationalSessionV1 {
  sessionIndex: number;
  startedAt: string;
  endedAt: string;
  messageCount: number;
  relationshipToPrevious?: 'independent' | 'continuation';
  continuationOfSessionIndex?: number | null;
  relationshipReason?: string | null;
  operational: WhatsAppOperationalIntelligenceV6;
}

export interface WhatsAppMultiSessionOperationalV1 {
  version: 'whatsapp-multi-session-operational-v1';
  sessionCount: number;
  sessions: WhatsAppMultiSessionOperationalSessionV1[];
}

const normalize = (value: unknown) => String(value ?? '')
  .trim().toLowerCase()
  .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '').replace(/[^\p{L}\p{N}\s.+%-]/gu, ' ')
  .replace(/\s+/g, ' ').trim();

const text = (messages: WhatsAppParsedMessage[]) => messages.map((m) => m.text).join('\n');
const byDirection = (session: WhatsAppConversationSession, direction: 'inbound' | 'outbound') => session.messages.filter((m) => m.direction === direction);
const has = (value: string, rx: RegExp) => rx.test(value);
const ids = (messages: WhatsAppParsedMessage[], rx: RegExp) => messages.filter((m) => rx.test(m.text)).map((m) => m.id).slice(0, 10);
const uniq = <T,>(rows: T[]) => [...new Set(rows)];

const REQUEST_RX = /(هحتاجه|هحتاجها|هاخده|هاخدها|عايزه|عاوزه|محتاجه|عايزين|محتاجين|عايز|عاوز|محتاج|ممكن|ابعت|ابعث|هات|اطلب|أطلب|متوفر|موجود عندكم|عندكم)/i;
const CUSTOMER_REQUEST_INTENT_RX = /(هحتاجه|هحتاجها|هاخده|هاخدها|عايزه|عاوزه|محتاجه|عايزين|محتاجين|عايز|عاوز|محتاج|ابعت|ابعث|هات|اطلب|أطلب|متوفر|موجود عندكم|عندكم|ممكن\s+(?:ابعت|ابعث|هات|اطلب|توصيل|الدليفري|المندوب)|الدليفري\s+يجيلي|التوصيل)/i;
const PRODUCT_INQUIRY_RX = /(بكام|سعر|متوفر|متاح|موجود|عندكم|فيه|في من|العبوه|العبوة|تركيز|كام قرص|كام شريط|توضيح\s+عن\s+(?:ال)?منتج|استعماله\s+ازاي|استخدامه\s+ازاي|بيستخدم\s+ازاي)/i;
const INFO_ONLY_PRODUCT_INQUIRY_RX = /(توضيح\s+عن\s+(?:ال)?منتج|استعماله\s+ازاي|استخدامه\s+ازاي|بيستخدم\s+ازاي)/i;
const POSITIVE_SERVICE_FEEDBACK_RX = /(كله\s+تمام|كل\s+حاجه\s+تمام|كل\s+حاجة\s+تمام|خدمه[^\n]{0,80}ذوق|خدمة[^\n]{0,80}ذوق|ربنا\s+يباركلكم|عند\s+حسن\s+ظن)/i;
const RECOMMEND_RX = /(ارشح|أرشح|نرشح|ترشيح|انصح|أنصح|ممكن تستخدم|ممكن تاخد|ممكن تاخدي|الافضل|الأفضل|بديل|بداله|بدلها)/i;
const RECOMMENDATION_REQUEST_RX = /(ترشحلي|ترشحلى|رشحلي|رشحلى|اقترحلي|اقترحلى|إقترحلي|إقترحلى|ايه\s+افضل|ايه\s+أفضل|أفضل\s+(?:فيتامين|منتج)|افضل\s+(?:فيتامين|منتج))/i;
const ACCEPT_RX = /(^|\s)(تمام|ماشي|موافق|اوكي|أوكي|خلاص|ابعت|ابعته|ابعتي|هات|هاته|هاخده|هاخدها|هجربه|هجربها|تمام كده|تمام كدا)(\s|$)/i;
const REJECT_RX = /(لا شكرا|مش عايز|مش عاوز|مش محتاج|غالي|مش مناسب|مش هاخد|مش هطلب|بلاش)/i;
const COMPLAINT_RX = /(شكوي|شكوى|مشكله|مشكلة|متاخر|متأخر|محدش رد|غلط|سيء|وحش|ماوصلش|موصلش|لسه مجاش|اتضايقت|زعلت)/i;
const NEGATED_COMPLAINT_RX = /(مفيش\s+مشكله|مفيش\s+مشكلة|مافيش\s+مشكله|مافيش\s+مشكلة|لا\s+توجد\s+مشكله|لا\s+توجد\s+مشكلة|مش\s+مشكله|مش\s+مشكلة)/i;
const FULFILLMENT_FAILURE_RX = /(التاخير\s+الكبير|التأخير\s+الكبير|المندوب[^\n]{0,80}(?:مجاش|ماجاش|مجالبيش|ماوصلش|موصلش)|كان\s+المفروض[^\n]{0,100}(?:لكن|بس)[^\n]{0,100}(?:مجاش|ماجاش|مجالبيش|ماوصلش|موصلش)|لو\s+حضرتك[^\n]{0,40}(?:تحبي|تحب)[^\n]{0,40}نبعت\s+(?:الاوردر|الأوردر)|نبعت\s+(?:الاوردر|الأوردر))/i;
const RECOVERY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|اسفين|آسفين|تم الحل|هنحل|هنراجع|هنعوض|تم التصحيح)/i;
const DELIVERY_RX = /(توصيل|مندوب|العنوان|وصل|ماوصلش|موصلش|خرج لحضرتك|جاري الارسال|جاري الإرسال)/i;
const MEDICAL_RX = /(اعراض|أعراض|جرعه|جرعة|كحه|كحة|حراره|حرارة|اسهال|إسهال|وجع|التهاب|حامل|رضاع|ضغط|سكر|حساسي|ينفع|استخدم|اخد|آخد|طفل|طفله|طفلة)|(?<![\p{L}\p{N}])(?:الم|ألم)(?![\p{L}\p{N}])/iu;
const CHECKIN_OUT_RX = /(حابين نطمن|حابه اطمن|حابة اطمن|حابه أطمن|حابة أطمن|حبيت اطمن|حبيت أطمن|بنطمن|نطمن علي|نطمن على|اخبار حضرتك|أخبار حضرتك|بقيت|بقت|عامل ايه|عامله ايه|الدوا جاب نتيجه|العلاج جاب نتيجه)/i;
const IMPROVED_RX = /(احسن|أحسن|كويس|كويسه|كويسة|الحمدلله|الحمد لله|اتحسن|اتحسنت|تحسن|خف|خفت|تمام دلوقتي|بقيت كويس|بقيت\s+(?:افضل|أفضل))/i;
const WORSE_RX = /(لسه تعبان|لسه تعبانه|اسوء|أسوأ|زادت|زاد الوجع|مفيش تحسن|مافيش تحسن|زي ما هو|زي ماهو)/i;
const FOLLOWUP_PROMISE_RX = /(هتابع|هتواصل|هبلغ|هرجع|هنرجع|اول ما|أول ما|لما يتوفر|هنوفره|هطلبه|هطلبها)/i;
const CLOSE_RX = /(تم تأكيد|تم التاكيد|الأوردر اتأكد|الاوردر اتاكد|تم الارسال|تم الإرسال|جاري الارسال|جاري الإرسال|خرج لحضرتك|فاتوره|فاتورة|الاجمالي|الإجمالي)/i;
const URGENT_RX = /(ضروري|عاجل|حالاً|حالا|مستعجل|مستعجله)/i;
const ANAPHORIC_COMMIT_RX = /(^|\s)(هحتاجه|هحتاجها|هاخده|هاخدها)(\s|$)/i;
const PRODUCT_TYPE_NAMED_RX = /^(?:مزيل)\s+([\p{L}\p{N}][\p{L}\p{N} .+-]{1,60})$/iu;

function evidenceFor(session: WhatsAppConversationSession, rx: RegExp, confidence: number): WhatsAppEvidence {
  const matches = session.messages.filter((m) => rx.test(m.text));
  return { messageIds: matches.map((m) => m.id).slice(0, 10), quote: matches[0]?.text?.slice(0, 180) || '', confidence };
}

function complaintMessages(session: WhatsAppConversationSession) {
  return session.messages.filter((message) =>
    message.direction === 'inbound' &&
    COMPLAINT_RX.test(message.text || '') &&
    !NEGATED_COMPLAINT_RX.test(message.text || '')
  );
}

function fulfillmentFailureMessages(session: WhatsAppConversationSession) {
  return session.messages.filter((message) => FULFILLMENT_FAILURE_RX.test(message.text || ''));
}

function evidenceFromMessages(messages: WhatsAppParsedMessage[], confidence: number): WhatsAppEvidence {
  return {
    messageIds: messages.map((message) => message.id).slice(0, 10),
    quote: messages[0]?.text?.slice(0, 180) || '',
    confidence,
  };
}

function firstMeaningful(session: WhatsAppConversationSession) {
  return session.messages.find((m) => m.direction !== 'system' && m.text.trim().length > 0) || null;
}

function classifyIntents(session: WhatsAppConversationSession) {
  const inbound = text(byDirection(session, 'inbound'));
  const outbound = text(byDirection(session, 'outbound'));
  const all = `${inbound}\n${outbound}`;
  const scored: Array<[WhatsAppPrimaryIntent, number]> = [];
  const add = (intent: WhatsAppPrimaryIntent, score: number) => scored.push([intent, score]);
  const complaintRows = complaintMessages(session);
  const fulfillmentFailures = fulfillmentFailureMessages(session);
  if (complaintRows.length) add('complaint', 98);
  if (fulfillmentFailures.length) add('delivery_issue', 99);
  else if (has(all, DELIVERY_RX) && has(all, /(ماوصلش|موصلش|مندوب|توصيل|العنوان)/i)) add('delivery_issue', has(all, /(ماوصلش|موصلش|متاخر|متأخر)/i) ? 96 : 72);
  if (has(outbound, CHECKIN_OUT_RX)) add('proactive_checkin', 96);
  if (has(inbound, CUSTOMER_REQUEST_INTENT_RX)) add('customer_request', 91);
  if (has(inbound, PRODUCT_INQUIRY_RX)) add('product_inquiry', 84);
  if (has(outbound, RECOMMEND_RX)) add('doctor_recommendation', 92);
  if (has(inbound, RECOMMENDATION_REQUEST_RX)) add('doctor_recommendation', 94);
  if (has(all, MEDICAL_RX)) add('medical_consultation', 78);
  if (!has(outbound, CHECKIN_OUT_RX) && has(inbound, IMPROVED_RX) && session.messages.length <= 8) add('followup_response', 86);
  if (!scored.length) add('general_service', 55);
  scored.sort((a, b) => b[1] - a[1]);
  return { primary: scored[0][0], confidence: scored[0][1], secondary: uniq(scored.slice(1).filter(([,s]) => s >= 70).map(([i]) => i)) };
}

const GENERIC_NON_PRODUCT_RX =
  /^(?:ان شاء الله|إن شاء الله|تصوريها|صوريها|صورها|ي الرقم|الرقم|حاضر|تمام|ماشي|اه|ايوه|لا|شكرا|شكراً|لحظه|لحظة|دقيقه|دقيقة)$/i;
const SERVICE_SENTENCE_RX =
  /(?:تحت أمر|صيدليات دواء|خدمة التوصيل|الشركة المنتجة|هنحاول نوفر|هبلغ حضرتك|تصرفهوله|يقلل الاعراض)/i;
const DOSAGE_FOLLOWUP_RX =
  /^(?:\s*)(?:امبول|أمبول|امبولات|أمبولات|شريط|شرايط|علبه|علبة|علب|كريم|جل|شراب|بخاخ|بخاخه|قطره|قطرة|كبسول|كبسوله|كبسولة|اقراص|أقراص|قرص)(?:\s+.*)?$/i;

function replaceStandaloneToken(value: string, token: string) {
  const escaped = token.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return value.replace(new RegExp('(?<![\\p{L}\\p{N}])' + escaped + '(?![\\p{L}\\p{N}])', 'giu'), ' ');
}

function cleanProductPhrase(raw: string) {
  let value = raw.replace(/https?:\/\/\S+/g, ' ');
  const removable = ['لو سمحت','من فضلك','يا فندم','حضرتك','عندكم','موجود','متوفر','بكام','كام','ممكن','لوسمحت'];
  for (const token of removable) value = replaceStandaloneToken(value, token);
  value = value.replace(/[؟?!،,;:]/g, ' ').replace(/\s+/g, ' ').trim();
  const stop = value.search(/(?<![\p{L}\p{N}])(?:علشان|عشان|لان|لأن|بس|وكمان|و\s+كمان|لو|اذا|إذا)(?![\p{L}\p{N}])/iu);
  if (stop > 1) value = value.slice(0, stop).trim();
  value = value.split(/\s+/).filter(Boolean).slice(0, 10).join(' ').trim();
  value = value.replace(/^(?:عايزه|عاوزه|محتاجه|عايز|عاوز|محتاج|هات|ابعت|ابعث)\s+/i, '').trim();
  value = value.replace(/^[هة]\s+(?=[\p{L}\p{N}])/u, '').trim();
  value = value.replace(/\s+(?:تقريبا|تقريباً|ضروري+|جدا|جدًا)$/i, '').trim();
  if (value.length < 2) return '';
  if (/^(?:حاجه|حاجة|دواء|دوا|علاج|صنف|منتج|ده|دي|دول|منه|منها|علبه|علبة|شريط|باكيت|كيس|امبول|أمبول)$/i.test(value)) return '';
  if (/^(?:واحد|واحده|واحدة)\s+من\s+(?:ده|دا|دي)$/i.test(value)) return '';
  if (/^(?:اشوف|أشوف)\s+شكل|^يطلع\s+منه|^اعرف\s+مكان|^يجيلي\s+عند|^بعد\s+اذنك$|^استشاره\s+صغيره|^استشارة\s+صغيرة|^لحضرتك\s+الاسكرينه|^هم\s+تحويل|^بالظبط$|^عليه$|^شكله$|^يهم$|^يكون\s+فيه$/i.test(value)) return '';
  if (/^(?:نفس\s+)?(?:ده|دا|دي|العلبه\s+دي|العلبة\s+دي)$/i.test(value)) return '';
  if (GENERIC_NON_PRODUCT_RX.test(value) || SERVICE_SENTENCE_RX.test(value)) return '';
  return value;
}

function plausibleProductPhrase(value: string) {
  const cleaned = cleanProductPhrase(value);
  if (!cleaned) return false;
  if (cleaned.split(/\s+/).length > 9) return false;
  return /[A-Za-z]{3,}|[\u0600-\u06ff]{3,}/.test(cleaned);
}
function extractAfterTrigger(message: WhatsAppParsedMessage, rx: RegExp) {
  const match = message.text.match(rx);
  if (!match || match.index == null) return '';
  const tail = cleanProductPhrase(message.text.slice(match.index + match[0].length).trim());
  if (tail) return tail;

  // Availability/price questions often put the trigger at the END:
  // "بامبرز ... مقاس ٤ موجود؟" / "قطرة ... بكام؟".
  // In that structure the product phrase is before the trigger, not after it.
  const head = cleanProductPhrase(message.text.slice(0, match.index).trim());
  return head;
}

function quantityFrom(textValue: string) {
  const match = textValue.match(/(?:عدد|عايز|عاوز|محتاج|هات|ابعت)?\s*(\d{1,3})\s*(?:علبه|علبة|علب|شريط|شرايط|قطعه|قطعة|عبوه|عبوة)?/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 && value <= 100 ? value : null;
}

function extractProducts(session: WhatsAppConversationSession): WhatsAppProductSignal[] {
  const found: WhatsAppProductSignal[] = [];
  for (const message of session.messages) {
    if (message.direction === 'system' || message.kind !== 'text') continue;
    const infoOnlyInquiry = message.direction === 'inbound' && INFO_ONLY_PRODUCT_INQUIRY_RX.test(message.text);
    const isRequest = message.direction === 'inbound' && REQUEST_RX.test(message.text) && !infoOnlyInquiry;
    const isRecommendation = message.direction === 'outbound' && RECOMMEND_RX.test(message.text);
    const typedNamedProduct = message.direction === 'inbound' ? message.text.trim().match(PRODUCT_TYPE_NAMED_RX) : null;
    if (message.direction === 'inbound' && ANAPHORIC_COMMIT_RX.test(message.text)) continue;
    if (
      message.direction === 'inbound' &&
      /(?:الدليفري|التوصيل|المندوب)/i.test(message.text) &&
      /(?:بالقطره|بالقطرة|بقطره|بقطرة)/i.test(message.text) &&
      !/(?:اسم|نوع|ماركه|ماركة)\s+(?:ال)?قطر[هة]/i.test(message.text)
    ) continue;
    const trigger = isRecommendation ? RECOMMEND_RX : isRequest ? REQUEST_RX : PRODUCT_INQUIRY_RX.test(message.text) ? PRODUCT_INQUIRY_RX : null;
    if (!trigger && !typedNamedProduct) continue;
    let rawName = typedNamedProduct?.[1]?.trim() || (trigger ? extractAfterTrigger(message, trigger) : '');
    if (infoOnlyInquiry && /(?:ال)?منتج\s+(?:ده|دا|دي|هذا|هذه)/i.test(message.text)) rawName = '';
    let explicitNamedRecommendation = false;
    if (isRecommendation) {
      const explicitNamedProduct = message.text.match(/(?:اسمه|اسمها)\s+([A-Za-z][A-Za-z0-9.+-]*(?:\s+[A-Za-z][A-Za-z0-9.+-]*){0,3})/i);
      if (explicitNamedProduct?.[1]) {
        rawName = explicitNamedProduct[1].trim();
        explicitNamedRecommendation = true;
      } else if (/(?:حاجه|حاجة|حاحه|حاحة)\s+زيها/i.test(message.text)) {
        rawName = '';
      }
    }
    if (!rawName) continue;

    if (message.direction === 'inbound' && isRequest) {
      const messageIndex = session.messages.findIndex((row) => row.id === message.id);
      const next = session.messages[messageIndex + 1];
      if (
        next &&
        next.direction === 'inbound' &&
        next.kind === 'text' &&
        next.timestamp.getTime() >= message.timestamp.getTime() &&
        next.timestamp.getTime() - message.timestamp.getTime() <= 2 * 60 * 1000 &&
        DOSAGE_FOLLOWUP_RX.test(next.text.trim())
      ) {
        rawName = cleanProductPhrase(rawName + ' ' + next.text) || rawName;
      }
    }
    if (!plausibleProductPhrase(rawName)) continue;

    let status: WhatsAppProductSignal['status'] = isRecommendation ? 'recommended' : isRequest ? 'requested' : 'mentioned';
    // Stock unavailability is a pharmacy-side fact. An inbound question like "مش موجود عندكم؟"
    // must stay a customer request/inquiry and never become stock_unavailable on its own.
    if (message.direction === 'outbound' && /(مش موجود|غير متوفر|ناقص)/i.test(message.text)) status = 'unavailable';
    found.push({ rawName, normalizedName: normalize(rawName), quantity: quantityFrom(message.text), status, sourceDirection: message.direction, evidenceMessageIds: [message.id], confidence: explicitNamedRecommendation ? 92 : typedNamedProduct ? 90 : isRecommendation ? 82 : isRequest ? 80 : 64 });
  }
  // Resolve a short customer pronoun commitment (e.g. "هحتاجه") back to the
  // most recent explicit inbound product mention in the same session.
  for (let index = 0; index < session.messages.length; index += 1) {
    const message = session.messages[index];
    if (
      message.direction !== 'inbound' ||
      !ANAPHORIC_COMMIT_RX.test(message.text)
    ) continue;

    const previousProduct = [...found].reverse().find((item) => {
      if (item.sourceDirection !== 'inbound') return false;
      const evidenceIndex = session.messages.findIndex((row) => item.evidenceMessageIds.includes(row.id));
      return evidenceIndex >= 0 && evidenceIndex < index;
    });
    if (previousProduct) {
      previousProduct.status = 'requested';
      previousProduct.confidence = Math.max(previousProduct.confidence, 88);
      previousProduct.evidenceMessageIds = uniq([...previousProduct.evidenceMessageIds, message.id]);
    }
  }

  const merged = new Map<string, WhatsAppProductSignal>();
  for (const item of found) {
    const key = item.normalizedName;
    const previous = merged.get(key);
    if (!previous || item.confidence > previous.confidence) merged.set(key, item);
    else previous.evidenceMessageIds = uniq([...previous.evidenceMessageIds, ...item.evidenceMessageIds]);
  }
  return [...merged.values()].slice(0, 12);
}

function recommendations(session: WhatsAppConversationSession, products: WhatsAppProductSignal[]): WhatsAppRecommendationSignal[] {
  const outbound = byDirection(session, 'outbound');
  const inbound = text(byDirection(session, 'inbound'));
  const requestedRecommendation = RECOMMENDATION_REQUEST_RX.test(inbound);
  const mediaRecommendationMessages = requestedRecommendation
    ? outbound.filter((m) =>
        Boolean(m.mediaPlaceholder || m.kind === 'image') &&
        /(\b\d{2,5}\b|كبسول|كبسوله|كبسولة|عبوه|عبوة|كورس|مستورد)/i.test(m.text)
      )
    : [];
  const recMessages = uniq([
    ...outbound.filter((m) => RECOMMEND_RX.test(m.text)),
    ...mediaRecommendationMessages,
  ]);
  return recMessages.map((message) => {
    const product = products.find((p) => p.status === 'recommended' && p.evidenceMessageIds.includes(message.id));
    const index = session.messages.findIndex((m) => m.id === message.id);
    const laterInbound = session.messages.slice(index + 1).filter((m) => m.direction === 'inbound').slice(0, 3);
    const acceptedMsg = laterInbound.find((m) => ACCEPT_RX.test(m.text));
    const rejectedMsg = laterInbound.find((m) => REJECT_RX.test(m.text));
    const accepted = acceptedMsg ? true : rejectedMsg ? false : null;
    return {
      productName: product?.rawName || null,
      accepted,
      rejected: Boolean(rejectedMsg),
      doctorName: session.outboundStaffNames[0] || null,
      evidenceMessageIds: uniq([message.id, ...(acceptedMsg ? [acceptedMsg.id] : []), ...(rejectedMsg ? [rejectedMsg.id] : [])]),
      confidence: acceptedMsg || rejectedMsg ? 90 : 72,
    };
  });
}

export function buildWhatsAppOperationalIntelligenceV6(session: WhatsAppConversationSession, base: UnifiedConversationIntelligence): WhatsAppOperationalIntelligenceV6 {
  const first = firstMeaningful(session);
  const initiator: WhatsAppInitiator = first?.direction === 'inbound' ? 'customer' : first?.direction === 'outbound' ? 'pharmacy' : 'unknown';
  const intents = classifyIntents(session);
  const all = text(session.messages);
  const inbound = text(byDirection(session, 'inbound'));
  const outbound = text(byDirection(session, 'outbound'));
  const products = extractProducts(session);
  const recs = recommendations(session, products);
  const acceptedRecommendation = recs.some((r) => r.accepted === true);
  const rejected = has(inbound, REJECT_RX);
  const close = has(all, CLOSE_RX);
  const complaintRows = complaintMessages(session);
  const complaint = complaintRows.length > 0;
  const fulfillmentFailures = fulfillmentFailureMessages(session);
  const fulfillmentFailure = fulfillmentFailures.length > 0;
  const recovered = has(outbound, RECOVERY_RX);
  const positiveCheckinFeedback = intents.primary === 'proactive_checkin' && has(inbound, POSITIVE_SERVICE_FEEDBACK_RX);
  const state: WhatsAppOperationalIntelligenceV6['customerState'] = positiveCheckinFeedback ? 'improved' : has(inbound, IMPROVED_RX) ? 'improved' : has(inbound, WORSE_RX) ? 'worse' : 'unknown';

  const requests: WhatsAppRequestSignal[] = products
    .filter((p) => ['requested','unavailable'].includes(p.status) && p.sourceDirection === 'inbound')
    .map((p) => ({ productName: p.rawName, quantity: p.quantity, urgency: has(inbound, URGENT_RX) ? 'urgent' : 'normal', unresolved: !close && !rejected, evidenceMessageIds: p.evidenceMessageIds, confidence: p.confidence }));

  let operationalOutcome: WhatsAppOperationalOutcome = 'unknown';
  if (fulfillmentFailure) operationalOutcome = 'unresolved_request';
  else if (complaint) operationalOutcome = recovered ? 'complaint_resolved' : 'complaint_unresolved';
  else if (intents.primary === 'proactive_checkin' || intents.primary === 'followup_response') operationalOutcome = state === 'improved' ? 'checkin_complete' : state === 'worse' ? 'needs_followup' : 'unknown';
  else if (rejected) operationalOutcome = 'no_sale';
  else if (close && (intents.primary === 'customer_request' || base.commercialEligible || acceptedRecommendation)) operationalOutcome = 'probable_sale';
  else if (requests.some((r) => r.unresolved)) operationalOutcome = 'unresolved_request';
  else if (acceptedRecommendation) operationalOutcome = 'needs_followup';
  else if (intents.primary === 'medical_consultation') operationalOutcome = 'consultation_only';
  else if (base.followupRequired || has(outbound, FOLLOWUP_PROMISE_RX)) operationalOutcome = 'needs_followup';

  let followupRequired = base.followupRequired;
  let followupReason: string | null = base.suggestedFollowupReason || null;
  let dueInDays: number | null = null;
  let priority: WhatsAppFollowupPlan['priority'] = base.priority === 'urgent' ? 'urgent' : base.priority === 'important' ? 'important' : 'normal';
  let followupEvidence: string[] = [];
  if (operationalOutcome === 'complaint_unresolved') { followupRequired = true; followupReason = 'شكوى لم يظهر لها حل نهائي واضح.'; dueInDays = 0; priority = 'urgent'; followupEvidence = complaintRows.map((message) => message.id).slice(0, 10); }
  else if (fulfillmentFailure) { followupRequired = true; followupReason = 'تعثر تنفيذ/توصيل مثبت من المحادثة ولم يظهر إتمام نهائي للطلب.'; dueInDays = 0; priority = 'urgent'; followupEvidence = fulfillmentFailures.map((message) => message.id).slice(0, 10); }
  else if (operationalOutcome === 'unresolved_request') { followupRequired = true; followupReason = 'طلب عميل لم يظهر له إغلاق بيع أو رفض صريح.'; dueInDays = 1; priority = has(all, URGENT_RX) ? 'urgent' : 'important'; followupEvidence = requests.flatMap((r) => r.evidenceMessageIds); }
  else if (acceptedRecommendation) { followupRequired = true; followupReason = 'العميل وافق على ترشيح من الدكتور ويستحق متابعة النتيجة بعد الاستخدام.'; dueInDays = 3; priority = 'important'; followupEvidence = recs.filter((r) => r.accepted).flatMap((r) => r.evidenceMessageIds); }
  else if (state === 'worse') { followupRequired = true; followupReason = 'العميل أفاد بعدم التحسن/تدهور الحالة ويحتاج متابعة.'; dueInDays = 0; priority = 'important'; followupEvidence = ids(session.messages, WORSE_RX); }
  else if (operationalOutcome === 'checkin_complete') { followupRequired = false; followupReason = null; dueInDays = null; followupEvidence = ids(session.messages, IMPROVED_RX); }

  const missingStaff = session.messages.some((m) => m.direction === 'outbound') && session.outboundStaffNames.length === 0;
  const messageCount = session.messages.length;
  const missingMediaCount = Number(
    session.missingMediaCount ??
    session.messages.filter((m) => m.mediaPlaceholder && !m.mediaAvailable).length
  );
  const evaluationCoverage = Math.max(0, Math.min(100,
    (messageCount >= 15 ? 92 : messageCount >= 10 ? 84 : messageCount >= 6 ? 72 : messageCount >= 4 ? 58 : messageCount >= 2 ? 38 : 24)
    - (session.outboundStaffNames.length ? 0 : 8)
    - Math.min(30, missingMediaCount * 8)
  ));
  const intentConfidence = Math.min(intents.confidence, Math.max(45, evaluationCoverage + 15));
  const outcomeConfidence = Math.min(close || rejected || recovered || state !== 'unknown' ? 92 : 76, Math.max(40, evaluationCoverage + 18));
  const officialScoringEligible = evaluationCoverage >= 65 && base.confidence >= 70 && !missingStaff && missingMediaCount === 0;

  let nextBestAction = 'مراجعة بشرية سريعة ثم إغلاق الجلسة.';
  if (fulfillmentFailure) nextBestAction = 'تصعيد تعثر التنفيذ ومتابعة إرسال الطلب أو حسمه مع العميل فورًا.';
  else if (operationalOutcome === 'complaint_unresolved') nextBestAction = 'تصعيد فوري لخدمة العملاء ومتابعة حل الشكوى.';
  else if (requests.some((r) => r.unresolved)) nextBestAction = 'تسجيل طلب العميل وربطه بالصنف ثم متابعة التوفر/الإغلاق.';
  else if (acceptedRecommendation) nextBestAction = 'إنشاء متابعة لخدمة العملاء على الترشيح بعد الاستخدام.';
  else if (operationalOutcome === 'probable_sale') nextBestAction = 'مطابقة الفاتورة؛ لا يُعتبر البيع مؤكدًا إلا بعد تطابق فاتورة فعلية.';
  else if (operationalOutcome === 'checkin_complete') nextBestAction = 'إغلاق متابعة الاطمئنان دون تقييم بيعي.';
  else if (operationalOutcome === 'consultation_only') nextBestAction = 'مراجعة جودة الاستشارة والأمان الطبي دون افتراض بيع.';

  return {
    version: 'whatsapp-operational-v6', primaryIntent: intents.primary, secondaryIntents: intents.secondary, initiator,
    operationalOutcome, customerState: state, products, customerRequests: requests, recommendations: recs,
    followupPlan: { required: followupRequired, reason: followupReason, ownerRole: followupRequired ? 'team_dawaa_alpha' : null, dueInDays, priority, evidenceMessageIds: uniq(followupEvidence) },
    nextBestAction, officialScoringEligible, intentConfidence, outcomeConfidence,
    evidence: {
      request: evidenceFor({ ...session, messages: byDirection(session, 'inbound') }, CUSTOMER_REQUEST_INTENT_RX, 85), recommendation: evidenceFor(session, RECOMMEND_RX, 88),
      complaint: evidenceFromMessages(complaintRows, 95),
      deliveryFailure: evidenceFromMessages(fulfillmentFailures, 96),
      checkin: evidenceFor(session, CHECKIN_OUT_RX, 94),
      saleClose: evidenceFor(session, CLOSE_RX, 88),
      stockUnavailable: evidenceFor({ ...session, messages: byDirection(session, 'outbound') }, /(مش موجود|غير موجود|غير متوفر(?:ه|ة)?|مش متوفر(?:ه|ة)?|ناقص|مش متاح|خلص|مش عندنا)/i, 92),
      alternativeOffered: evidenceFor({ ...session, messages: byDirection(session, 'outbound') }, /(بديل|بداله|بدلها|ممكن بدل|نرشح|ارشح|أرشح|حاجه\s+زيها|حاجة\s+زيها|حاحه\s+زيها|حاحة\s+زيها)/i, 88),
      customerState: positiveCheckinFeedback
        ? evidenceFor({ ...session, messages: byDirection(session, 'inbound') }, POSITIVE_SERVICE_FEEDBACK_RX, 90)
        : evidenceFor({ ...session, messages: byDirection(session, 'inbound') }, state === 'worse' ? WORSE_RX : IMPROVED_RX, state === 'unknown' ? 0 : 88),
    },
  };
}

async function searchProductCandidates(raw: string): Promise<RawProductRow[]> {
  const normalized = normalizePharmacyText(raw).normalized;
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 3 && !/^\d+(?:\.\d+)?$/.test(token)).slice(0, 5);
  const byId = new Map<string, RawProductRow>();

  // Exact/near-exact name first.
  const { data: exactRows } = await supabase
    .from('products')
    .select('id,name,product_code,normalized_name,category,price,source')
    .ilike('normalized_name', `%${normalized}%`)
    .limit(80);
  for (const row of exactRows || []) byId.set(String(row.id), row as RawProductRow);

  // Arabic/English seed discovery. Candidate retrieval may broaden, but the resolver still
  // applies its ambiguity, form and strength safety rules before selecting a catalog item.
  for (const [arabicKey, latinToken] of CROSS_SCRIPT_SEED) {
    const normalizedArabicKey = normalizePharmacyText(arabicKey).normalized;
    if (!normalized.includes(normalizedArabicKey)) continue;
    const { data } = await supabase
      .from('products')
      .select('id,name,product_code,normalized_name,category,price,source')
      .ilike('normalized_name', '%' + normalizePharmacyText(latinToken).normalized + '%')
      .limit(120);
    for (const row of data || []) byId.set(String(row.id), row as RawProductRow);
  }

  // Joined-brand discovery: WhatsApp users often write catalog words without spaces
  // ("teenderm" vs "teen derm"). Split only long tokens, and require BOTH halves in the
  // catalog candidate row. This broadens retrieval but does not bypass resolver safety.
  for (const token of tokens.filter((value) => value.length >= 7)) {
    for (let i = 3; i <= token.length - 3; i += 1) {
      const left = token.slice(0, i);
      const right = token.slice(i);
      const { data } = await supabase
        .from('products')
        .select('id,name,product_code,normalized_name,category,price,source')
        .ilike('normalized_name', `%${left}%`)
        .ilike('normalized_name', `%${right}%`)
        .limit(40);
      for (const row of data || []) byId.set(String(row.id), row as RawProductRow);
    }
  }

  // Then token-based discovery. This is only candidate retrieval; the canonical resolver decides.
  for (const token of tokens) {
    const { data } = await supabase
      .from('products')
      .select('id,name,product_code,normalized_name,category,price,source')
      .ilike('normalized_name', `%${token}%`)
      .limit(120);
    for (const row of data || []) byId.set(String(row.id), row as RawProductRow);
  }

  return [...byId.values()];
}

async function resolveProduct(product: WhatsAppProductSignal) {
  const raw = product.rawName.replace(/[,%()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (raw.length < 2) return product;

  const rows = await searchProductCandidates(raw);
  if (!rows.length) return product;

  const counts = countNormalizedNames(rows);
  const catalog = rows.map((row) => buildCanonicalProduct(row, counts, normalizePharmacyText));
  const result = resolveProductMention(raw, buildPharmacyProductIndex(catalog));
  const selected = result.selected;

  if (!selected) return product;
  return {
    ...product,
    productId: selected.product.productId,
    productCode: selected.product.productCode,
    canonicalName: selected.product.canonicalName,
    catalogConfidence: selected.confidence,
    confidence: Math.min(
      98,
      Math.max(
        product.confidence,
        selected.confidence === 'proven' ? 98 :
        selected.confidence === 'strongly_inferred' ? 92 :
        selected.confidence === 'weakly_inferred' ? 72 : product.confidence
      )
    ),
  };
}

function candidateFragmentsFromMessage(textValue: string) {
  const base = textValue
    .replace(/^\s*\[Forwarded\]\s*/i, ' ')
    .replace(/<[^>]+omitted>/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return [];

  const fragments = [base];

  const forwardedNamedProduct = base.match(/^(.{3,120}?)\s+(?:بديل\s+(?:الغسول|الصنف|المنتج)|لو\s+(?:موجود|متوفر))/i);
  if (forwardedNamedProduct?.[1]) {
    const named = cleanProductPhrase(forwardedNamedProduct[1].replace(/^\s*و\s*/u, '').trim());
    if (named) fragments.push(named);
  }

  const leadingRequestStripped = cleanProductPhrase(
    base.replace(/^(?:لو\s*سمحت\s*)?(?:عايزه|عاوزه|عايز|عاوز|محتاجه|محتاج|ممكن)\s+/i, '')
  );
  if (leadingRequestStripped) fragments.push(leadingRequestStripped);

  // Conservative commercial separators. Each fragment still has to resolve strongly/proven
  // against the pharmacy catalog; weak/fuzzy-only matches are rejected.
  for (const part of base.split(/\s+(?:مع|و(?=[\p{L}\p{N}]))\s+/iu)) {
    const cleaned = cleanProductPhrase(part);
    if (cleaned && cleaned.length >= 3) fragments.push(cleaned);
  }
  return uniq(fragments.map((value) => value.trim()).filter((value) => value.length >= 3)).slice(0, 8);
}

async function discoverStrongCatalogMentions(session: WhatsAppConversationSession) {
  const discovered: WhatsAppProductSignal[] = [];
  for (const message of session.messages) {
    if (message.direction === 'system' || message.kind !== 'text') continue;
    if (message.text.length > 260) continue;

    for (const rawName of candidateFragmentsFromMessage(message.text)) {
      const seed: WhatsAppProductSignal = {
        rawName,
        normalizedName: normalize(rawName),
        quantity: quantityFrom(message.text),
        status: message.direction === 'outbound'
          ? 'recommended'
          : isDirectCommercialProductMessageV22(message)
            ? 'requested'
            : 'mentioned',
        sourceDirection: message.direction,
        evidenceMessageIds: [message.id],
        confidence: 72,
      };
      const resolved = await resolveProduct(seed);
      if (!resolved.productId || !resolved.productCode) continue;
      if (!['proven', 'strongly_inferred'].includes(String(resolved.catalogConfidence || ''))) continue;
      discovered.push(resolved);
    }
  }

  const byProduct = new Map<string, WhatsAppProductSignal>();
  for (const product of discovered) {
    const key = String(product.productId);
    const previous = byProduct.get(key);
    if (!previous || product.confidence > previous.confidence) byProduct.set(key, product);
    else previous.evidenceMessageIds = uniq([...previous.evidenceMessageIds, ...product.evidenceMessageIds]);
  }
  return [...byProduct.values()].slice(0, 12);
}

function isDeicticProductReference(value: string) {
  const normalized = normalize(value);
  return /(?:^|\s)(?:ده|دا|دي|دول)(?:\s|$)/i.test(normalized) ||
    /^(?:واحد|واحده|واحدة)\s+من\s+(?:ده|دا|دي)$/i.test(normalized) ||
    /^(?:نفس|زي)\s+(?:ده|دا|دي)$/i.test(normalized) ||
    /^(?:الغسول|العلبه|العلبة|الصنف|المنتج)\s+(?:ده|دا|دي)$/i.test(normalized);
}

export function mergeDeicticProductReferences(
  products: WhatsAppProductSignal[],
  session?: WhatsAppConversationSession
) {
  if (!session) return products;

  const messageIndex = new Map(session.messages.map((message, index) => [String(message.id), index]));
  const canonical = products.filter((product) => Boolean(product.productId && product.productCode));
  const suppressed = new Set<WhatsAppProductSignal>();

  for (const reference of products) {
    if (reference.productId || !isDeicticProductReference(reference.rawName)) continue;
    const refIndexes = reference.evidenceMessageIds
      .map((id) => messageIndex.get(String(id)))
      .filter((index): index is number => typeof index === 'number');
    if (!refIndexes.length) continue;

    const refIndex = Math.min(...refIndexes);
    const candidates = canonical
      .map((product) => {
        const indexes = product.evidenceMessageIds
          .map((id) => messageIndex.get(String(id)))
          .filter((index): index is number => typeof index === 'number' && index <= refIndex);
        if (!indexes.length) return null;
        const closest = Math.max(...indexes);
        return { product, distance: refIndex - closest };
      })
      .filter((row): row is { product: WhatsAppProductSignal; distance: number } => Boolean(row))
      .filter((row) => row.distance <= 4)
      .sort((a, b) => a.distance - b.distance || b.product.confidence - a.product.confidence);

    const target = candidates[0]?.product;
    if (!target) continue;
    target.evidenceMessageIds = uniq([...target.evidenceMessageIds, ...reference.evidenceMessageIds]);
    target.confidence = Math.max(target.confidence, reference.confidence);
    if (target.quantity == null && reference.quantity != null) target.quantity = reference.quantity;
    suppressed.add(reference);
  }

  return products.filter((product) => !suppressed.has(product));
}

export async function enrichWhatsAppOperationalProductsV6(
  model: WhatsAppOperationalIntelligenceV6,
  session?: WhatsAppConversationSession
): Promise<WhatsAppOperationalIntelligenceV6> {
  const resolvedProducts = await Promise.all(model.products.map(resolveProduct));
  const discovered = session ? await discoverStrongCatalogMentions(session) : [];
  const merged = new Map<string, WhatsAppProductSignal>();

  for (const product of [...resolvedProducts, ...discovered]) {
    const key = product.productId ? 'id:' + product.productId : 'text:' + product.normalizedName;
    const previous = merged.get(key);
    if (!previous || product.confidence > previous.confidence) merged.set(key, product);
    else previous.evidenceMessageIds = uniq([...previous.evidenceMessageIds, ...product.evidenceMessageIds]);
  }

  const products = mergeDeicticProductReferences(
    [...merged.values()].filter((product) =>
      Boolean(product.productId) ||
      (
        product.sourceDirection === 'inbound' &&
        (
          ['requested', 'unavailable'].includes(product.status) ||
          (product.status === 'mentioned' && product.confidence >= 90)
        ) &&
        plausibleProductPhrase(product.rawName)
      ) ||
      (
        product.sourceDirection === 'outbound' &&
        product.status === 'recommended' &&
        product.confidence >= 90 &&
        plausibleProductPhrase(product.rawName)
      )
    ),
    session
  );

  const customerRequests = model.customerRequests
    .map((r) => {
      const linked = products.find((p) =>
        p.rawName === r.productName ||
        p.evidenceMessageIds.some((id) => r.evidenceMessageIds.includes(id))
      );
      return linked
        ? {
            ...r,
            productName: linked.canonicalName || linked.rawName,
            evidenceMessageIds: uniq([...r.evidenceMessageIds, ...linked.evidenceMessageIds]),
            confidence: Math.max(r.confidence, linked.confidence),
          }
        : r;
    })
    .filter((request, index, rows) =>
      rows.findIndex((row) =>
        normalize(row.productName || '') === normalize(request.productName || '') &&
        row.evidenceMessageIds.some((id) => request.evidenceMessageIds.includes(id))
      ) === index
    );

  // Strong catalog discovery can recover a direct product request that the trigger-based
  // extractor could not see (for example a short forwarded product name). Promote ONLY products
  // already classified as requested by the conservative direct-commercial guard above.
  for (const product of products) {
    if (product.sourceDirection !== 'inbound' || product.status !== 'requested') continue;
    if (customerRequests.some((request) =>
      request.evidenceMessageIds.some((id) => product.evidenceMessageIds.includes(id))
    )) continue;
    customerRequests.push({
      productName: product.canonicalName || product.rawName,
      quantity: product.quantity,
      urgency: 'normal',
      unresolved: true,
      evidenceMessageIds: product.evidenceMessageIds,
      confidence: Math.max(72, product.confidence),
    });
  }

  const recoveredDirectRequest = customerRequests.some((request) =>
    request.unresolved && request.confidence >= 72
  );
  const canPromoteRecoveredRequest =
    recoveredDirectRequest &&
    ['general_service', 'product_inquiry', 'other'].includes(model.primaryIntent) &&
    ['unknown', 'unresolved_request'].includes(model.operationalOutcome);

  const recommendations = model.recommendations.map((r) => {
    const linked = products.find((p) =>
      p.rawName === r.productName ||
      p.evidenceMessageIds.some((id) => r.evidenceMessageIds.includes(id))
    );
    return { ...r, productName: linked?.canonicalName || r.productName };
  });
  return {
    ...model,
    primaryIntent: canPromoteRecoveredRequest ? 'customer_request' : model.primaryIntent,
    operationalOutcome: canPromoteRecoveredRequest ? 'unresolved_request' : model.operationalOutcome,
    followupPlan: canPromoteRecoveredRequest
      ? {
          required: true,
          reason: 'تم استعادة طلب صنف مباشر من رسالة تجارية وربطه بالكتالوج، ولم يظهر له إغلاق واضح.',
          ownerRole: 'team_dawaa_alpha',
          dueInDays: 1,
          priority: 'important',
          evidenceMessageIds: uniq(customerRequests.filter((request) => request.unresolved).flatMap((request) => request.evidenceMessageIds)),
        }
      : model.followupPlan,
    nextBestAction: canPromoteRecoveredRequest
      ? 'تسجيل طلب العميل وربطه بالصنف ثم متابعة التوفر/الإغلاق.'
      : model.nextBestAction,
    products,
    customerRequests,
    recommendations,
  };
}

function dueIso(days: number | null) {
  if (days == null) return null;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export async function syncWhatsAppOperationalActionsV6(model: WhatsAppOperationalIntelligenceV6, context: WhatsAppOperationalContext) {
  const actions: any[] = [];
  for (let i = 0; i < model.customerRequests.length; i += 1) {
    const request = model.customerRequests[i];
    if (!request.unresolved || request.confidence < 70) continue;
    const product = model.products.find((p) => p.rawName === request.productName || p.canonicalName === request.productName);
    actions.push({ action_key: `request:${i}:${normalize(request.productName || 'unknown')}`, action_type: 'customer_request', status: request.confidence >= 82 && context.customerId && product?.productId ? 'ready' : 'proposed', confidence: request.confidence, auto_eligible: Boolean(request.confidence >= 82 && context.customerId && product?.productId), product_id: product?.productId || null, product_code: product?.productCode || null, product_name: product?.canonicalName || request.productName, quantity: request.quantity, due_at: dueIso(request.urgency === 'urgent' ? 0 : 1), reason: 'طلب عميل مستخرج من محادثة واتساب ولم يظهر له إغلاق واضح.', evidence: request.evidenceMessageIds, payload: request });
  }
  const accepted = model.recommendations.filter((r) => r.accepted === true);
  for (let i = 0; i < accepted.length; i += 1) {
    const rec = accepted[i];
    const product = model.products.find((p) => p.rawName === rec.productName || p.canonicalName === rec.productName);
    actions.push({ action_key: `recommendation-followup:${i}:${normalize(rec.productName || 'unknown')}`, action_type: 'recommendation_followup', status: context.customerCode ? 'ready' : 'proposed', confidence: rec.confidence, auto_eligible: Boolean(context.customerCode && rec.confidence >= 85), product_id: product?.productId || null, product_code: product?.productCode || null, product_name: product?.canonicalName || rec.productName, due_at: dueIso(model.followupPlan.dueInDays ?? 3), reason: 'العميل وافق على ترشيح من الدكتور؛ متابعة النتيجة بعد الاستخدام.', evidence: rec.evidenceMessageIds, payload: rec });
  }
  if (model.operationalOutcome === 'complaint_unresolved') {
    actions.push({ action_key: 'complaint-followup', action_type: 'complaint_followup', status: context.customerCode ? 'ready' : 'proposed', confidence: model.outcomeConfidence, auto_eligible: Boolean(context.customerCode), due_at: dueIso(0), reason: 'شكوى غير محسومة تحتاج تدخل خدمة العملاء.', evidence: model.evidence.complaint.messageIds, payload: { nextBestAction: model.nextBestAction } });
  } else if (model.followupPlan.required && !accepted.length && !model.customerRequests.some((r) => r.unresolved)) {
    actions.push({ action_key: 'customer-followup', action_type: 'customer_followup', status: context.customerCode ? 'ready' : 'proposed', confidence: model.outcomeConfidence, auto_eligible: Boolean(context.customerCode && model.outcomeConfidence >= 80), due_at: dueIso(model.followupPlan.dueInDays ?? 1), reason: model.followupPlan.reason, evidence: model.followupPlan.evidenceMessageIds, payload: model.followupPlan });
  }
  if (!model.officialScoringEligible) {
    actions.push({ action_key: 'manual-review', action_type: 'manual_review', status: 'proposed', confidence: Math.min(model.intentConfidence, model.outcomeConfidence), auto_eligible: false, due_at: null, reason: 'السياق أو هوية الدكتور لا يكفيان لاعتماد تقييم رسمي آليًا.', evidence: [], payload: { primaryIntent: model.primaryIntent, operationalOutcome: model.operationalOutcome } });
  }
  if (!actions.length) return [];
  const rows = actions.map((a) => ({
    ...a,
    confidence: Number.isFinite(Number(a.confidence)) ? Math.max(0, Math.min(100, Number(a.confidence))) : 0,
    source_id: context.sourceId,
    branch: context.branch || null,
    customer_id: context.customerId || null,
    customer_code: context.customerCode || null,
    customer_name: context.customerName || null,
    customer_phone: context.customerPhone || null,
    staff_id: context.staffId || null,
    staff_name: context.staffName || null,
    created_by: context.createdBy || null,
    updated_at: new Date().toISOString(),
  }));
  const { data, error } = await supabase.from('whatsapp_conversation_actions').upsert(rows, { onConflict: 'source_id,action_key', ignoreDuplicates: false }).select('id,action_key,action_type,status,target_table,target_id');
  if (error) throw error;
  return data || [];
}
