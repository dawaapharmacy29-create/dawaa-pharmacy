import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import type { UnifiedInvoiceVerification } from './whatsappUnifiedIntelligenceV4';
import type { SmartIntelligenceCustomerPurchaseHistory } from './whatsappSmartIntelligenceSnapshot';

export type SaleOutcomeV2 =
  | 'not_applicable'
  | 'opportunity_detected'
  | 'customer_accepted'
  | 'order_confirmed'
  | 'invoice_verified_sale'
  | 'probable_sale'
  | 'lost_opportunity'
  | 'stockout_blocked'
  | 'customer_declined'
  | 'needs_review';

export type FollowupOpportunityTypeV2 =
  | 'delivery_confirmation'
  | 'clinical_checkin'
  | 'product_result'
  | 'stockout_recovery'
  | 'sales_recovery'
  | 'complaint_recovery'
  | 'repeat_purchase'
  | 'new_customer_experience';

export interface EvaluationEvidenceV2 {
  messageIds: string[];
  reason: string;
  confidence: number;
}

export interface ComplianceDimensionV2 {
  score: number | null;
  coverage: number;
  status: 'strong' | 'partial' | 'weak' | 'not_applicable' | 'needs_review';
  passed: string[];
  missing: string[];
  evidence: EvaluationEvidenceV2;
}

export interface OrderCompletenessItemV2 {
  key: 'customer' | 'phone' | 'address' | 'product' | 'quantity' | 'alternative_acceptance' | 'price' | 'delivery_eta' | 'explicit_confirmation';
  label: string;
  status: 'confirmed' | 'missing' | 'not_applicable' | 'unknown';
  evidenceMessageIds: string[];
}

export interface FollowupOpportunityV2 {
  type: FollowupOpportunityTypeV2;
  label: string;
  priority: 'high' | 'medium' | 'commercial';
  timingLabel: string;
  reason: string;
  evidenceMessageIds: string[];
  confidence: number;
}

export interface EvaluationAxisV2 {
  key: 'communication' | 'consultation' | 'sales' | 'fulfillment' | 'retention';
  label: string;
  score: number | null;
  coverage: number;
  summary: string;
}

export interface SmartConversationEvaluationV2 {
  version: 'smart-conversation-evaluation-v2';
  generatedAt: string;
  sale: {
    outcome: SaleOutcomeV2;
    label: string;
    confidence: number;
    revenue: number | null;
    invoiceNumber: string | null;
    reason: string;
    evidenceMessageIds: string[];
  };
  opening: ComplianceDimensionV2;
  closing: ComplianceDimensionV2;
  orderCompleteness: {
    applicable: boolean;
    score: number | null;
    confirmedCount: number;
    requiredCount: number;
    items: OrderCompletenessItemV2[];
    missingCritical: string[];
  };
  opportunities: {
    detected: number;
    handled: number;
    missed: number;
    rescuedByAlternative: number;
    explicitCrossSellOffers: number;
    summary: string;
    evidenceMessageIds: string[];
  };
  serviceRecovery: {
    detected: boolean;
    score: number | null;
    status: 'strong' | 'partial' | 'weak' | 'not_applicable';
    issueType: 'order_delay' | 'service_issue' | 'unknown';
    passed: string[];
    missing: string[];
    evidenceMessageIds: string[];
    confidence: number;
    summary: string;
  };
  followups: FollowupOpportunityV2[];
  axes: EvaluationAxisV2[];
  qualityScore: number | null;
  evidenceCoverage: number;
  confidence: number;
  scoreDisplayLabel: string;
  strongestAxis: string | null;
  weakestAxis: string | null;
  warnings: string[];
}

const normalize = (value: unknown) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '')
  .replace(/\s+/g, ' ');

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const uniq = <T,>(items: T[]) => [...new Set(items)];

const DELETED_MESSAGE_RX = /(you deleted this message|this message was deleted|تم حذف هذه الرسالة|لقد حذفت هذه الرسالة)/i;

function messages(session: WhatsAppConversationSession, direction?: 'inbound' | 'outbound') {
  return session.messages.filter(
    (m) =>
      (!direction || m.direction === direction) &&
      !DELETED_MESSAGE_RX.test(String(m.text || ''))
  );
}
function matching(session: WhatsAppConversationSession, rx: RegExp, direction?: 'inbound' | 'outbound') {
  return messages(session, direction).filter((m) => rx.test(m.text));
}
function ids(rows: WhatsAppParsedMessage[]) {
  return uniq(rows.map((m) => m.id)).slice(0, 12);
}
function lastMeaningful(session: WhatsAppConversationSession) {
  return session.messages.filter((m) => m.kind !== 'system' && m.text.trim()).slice(-1)[0] || null;
}

// لازم يشمل رد التحية الطبيعي ("صباح النور"/"مساء النور") مش بس بادئها ("صباح الخير")،
// وإلا رد رسمي كامل بيتحاسب "من غير تحية" لمجرد إنه رد على العميل بدل ما يبدأ هو.
const GREETING_RX = /(السلام عليكم|مساء الخير|مساء النور|صباح الخير|صباح النور|اهلا|أهلا|نورت)/i;
const PHARMACY_RX = /(صيدليات\s+دواء|صيدليه\s+دواء|صيدلية\s+دواء)/i;
const INTRO_RX = /(مع حضرتك|معاك|د\.?\s*[^\s،,.]+|دكتور|دكتوره|دكتورة)/i;
// "تحت امر" و"تحت أمرك" بس كانوا مكتوبين بإملاء واحد لكل حالة - "تحت أمر حضرتك"
// (الإملاء الأصح والأكثر شيوعًا، بالهمزة، وحضرتك منفصلة) ما كانش بيتغطى خالص.
const HELP_RX = /(تحت\s+[اأ]مرك?|اقدر اساعد|أقدر أساعد|خدمتك|نساعد حضرتك)/i;
const SALE_INTENT_RX = /(عايز|عاوز|محتاج|متوفر|موجود|بكام|السعر|سعر|ابعته|ابعت|هات|خلاص ماشي|تمام ابعت)/i;
const ACCEPT_RX = /(تمام|موافق|ماشي|خلاص|ابعت|ابعته|هات|اوكي|أوكي)/i;
const DECLINE_RX = /(لا شكرا|مش عايز|مش عاوز|غالي|مش مناسب|خلاص مش محتاج|مش هطلب)/i;
const ORDER_CONFIRM_RX = /(تم تأكيد|تاكيد الطلب|تأكيد الطلب|الاوردر اتاكد|الأوردر اتأكد|تم تسجيل الطلب|جاري الارسال|جاري الإرسال|خرج لحضرتك|هيتم التوصيل)/i;
const PRODUCT_RX = /(دواء|كريم|شامبو|غسول|قطره|قطرة|شراب|برشام|اقراص|أقراص|حقن|حقنه|فيتامين|مصل|صنف|منتج)/i;
const QTY_RX = /(\b\d+\b\s*(علبه|علبة|شريط|زجاجه|زجاجة|قطعه|قطعة|واحد|اتنين|اثنين)|عدد\s*\d+|كميه|كمية)/i;
const PHONE_RX = /(?:\+?20)?01[0125]\d{8}/;
const ADDRESS_RX = /(العنوان|شارع|منطقه|منطقة|جنب|امام|أمام|الدور|شقه|شقة|محله|المحلة|شكري|الشامي)/i;
const PRICE_RX = /(\d+(?:[.,]\d+)?\s*(ج|جنيه)|الاجمالي|الإجمالي|السعر|الحساب)/i;
const ETA_RX = /(خلال\s+\d+|نص ساعه|نص ساعة|ساعه|ساعة|دقيقه|دقيقة|هيوصل|يوصل خلال)/i;
const ALT_RX = /(بديل|بداله|بداله|نفس الماده|نفس المادة|نرشح|ارشح|أرشح)/i;
const STOCKOUT_RX = /(مش موجود|غير متوفر|ناقص|معجز|مش متاح)/i;
const CLOSING_RX = /(تحت امر حضرتك|تحت أمرك|في اي وقت|في أي وقت|تشرفنا|شكر.?ا لحضرتك|نتمني|نتمنى|يوم سعيد)/i;
const ANYTHING_ELSE_RX = /(حاجه تاني|حاجة تانية|اي حاجه تاني|أي حاجة تانية|تحتاج حاجه|تحتاج حاجة)/i;
const DELIVERY_RX = /(توصيل|مندوب|العنوان|جاري الارسال|جاري الإرسال|خرج لحضرتك|هيوصل)/i;
const COMPLAINT_RX = /(شكوى|مشكله|مشكلة|متأخر|تاخير|تأخير|محدش رد|غلط|سيء|وحش|لسه مجاش|ماوصلش)/i;
const SYMPTOM_RX = /(الم|ألم|حراره|حرارة|كحه|كحة|اسهال|إسهال|ترجيع|قيء|حموضه|حموضة|التهاب|اعراض|أعراض)/i;
const RESULT_PRODUCT_RX = /(شعر|بشره|بشرة|كريم|سيرم|شامبو|غسول|فيتامين|مكمل)/i;
const FOLLOWUP_PROMISE_RX = /(هتابع|هرجع|هبلغ|هتواصل|اول ما يتوفر|أول ما يتوفر|هطلبه|هنوفر)/i;
const CROSS_SELL_RX = /(كمان|معاه|معاها|ممكن نضيف|نرشح لحضرتك|أرشح لحضرتك|في عرض|عندنا عرض)/i;
const SERVICE_RECOVERY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|اسفين|آسفين|عن\s+التاخير|عن\s+التأخير|التأخير اللي حصل|تاخير\s+(?:الطلب|الاوردر|الأوردر)|تأخير\s+(?:الطلب|الاوردر|الأوردر)|هنعوض|نعوض حضرتك|نتابع مع الفريق|هنتابع مع الفريق|رضا حضرتك وثقتك|أسرع وقت ممكن)/i;
const RECOVERY_APOLOGY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|اسفين|آسفين)/i;
const RECOVERY_OWNERSHIP_RX = /(بنتابع|هنتابع|هنراجع|نتابع مع الفريق|الفريق المختص|مهتمين.*(?:طلب|وصول)|هنحل|تم الحل)/i;
const RECOVERY_ETA_RX = /(خلال\s+\d+|نص ساعه|نص ساعة|خلال ساعة|موعد|ميعاد|النهارده|اليوم|بكره|بكرة|أسرع وقت ممكن|اسرع وقت ممكن)/i;
const RECOVERY_COMPENSATION_RX = /(هنعوض|نعوض حضرتك|تعويض|هدية|خصم|رضا حضرتك وثقتك)/i;
const RECOVERY_REASSURANCE_RX = /(اطمن|أطمن|مهتمين|رضا حضرتك|ثقتك|حسن ظنك)/i;

function scoreOpening(session: WhatsAppConversationSession): ComplianceDimensionV2 {
  const out = messages(session, 'outbound');
  if (!out.length) return { score: null, coverage: 0, status: 'needs_review', passed: [], missing: ['لا توجد رسالة صادرة قابلة للتقييم'], evidence: { messageIds: [], reason: 'لا توجد رسالة صادرة.', confidence: 20 } };
  const firstTwo = out.slice(0, 2);
  const text = firstTwo.map((m) => m.text).join(' ');
  const passed: string[] = [];
  const missing: string[] = [];
  const recoveryOpening = SERVICE_RECOVERY_RX.test(text);
  if (GREETING_RX.test(text)) passed.push('تحية مناسبة'); else missing.push('التحية');
  if (PHARMACY_RX.test(text)) passed.push('ذكر صيدليات دواء'); else missing.push('اسم الصيدلية');
  if (INTRO_RX.test(text)) passed.push('تعريف المسؤول بنفسه'); else missing.push('اسم/تعريف المسؤول');
  if (recoveryOpening) {
    if (RECOVERY_APOLOGY_RX.test(text)) passed.push('سبب التواصل/الاعتذار واضح'); else missing.push('سبب التواصل/الاعتذار');
  } else if (HELP_RX.test(text)) {
    passed.push('عرض المساعدة');
  } else {
    missing.push('عرض المساعدة');
  }
  const score = Math.round((passed.length / 4) * 100);
  return {
    score,
    coverage: 100,
    status: score >= 90 ? 'strong' : score >= 50 ? 'partial' : 'weak',
    passed,
    missing,
    evidence: { messageIds: ids(firstTwo), reason: `تم فحص أول ${firstTwo.length} رسالة صادرة لعناصر الافتتاح الرسمية.`, confidence: 94 },
  };
}

function scoreClosing(session: WhatsAppConversationSession, orderConfirmed: boolean): ComplianceDimensionV2 {
  const out = messages(session, 'outbound');
  const tail = out.slice(-3);
  if (!tail.length) return { score: null, coverage: 0, status: 'needs_review', passed: [], missing: [], evidence: { messageIds: [], reason: 'لا توجد نهاية صادرة قابلة للفحص.', confidence: 20 } };
  const text = tail.map((m) => m.text).join(' ');
  const passed: string[] = [];
  const missing: string[] = [];
  if (orderConfirmed && ORDER_CONFIRM_RX.test(text)) passed.push('تأكيد التنفيذ/الطلب'); else if (orderConfirmed) missing.push('إعادة تأكيد التنفيذ');
  if (orderConfirmed && ETA_RX.test(text)) passed.push('توضيح الخطوة أو زمن التوصيل'); else if (orderConfirmed) missing.push('الخطوة التالية/موعد الوصول');
  const recoveryClosing = SERVICE_RECOVERY_RX.test(text);
  if (ANYTHING_ELSE_RX.test(text)) passed.push('عرض مساعدة إضافية');
  else if (!recoveryClosing) missing.push('عرض مساعدة إضافية');

  if (CLOSING_RX.test(text)) {
    passed.push('ختام مهذب');
  } else if (recoveryClosing && (RECOVERY_REASSURANCE_RX.test(text) || RECOVERY_OWNERSHIP_RX.test(text))) {
    passed.push('ختام استعادة خدمة محترم');
  } else {
    missing.push(recoveryClosing ? 'إغلاق واضح لاستعادة الخدمة' : 'الختام الرسمي');
  }

  const applicable = orderConfirmed ? 4 : recoveryClosing ? 1 : 2;
  const relevantPassed = orderConfirmed
    ? passed.length
    : recoveryClosing
      ? passed.filter((x) => /ختام استعادة/.test(x)).length
      : passed.filter((x) => /مساعدة|ختام/.test(x)).length;
  const score = Math.round((relevantPassed / applicable) * 100);
  const last = lastMeaningful(session);
  const customerEnded = last?.direction === 'inbound';
  return {
    score,
    coverage: customerEnded ? 80 : 100,
    status: score >= 90 ? 'strong' : score >= 50 ? 'partial' : 'weak',
    passed,
    missing,
    evidence: { messageIds: ids(tail), reason: customerEnded ? 'العميل أرسل آخر رسالة؛ تم خفض يقين الحكم على الختام.' : 'تم فحص آخر الرسائل الصادرة كنهاية فعلية للجلسة.', confidence: customerEnded ? 78 : 92 },
  };
}

function scoreServiceRecovery(session: WhatsAppConversationSession) {
  const outbound = messages(session, 'outbound');
  const recoveryMessages = outbound.filter((message) => SERVICE_RECOVERY_RX.test(String(message.text || '')));
  if (!recoveryMessages.length) {
    return {
      detected: false,
      score: null,
      status: 'not_applicable' as const,
      issueType: 'unknown' as const,
      passed: [],
      missing: [],
      evidenceMessageIds: [],
      confidence: 90,
      summary: 'لا توجد رحلة اعتذار/استعادة خدمة واضحة في هذه الجلسة.',
    };
  }

  const text = recoveryMessages.map((message) => message.text).join(' ');
  const all = session.messages.map((message) => message.text).join(' ');
  const passed: string[] = [];
  const missing: string[] = [];

  if (RECOVERY_APOLOGY_RX.test(text)) passed.push('اعتذار واضح'); else missing.push('الاعتذار');
  if (COMPLAINT_RX.test(all) || /تأخير|تاخير|مشكله|مشكلة|ماوصلش|لسه مجاش/i.test(all)) passed.push('تحديد سبب التواصل/المشكلة'); else missing.push('تحديد المشكلة');
  if (RECOVERY_OWNERSHIP_RX.test(text)) passed.push('تحمل المسؤولية وذكر إجراء واضح'); else missing.push('الإجراء/تحمل المسؤولية');
  if (RECOVERY_ETA_RX.test(text)) passed.push('توضيح الخطوة التالية أو التوقيت'); else missing.push('توقيت أو خطوة تالية واضحة');
  if (RECOVERY_REASSURANCE_RX.test(text)) passed.push('طمأنة واهتمام بالعميل'); else missing.push('طمأنة العميل');
  if (RECOVERY_COMPENSATION_RX.test(text)) passed.push('محاولة استعادة الرضا/تعويض'); else missing.push('استعادة الرضا/تعويض عند اللزوم');

  // التعويض عنصر Bonus وليس مطلوبًا دائمًا، لذلك الأساس 5 عناصر،
  // ويصبح العنصر السادس قيمة إضافية بدل أن يظلم الرسالة لو لم يكن التعويض مناسبًا.
  const corePassed = passed.filter((item) => item !== 'محاولة استعادة الرضا/تعويض').length;
  const bonus = passed.includes('محاولة استعادة الرضا/تعويض') ? 8 : 0;
  const score = clamp(Math.round((corePassed / 5) * 92) + bonus);
  const issueType = /تأخير|تاخير|ماوصلش|لسه مجاش|توصيل|اوردر|أوردر/i.test(all)
    ? 'order_delay' as const
    : COMPLAINT_RX.test(all)
      ? 'service_issue' as const
      : 'unknown' as const;

  return {
    detected: true,
    score,
    status: score >= 90 ? 'strong' as const : score >= 65 ? 'partial' as const : 'weak' as const,
    issueType,
    passed,
    missing,
    evidenceMessageIds: ids(recoveryMessages),
    confidence: 92,
    summary: score >= 90
      ? 'استعادة خدمة قوية: اعتذار + إجراء + طمأنة + خطوة تالية واضحة.'
      : score >= 65
        ? 'استعادة خدمة جيدة لكن ينقصها عنصر أو أكثر لإغلاق المشكلة باحتراف.'
        : 'الاعتذار موجود لكن إدارة استعادة الخدمة ما زالت ناقصة.',
  };
}

function orderCompleteness(session: WhatsAppConversationSession, saleOutcome: SaleOutcomeV2) {
  const applicable = !['not_applicable', 'opportunity_detected', 'customer_declined'].includes(saleOutcome);
  const all = session.messages.map((m) => m.text).join(' ');
  const inboundText = messages(session, 'inbound').map((m) => m.text).join(' ');
  const items: OrderCompletenessItemV2[] = [
    { key: 'customer', label: 'هوية العميل', status: session.customerName ? 'confirmed' : 'unknown', evidenceMessageIds: [] },
    { key: 'phone', label: 'رقم الهاتف', status: PHONE_RX.test(all) ? 'confirmed' : applicable ? 'missing' : 'not_applicable', evidenceMessageIds: ids(matching(session, PHONE_RX)) },
    { key: 'address', label: 'العنوان', status: ADDRESS_RX.test(all) ? 'confirmed' : DELIVERY_RX.test(all) ? 'missing' : 'not_applicable', evidenceMessageIds: ids(matching(session, ADDRESS_RX)) },
    { key: 'product', label: 'الصنف/المنتج', status: PRODUCT_RX.test(all) ? 'confirmed' : applicable ? 'missing' : 'not_applicable', evidenceMessageIds: ids(matching(session, PRODUCT_RX)) },
    { key: 'quantity', label: 'الكمية', status: QTY_RX.test(all) ? 'confirmed' : applicable ? 'missing' : 'unknown', evidenceMessageIds: ids(matching(session, QTY_RX)) },
    { key: 'alternative_acceptance', label: 'موافقة العميل على البديل', status: ALT_RX.test(all) ? (ACCEPT_RX.test(inboundText) ? 'confirmed' : 'unknown') : 'not_applicable', evidenceMessageIds: ids(matching(session, ALT_RX)) },
    { key: 'price', label: 'السعر/الإجمالي', status: PRICE_RX.test(all) ? 'confirmed' : applicable ? 'unknown' : 'not_applicable', evidenceMessageIds: ids(matching(session, PRICE_RX)) },
    { key: 'delivery_eta', label: 'التوصيل/موعد الوصول', status: ETA_RX.test(all) ? 'confirmed' : DELIVERY_RX.test(all) ? 'missing' : 'not_applicable', evidenceMessageIds: ids(matching(session, ETA_RX)) },
    { key: 'explicit_confirmation', label: 'تأكيد الطلب صراحة', status: ORDER_CONFIRM_RX.test(all) ? 'confirmed' : applicable ? 'missing' : 'not_applicable', evidenceMessageIds: ids(matching(session, ORDER_CONFIRM_RX)) },
  ];
  const required = items.filter((x) => x.status !== 'not_applicable' && x.status !== 'unknown');
  const confirmed = required.filter((x) => x.status === 'confirmed');
  const criticalKeys = new Set(['product', 'explicit_confirmation', ...(DELIVERY_RX.test(all) ? ['address'] : [])]);
  const missingCritical = required.filter((x) => x.status === 'missing' && criticalKeys.has(x.key)).map((x) => x.label);
  return {
    applicable,
    score: applicable && required.length ? Math.round((confirmed.length / required.length) * 100) : null,
    confirmedCount: confirmed.length,
    requiredCount: required.length,
    items,
    missingCritical,
  };
}

function saleOutcome(session: WhatsAppConversationSession, invoice: UnifiedInvoiceVerification) {
  const all = session.messages.map((m) => m.text).join(' ');
  const inbound = messages(session, 'inbound').map((m) => m.text).join(' ');
  const saleIntent = SALE_INTENT_RX.test(all);
  const accepted = ACCEPT_RX.test(inbound);
  const declined = DECLINE_RX.test(inbound);
  const confirmed = ORDER_CONFIRM_RX.test(all);
  const stockout = STOCKOUT_RX.test(all);
  const evidence = ids([
    ...matching(session, SALE_INTENT_RX),
    ...matching(session, ACCEPT_RX, 'inbound'),
    ...matching(session, ORDER_CONFIRM_RX),
    ...matching(session, STOCKOUT_RX),
  ]);
  if (invoice.status === 'verified') return { outcome: 'invoice_verified_sale' as const, label: 'بيع مؤكد بالفاتورة', confidence: Math.round(invoice.verificationConfidence * 100), reason: invoice.reason, evidenceMessageIds: evidence };
  if (invoice.status === 'probable') return { outcome: 'probable_sale' as const, label: 'بيع مرجح — يحتاج مراجعة', confidence: Math.round(invoice.verificationConfidence * 100), reason: invoice.reason, evidenceMessageIds: evidence };
  if (declined) return { outcome: 'customer_declined' as const, label: 'العميل تراجع/رفض', confidence: 88, reason: 'تم رصد رفض أو تراجع واضح من العميل.', evidenceMessageIds: evidence };
  if (confirmed) return { outcome: 'order_confirmed' as const, label: 'طلب مؤكد من الشات — لم تؤكد الفاتورة', confidence: invoice.status === 'not_found' ? 82 : 75, reason: 'يوجد تأكيد تنفيذ/طلب في المحادثة لكن لا توجد فاتورة مؤكدة.', evidenceMessageIds: evidence };
  // "تمام"/"أوكي" وحدها معناها عام جدًا (ممكن تكون رد على اعتذار أو متابعة، مش بيع) -
  // ميتحسبش قبول بيع إلا لو فيه إشارة احتياج/شراء فعلية في المحادثة (saleIntent) بتثبت
  // إن في رحلة بيع أصلًا، وإلا محادثة استعادة خدمة هتتصنف غلط كـ"بيع محتمل".
  if (accepted && saleIntent) return { outcome: 'customer_accepted' as const, label: 'موافقة مبدئية من العميل', confidence: 72, reason: 'العميل أبدى موافقة لكن لا يوجد دليل كافٍ على إتمام التنفيذ.', evidenceMessageIds: evidence };
  if (stockout && saleIntent) return { outcome: 'stockout_blocked' as const, label: 'فرصة بيع توقفت بسبب عدم التوفر', confidence: 80, reason: 'يوجد طلب بيع مع إشارة واضحة لعدم التوفر.', evidenceMessageIds: evidence };
  if (saleIntent) return { outcome: 'opportunity_detected' as const, label: 'فرصة بيع مفتوحة', confidence: 70, reason: 'يوجد احتياج/نية شراء لكن لم يظهر إغلاق واضح.', evidenceMessageIds: evidence };
  return { outcome: 'not_applicable' as const, label: 'لا توجد رحلة بيع مثبتة', confidence: 75, reason: 'لم يظهر احتياج شرائي كافٍ للحكم على البيع.', evidenceMessageIds: evidence };
}

function followupsFor(session: WhatsAppConversationSession, sale: SaleOutcomeV2, purchaseHistory?: SmartIntelligenceCustomerPurchaseHistory | null): FollowupOpportunityV2[] {
  const all = session.messages.map((m) => m.text).join(' ');
  const result: FollowupOpportunityV2[] = [];
  const add = (item: FollowupOpportunityV2) => {
    if (!result.some((x) => x.type === item.type)) result.push(item);
  };
  if (['order_confirmed', 'invoice_verified_sale', 'probable_sale'].includes(sale) || DELIVERY_RX.test(all)) {
    add({ type: 'delivery_confirmation', label: 'التأكد من وصول الطلب', priority: 'high', timingLabel: 'بعد التوصيل/نفس اليوم', reason: 'المحادثة تتضمن طلبًا أو توصيلًا ويستحسن إغلاق الحلقة بالتأكد من الوصول.', evidenceMessageIds: ids(matching(session, DELIVERY_RX)), confidence: 90 });
  }
  if (SYMPTOM_RX.test(all)) {
    add({ type: 'clinical_checkin', label: 'الاطمئنان على الحالة', priority: 'high', timingLabel: 'خلال 1–3 أيام حسب الحالة', reason: 'المحادثة تتضمن أعراضًا/حالة صحية تستحق متابعة خدمية.', evidenceMessageIds: ids(matching(session, SYMPTOM_RX)), confidence: 82 });
  }
  if (RESULT_PRODUCT_RX.test(all)) {
    add({ type: 'product_result', label: 'متابعة نتيجة الاستخدام', priority: 'medium', timingLabel: 'بعد فترة مناسبة للمنتج', reason: 'المنتج من الأنواع التي يمكن أن تستفيد من متابعة النتيجة والاستخدام.', evidenceMessageIds: ids(matching(session, RESULT_PRODUCT_RX)), confidence: 72 });
  }
  if (STOCKOUT_RX.test(all) || FOLLOWUP_PROMISE_RX.test(all)) {
    add({ type: 'stockout_recovery', label: 'المتابعة عند التوفير', priority: 'high', timingLabel: 'فور توافر الصنف', reason: 'يوجد نقص/وعد بالتوفير ويجب ألا تضيع فرصة العميل.', evidenceMessageIds: ids([...matching(session, STOCKOUT_RX), ...matching(session, FOLLOWUP_PROMISE_RX)]), confidence: 91 });
  }
  if (sale === 'opportunity_detected' || sale === 'customer_accepted') {
    add({ type: 'sales_recovery', label: 'استكمال فرصة البيع', priority: 'commercial', timingLabel: 'خلال نفس اليوم أو اليوم التالي', reason: 'يوجد اهتمام أو قبول لم يتحول إلى تنفيذ مؤكد.', evidenceMessageIds: ids(matching(session, SALE_INTENT_RX)), confidence: 84 });
  }
  if (COMPLAINT_RX.test(all)) {
    add({ type: 'complaint_recovery', label: 'متابعة بعد حل الشكوى', priority: 'high', timingLabel: 'بعد الحل خلال 24 ساعة', reason: 'المتابعة بعد الشكوى تساعد على التأكد من رضا العميل واستعادة الثقة.', evidenceMessageIds: ids(matching(session, COMPLAINT_RX)), confidence: 92 });
  }
  if ((purchaseHistory?.totalPurchases || 0) > 1 && ['invoice_verified_sale', 'order_confirmed'].includes(sale)) {
    add({ type: 'repeat_purchase', label: 'توقع إعادة الشراء', priority: 'commercial', timingLabel: 'حسب نمط الشراء السابق', reason: `للعميل سجل شراء سابق (${purchaseHistory?.totalPurchases || 0} عملية)، ويمكن استخدامه لتوقيت إعادة التواصل بدل المتابعة العشوائية.`, evidenceMessageIds: [], confidence: 78 });
  }
  return result;
}

function axis(key: EvaluationAxisV2['key'], label: string, components: Array<number | null>, summary: string): EvaluationAxisV2 {
  const available = components.filter((x): x is number => typeof x === 'number');
  return {
    key,
    label,
    score: available.length ? Math.round(available.reduce((a, b) => a + b, 0) / available.length) : null,
    coverage: Math.round((available.length / Math.max(1, components.length)) * 100),
    summary,
  };
}

export function buildSmartConversationEvaluationV2(
  session: WhatsAppConversationSession,
  options: {
    invoiceVerification: UnifiedInvoiceVerification;
    purchaseHistory?: SmartIntelligenceCustomerPurchaseHistory | null;
    salesOpportunities?: Array<{ handling?: string; triggerMessageId?: string; reason?: string }>;
    consultationCommunication?: string | null;
  }
): SmartConversationEvaluationV2 {
  const sale = saleOutcome(session, options.invoiceVerification);
  const serviceRecovery = scoreServiceRecovery(session);
  const opening = scoreOpening(session);
  const closing = scoreClosing(session, ['order_confirmed', 'invoice_verified_sale', 'probable_sale'].includes(sale.outcome));
  const order = orderCompleteness(session, sale.outcome);
  const salesOpps = options.salesOpportunities || [];
  const handled = salesOpps.filter((x) => x.handling === 'handled_well').length;
  const missed = salesOpps.filter((x) => x.handling === 'missed').length;
  // Saved Sale (rescuedByAlternative) لازم الثلاثة شروط مع بعض، مش بس ذكر كلمة "بديل"
  // في أي مكان بالمحادثة: (1) نقص/عدم توفر فعلي مثبت، (2) بديل اتعرض من الموظف
  // تحديدًا، (3) قبول صريح من العميل بعد عرض البديل تحديدًا - وإلا أي محادثة بيع
  // عادية فيها اقتراح Cross-sell عابر كانت بتتحسب "أنقذت بيع" غلط رغم إنه مفيش
  // نقص أصلًا. أي شرط ناقص من التلاتة = لا Saved Sale.
  const stockoutDetected = STOCKOUT_RX.test(session.messages.map((m) => m.text || '').join(' '));
  const altOfferedIndex = session.messages.findIndex((m) => m.direction === 'outbound' && ALT_RX.test(m.text || ''));
  const altOffered = altOfferedIndex !== -1;
  const customerAcceptedAlternative = altOffered && session.messages
    .slice(altOfferedIndex + 1)
    .some((m) => m.direction === 'inbound' && ACCEPT_RX.test(m.text || '') && !DECLINE_RX.test(m.text || ''));
  const altRescued = stockoutDetected && altOffered && customerAcceptedAlternative && ['order_confirmed', 'invoice_verified_sale', 'probable_sale'].includes(sale.outcome) ? 1 : 0;
  const crossSell = matching(session, CROSS_SELL_RX, 'outbound');
  const opportunityScore = salesOpps.length ? clamp(Math.round(((handled + altRescued) / Math.max(1, salesOpps.length)) * 100) - missed * 20) : null;
  const saleScore = sale.outcome === 'invoice_verified_sale' ? 100
    : sale.outcome === 'order_confirmed' ? 90
      : sale.outcome === 'probable_sale' ? 85
        : sale.outcome === 'customer_accepted' ? 70
          : sale.outcome === 'opportunity_detected' ? 45
            : sale.outcome === 'stockout_blocked' ? 40
              : sale.outcome === 'customer_declined' ? null
                : null;
  const consultationScore = options.consultationCommunication === 'clear' ? 90
    : options.consultationCommunication === 'partial' ? 65
      : options.consultationCommunication === 'needs_review' ? 50
        : null;
  const followups = followupsFor(session, sale.outcome, options.purchaseHistory);
  const retentionScore = serviceRecovery.detected
    ? clamp(Math.round((serviceRecovery.score || 0) * 0.65 + (followups.length ? 35 : 20)))
    : closing.score == null
      ? null
      : clamp(Math.round(closing.score * 0.55 + (followups.length ? 45 : 30)));

  const communicationComponents = serviceRecovery.detected
    ? [opening.score, serviceRecovery.score]
    : [opening.score, closing.score];
  const fulfillmentComponents = serviceRecovery.detected && serviceRecovery.issueType === 'order_delay'
    ? [serviceRecovery.score]
    : [order.score];

  const axes = [
    axis(
      'communication',
      'الخدمة والتواصل',
      communicationComponents,
      serviceRecovery.detected ? serviceRecovery.summary : 'الافتتاح والختام وجودة اكتمال التواصل الظاهر.'
    ),
    axis('consultation', 'الاستشارة والجودة', [consultationScore], consultationScore == null ? 'لا يوجد أساس كافٍ لتقييم الاستشارة آليًا.' : 'مبني على وضوح التواصل الاستشاري فقط، وليس حكمًا طبيًا على صحة العلاج.'),
    axis('sales', 'البيع واستغلال الفرص', [saleScore, opportunityScore], sale.label),
    axis(
      'fulfillment',
      'تنفيذ الأوردر',
      fulfillmentComponents,
      serviceRecovery.detected && serviceRecovery.issueType === 'order_delay'
        ? 'المحور هنا يقيس جودة التعامل مع تأخير الأوردر، وليس اكتمال أوردر جديد.'
        : order.applicable
          ? `تم تأكيد ${order.confirmedCount} من ${order.requiredCount} عناصر قابلة للحسم.`
          : 'لا يوجد أوردر مكتمل يجعل المحور منطبقًا.'
    ),
    axis('retention', 'الاحتفاظ والمتابعة', [retentionScore], followups.length ? `${followups.length} فرصة متابعة محتملة.` : 'لم يتم اكتشاف متابعة واضحة لهذه الجلسة.'),
  ];

  const scoredAxes = axes.filter((x) => x.score != null);
  const evidenceCoverage = Math.round(axes.reduce((sum, x) => sum + x.coverage, 0) / axes.length);
  const qualityScore = scoredAxes.length ? Math.round(scoredAxes.reduce((sum, x) => sum + (x.score || 0), 0) / scoredAxes.length) : null;
  const confidenceParts = [opening.evidence.confidence, closing.evidence.confidence, sale.confidence, evidenceCoverage];
  const confidence = Math.round(confidenceParts.reduce((a, b) => a + b, 0) / confidenceParts.length);
  const sorted = scoredAxes.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const warnings: string[] = [];
  if (evidenceCoverage < 80) warnings.push('تغطية الأدلة أقل من 80%؛ الدرجة لا تمثل كل جوانب المحادثة.');
  if (session.missingMediaCount) warnings.push(`يوجد ${session.missingMediaCount} مرفق غير متاح قد يخفي تفاصيل مؤثرة.`);
  if (!serviceRecovery.detected && order.missingCritical.length) warnings.push(`بيانات أوردر مهمة غير مثبتة: ${order.missingCritical.join('، ')}.`);
  if (serviceRecovery.detected && serviceRecovery.missing.length) warnings.push(`استعادة الخدمة ينقصها: ${serviceRecovery.missing.join('، ')}.`);
  if (sale.outcome === 'customer_accepted' && options.invoiceVerification.status === 'not_found') warnings.push('موافقة العميل لا تعني بيعًا مكتملًا بدون دليل تنفيذ/فاتورة.');

  return {
    version: 'smart-conversation-evaluation-v2',
    generatedAt: new Date().toISOString(),
    sale: {
      ...sale,
      revenue: options.invoiceVerification.revenue,
      invoiceNumber: options.invoiceVerification.bestCandidate?.invoiceNumber || null,
    },
    opening,
    closing,
    orderCompleteness: order,
    serviceRecovery,
    opportunities: {
      detected: salesOpps.length,
      handled,
      missed,
      rescuedByAlternative: altRescued,
      explicitCrossSellOffers: crossSell.length,
      summary: salesOpps.length
        ? `تم التعامل جيدًا مع ${handled} من ${salesOpps.length} فرصة مرصودة، مع ${missed} فرصة ضائعة واضحة.`
        : 'لا توجد فرص بيع مؤكدة كفاية للحكم على الاستغلال.',
      evidenceMessageIds: uniq([...salesOpps.map((x) => x.triggerMessageId).filter(Boolean) as string[], ...ids(crossSell)]),
    },
    followups,
    axes,
    qualityScore,
    evidenceCoverage,
    confidence,
    scoreDisplayLabel: qualityScore == null
      ? 'لا توجد تغطية كافية لدرجة كلية'
      : evidenceCoverage >= 80
        ? `جودة مقترحة ${qualityScore}/100`
        : `جودة جزئية ${qualityScore}/100 على تغطية ${evidenceCoverage}% فقط`,
    strongestAxis: sorted[0]?.label || null,
    weakestAxis: sorted.length > 1 ? sorted[sorted.length - 1]?.label || null : null,
    warnings,
  };
}
