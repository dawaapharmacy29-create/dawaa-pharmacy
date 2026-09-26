import { readCustomerInvoices, type CustomerInvoiceReadRow } from '@/lib/readModels/customerInvoiceReadModel';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from './whatsappConversationParser';
import { extractConversationSignals } from './whatsappConversationSignals';

export type UnifiedPriority = 'normal' | 'important' | 'urgent';
export type UnifiedOutcome = 'sold' | 'not_sold' | 'needs_followup' | 'complaint_resolved' | 'complaint_unresolved' | 'unknown';
export type InvoiceMatchStatus = 'verified' | 'probable' | 'not_found' | 'needs_review' | 'not_applicable';

export interface JourneyStage {
  key: 'opening' | 'need' | 'availability' | 'alternative' | 'closing' | 'delivery' | 'followup' | 'complaint_recovery';
  label: string;
  detected: boolean;
  confidence: number;
  evidenceMessageIds: string[];
  reason: string;
}

export interface LostSaleSignal {
  severity: 'low' | 'medium' | 'high';
  summary: string;
  evidenceMessageIds: string[];
}

export interface MedicalSafetyFlag {
  severity: 'info' | 'medium' | 'high';
  code: string;
  summary: string;
  evidenceMessageIds: string[];
}

export interface UnifiedConversationIntelligence {
  version: 'whatsapp-review-v4';
  outcome: UnifiedOutcome;
  priority: UnifiedPriority;
  confidence: number;
  requiresHumanApproval: boolean;
  followupRequired: boolean;
  suggestedFollowupReason: string | null;
  commercialEligible: boolean;
  chatSuggestedSold: boolean;
  serviceScore: number;
  commercialScore: number;
  journeyStages: JourneyStage[];
  lostSales: LostSaleSignal[];
  medicalSafetyFlags: MedicalSafetyFlag[];
  strengths: string[];
  weaknesses: string[];
  executiveSummary: string;
}

export interface InvoiceLookup {
  customerId?: string | null;
  customerCode?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  branch?: string | null;
}

export interface InvoiceCandidate {
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  branch: string | null;
  sellerName: string | null;
  customerCode: string | null;
  customerName: string | null;
  amount: number | null;
  score: number;
  confidence: number;
  reasons: string[];
  matchedIdentityStrategies: string[];
}

export interface UnifiedInvoiceVerification {
  status: InvoiceMatchStatus;
  bestCandidate: InvoiceCandidate | null;
  candidates: InvoiceCandidate[];
  verificationConfidence: number;
  revenue: number | null;
  reason: string;
  warnings: string[];
}

export interface PortfolioSummary {
  sessions: number;
  urgent: number;
  important: number;
  normal: number;
  salesEligible: number;
  suggestedSold: number;
  needsFollowup: number;
  complaints: number;
  averageServiceScore: number;
  averageCommercialScore: number;
  conversionSuggestionRate: number | null;
}

const normalizeArabic = (value: unknown) => String(value ?? '')
  .trim()
  .toLowerCase()
  .replace(/[أإآ]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/[\u064B-\u065F]/g, '')
  .replace(/\s+/g, ' ');

const allText = (session: WhatsAppConversationSession) => session.messages.map((m) => m.text).join('\n');
const outboundText = (session: WhatsAppConversationSession) => session.messages.filter((m) => m.direction === 'outbound').map((m) => m.text).join('\n');
const inboundText = (session: WhatsAppConversationSession) => session.messages.filter((m) => m.direction === 'inbound').map((m) => m.text).join('\n');
const has = (value: string, rx: RegExp) => rx.test(value);
const idsFor = (messages: WhatsAppParsedMessage[], rx: RegExp) => messages.filter((m) => rx.test(m.text)).map((m) => m.id);
const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const unique = <T,>(items: T[]) => [...new Set(items)];

const NEED_RX = /(عايز|عاوز|محتاج|ممكن|بدور|روشته|روشتة|وصفه|وصفة|متوفر|بكام|سعر|دواء|كريم|شامبو|فيتامين|مصل|حقنه|حقنة)/i;
const PURCHASE_INTENT_RX = /(هحتاجه|هحتاجها|هاخده|هاخدها|عايز|عاوز|محتاج|ابعت|ابعث|ابعته|ابعتي|هات|هاته|اطلب|أطلب|روشته|روشتة|وصفه|وصفة)/i;
const AVAILABILITY_RX = /(متوفر|موجود|متاح|ناقص|مش موجود|غير متوفر|هنوفر|هطلبه|هطلبها)/i;
const ALTERNATIVE_RX = /(بديل|نرشح|ارشح|ترشيح|بداله|بديل مناسب|نفس الماده|نفس المادة)/i;
const SALE_CLOSE_RX = /(تم تأكيد|تأكيد الطلب|الاوردر اتاكد|الأوردر اتأكد|تم الارسال|تم الإرسال|جاري الارسال|جاري الإرسال|هيتم التوصيل|خرج لحضرتك|الإجمالي|الاجمالي|فاتوره|فاتورة)/i;
const DELIVERY_RX = /(توصيل|مندوب|العنوان|خرج لحضرتك|جاري الارسال|جاري الإرسال)/i;
const FOLLOWUP_RX = /(هتابع|هرجع|هكلم|هطلب|اول ما يتوفر|أول ما يتوفر|هبلغ حضرتك|هتواصل)/i;
const COMPLAINT_RX = /(شكوى|مشكله|مشكلة|متاخر|متأخر|محدش رد|غلط|سيء|وحش|لسه مجاش|ماوصلش|موصلش)/i;
const NEGATED_COMPLAINT_RX = /(مفيش\s+مشكله|مفيش\s+مشكلة|مافيش\s+مشكله|مافيش\s+مشكلة|لا\s+توجد\s+مشكله|لا\s+توجد\s+مشكلة|مش\s+مشكله|مش\s+مشكلة)/i;
const RECOVERY_RX = /(بنعتذر|نعتذر|متاسف|متأسف|حق حضرتك|هنحل|تم الحل|هعوض|هنعوض|تم التصحيح)/i;
const CUSTOMER_ACCEPT_RX = /(تمام|موافق|اوكي|أوكي|ابعت|ابعته|ابعتها|هات|هاته|خلاص|ماشي|يلا|توكلنا)/i;
const CUSTOMER_REJECT_RX = /(مش عايز|مش عاوز|لا شكرا|غالي|مش مناسب|خلاص مش محتاج|مش هطلب)/i;
const MEDICAL_RX = /(جرعه|جرعة|حامل|حمل|رضاع|ضغط|سكر|حساسي|اعراض|أعراض|مضاد حيوي|حقن|مونجارو|اوزمبيك|أوزمبيك|انسولين|إنسولين)/i;
const HIGH_RISK_RX = /(جرعه طفل|جرعة طفل|حامل|حمل|رضاع|تفاعل دوائي|حساسيه شديده|حساسية شديدة|مضاد حيوي بدون روشته|حقن بدون روشته)/i;
const CAUTION_RX = /(استشاره الطبيب|استشارة الطبيب|الدكتور المعالج|لو عندك حساسيه|لو عندك حساسية|لو حامل|لو مرض مزمن|الجرعه حسب|الجرعة حسب)/i;
const TERMINAL_GRATITUDE_RX = /^(?:الف\s+شكر|ألف\s+شكر|شكرا|شكراً|متشكر|متشكرة|تسلم|تسلمي|جزاك\s+الله\s+خير)[\s🌷🌸❤️❤🙏🏻🙏]*$/i;

function terminalGratitudeUnanswered(session: WhatsAppConversationSession) {
  const meaningful = session.messages.filter((m) => m.direction !== 'system' && m.text.trim().length > 0);
  const last = meaningful[meaningful.length - 1];
  return Boolean(last?.direction === 'inbound' && TERMINAL_GRATITUDE_RX.test(last.text.trim()));
}

function evidence(messages: WhatsAppParsedMessage[], rx: RegExp) {
  return idsFor(messages, rx).slice(0, 8);
}

function complaintEvidence(messages: WhatsAppParsedMessage[]) {
  return messages
    .filter((message) =>
      message.direction === 'inbound' &&
      COMPLAINT_RX.test(message.text || '') &&
      !NEGATED_COMPLAINT_RX.test(message.text || '')
    )
    .map((message) => message.id)
    .slice(0, 8);
}

function stage(key: JourneyStage['key'], label: string, detected: boolean, confidence: number, reason: string, messageIds: string[]): JourneyStage {
  return { key, label, detected, confidence: clamp(confidence, 0, 100), reason, evidenceMessageIds: messageIds };
}

function analyzeJourney(session: WhatsAppConversationSession) {
  const all = allText(session);
  const out = outboundText(session);
  const inbound = inboundText(session);
  const signals = extractConversationSignals(session);
  const complaintIds = complaintEvidence(session.messages);
  const hasComplaint = complaintIds.length > 0;

  const journeyStages: JourneyStage[] = [
    stage('opening', 'افتتاح المحادثة', signals.greetingDetected, signals.greetingDetected ? 95 : 70, signals.greetingDetected ? 'تم اكتشاف ترحيب/تعريف واضح.' : 'لم يظهر ترحيب واضح في النص.', evidence(session.messages, /(اهلا|أهلا|السلام عليكم|مع حضرتك|صيدليات دواء)/i)),
    stage('need', 'رصد احتياج العميل', has(inbound, NEED_RX), has(inbound, NEED_RX) ? 90 : 55, has(inbound, NEED_RX) ? 'العميل عبّر عن احتياج أو طلب واضح؛ هذا يثبت وجود الطلب ولا يثبت وحده أن الصيدلية فهمت كل تفاصيله.' : 'لم يتم إثبات احتياج واضح من النص وحده.', evidence(session.messages.filter((m) => m.direction === 'inbound'), NEED_RX)),
    stage('availability', 'التحقق من التوفر', has(out, AVAILABILITY_RX), has(out, AVAILABILITY_RX) ? 88 : 50, has(out, AVAILABILITY_RX) ? 'يوجد رد من الصيدلية متعلق بالتوفر/النواقص.' : 'لا يوجد رد صريح من الصيدلية يثبت التوفر أو عدمه.', evidence(session.messages.filter((m) => m.direction === 'outbound'), AVAILABILITY_RX)),
    stage('alternative', 'عرض بديل/ترشيح', has(out, ALTERNATIVE_RX), has(out, ALTERNATIVE_RX) ? 90 : 55, has(out, ALTERNATIVE_RX) ? 'تم اكتشاف عرض بديل أو ترشيح.' : 'لم يظهر عرض بديل واضح.', evidence(session.messages, ALTERNATIVE_RX)),
    stage('closing', 'إغلاق البيع', has(out, SALE_CLOSE_RX), has(out, SALE_CLOSE_RX) ? 92 : 58, has(out, SALE_CLOSE_RX) ? 'يوجد رد من الصيدلية يثبت تأكيد/إغلاق الطلب.' : 'لا يوجد تأكيد إغلاق من الصيدلية داخل النص.', evidence(session.messages.filter((m) => m.direction === 'outbound'), SALE_CLOSE_RX)),
    stage('delivery', 'تنسيق التوصيل', has(all, DELIVERY_RX), has(all, DELIVERY_RX) ? 92 : 50, has(all, DELIVERY_RX) ? 'تم اكتشاف تنسيق توصيل/عنوان/مندوب.' : 'مسار التوصيل غير مثبت.', evidence(session.messages, DELIVERY_RX)),
    stage('followup', 'المتابعة', has(out, FOLLOWUP_RX), has(out, FOLLOWUP_RX) ? 90 : 55, has(out, FOLLOWUP_RX) ? 'يوجد وعد متابعة أو رجوع للعميل.' : 'لا يوجد وعد متابعة واضح.', evidence(session.messages, FOLLOWUP_RX)),
    stage('complaint_recovery', 'احتواء الشكوى', hasComplaint, hasComplaint ? (has(out, RECOVERY_RX) ? 94 : 78) : 45, hasComplaint ? (has(out, RECOVERY_RX) ? 'تم اكتشاف شكوى مع محاولة احتواء/تصحيح.' : 'تم اكتشاف شكوى بدون دليل كافٍ على احتوائها.') : 'لا توجد شكوى واضحة.', complaintIds),
  ];

  const lostSales: LostSaleSignal[] = [];
  const customerAsked = has(inbound, NEED_RX);
  const customerPurchaseIntent = has(inbound, PURCHASE_INTENT_RX);
  const explicitClose = has(out, SALE_CLOSE_RX);
  const rejected = has(inbound, CUSTOMER_REJECT_RX);
  const alternative = has(out, ALTERNATIVE_RX);
  const effectiveUnansweredInboundCount = Math.max(
    0,
    signals.unansweredInboundCount - (terminalGratitudeUnanswered(session) ? 1 : 0)
  );
  if (customerPurchaseIntent && !explicitClose && !rejected) {
    lostSales.push({ severity: 'high', summary: 'فرصة بيع بدأت ولم يظهر لها إغلاق واضح أو رفض صريح.', evidenceMessageIds: evidence(session.messages, NEED_RX) });
  }
  if (has(out, /(غير متوفر(?:ه|ة)?|مش متوفر(?:ه|ة)?|مش موجود|ناقص)/i) && !alternative) {
    lostSales.push({
      severity: 'high',
      summary: 'الصيدلية أكدت نقص/عدم توفر بدون بديل واضح؛ فرصة بيع ضائعة محتملة.',
      evidenceMessageIds: evidence(session.messages.filter((m) => m.direction === 'outbound'), /(غير متوفر(?:ه|ة)?|مش متوفر(?:ه|ة)?|مش موجود|ناقص)/i),
    });
  }
  if (signals.repeatedCustomerNudgeDetected || signals.waitsOver10Minutes > 0) {
    lostSales.push({ severity: 'medium', summary: 'تأخير أو تكرار نداء العميل قد يكون أثّر على إتمام البيع.', evidenceMessageIds: signals.responseWaits.filter((x) => (x.seconds || 0) > 600).flatMap((x) => [x.inboundMessageId, ...(x.outboundMessageId ? [x.outboundMessageId] : [])]) });
  }

  let outcome: UnifiedOutcome = 'unknown';
  if (hasComplaint) outcome = has(out, RECOVERY_RX) ? 'complaint_resolved' : 'complaint_unresolved';
  else if (explicitClose && (has(inbound, CUSTOMER_ACCEPT_RX) || has(out, SALE_CLOSE_RX))) outcome = 'sold';
  else if (rejected) outcome = 'not_sold';
  else if (customerPurchaseIntent || has(out, FOLLOWUP_RX) || effectiveUnansweredInboundCount > 0) outcome = 'needs_followup';

  return { journeyStages, lostSales, outcome };
}

function analyzeMedicalSafety(session: WhatsAppConversationSession): MedicalSafetyFlag[] {
  const all = allText(session);
  const out = outboundText(session);
  if (!has(all, MEDICAL_RX)) return [];
  const flags: MedicalSafetyFlag[] = [];
  if (has(all, HIGH_RISK_RX) && !has(out, CAUTION_RX)) {
    flags.push({ severity: 'high', code: 'medical_high_risk_without_caution', summary: 'يوجد سياق طبي عالي الحساسية بدون تنبيه واضح لمراجعة الطبيب/الحالة.', evidenceMessageIds: evidence(session.messages, HIGH_RISK_RX) });
  }
  if (has(all, /(جرعه|جرعة)/i) && !has(out, /(الجرعه|الجرعة|حسب الوزن|حسب سن|حسب العمر|الدكتور المعالج|استشارة الطبيب)/i)) {
    flags.push({ severity: 'medium', code: 'dose_context_incomplete', summary: 'تم ذكر جرعة أو طلب جرعة بدون سياق كافٍ لإثبات أمان التوجيه آليًا.', evidenceMessageIds: evidence(session.messages, /(جرعه|جرعة)/i) });
  }
  if (session.mediaCount > 0 && has(all, MEDICAL_RX)) {
    flags.push({ severity: 'info', code: 'medical_media_missing', summary: 'جزء من السياق الطبي قد يكون داخل صورة/صوت؛ الاعتماد الآلي يجب أن يظل محدودًا.', evidenceMessageIds: session.messages.filter((m) => ['image', 'voice', 'video', 'document'].includes(m.kind)).map((m) => m.id) });
  }
  return flags;
}

function scoreService(session: WhatsAppConversationSession) {
  const s = extractConversationSignals(session);
  let score = 100;
  if (!s.greetingDetected) score -= 10;
  if (!s.closingDetected) score -= 8;
  if (s.firstResponseSeconds == null) score -= 12;
  else if (s.firstResponseSeconds > 600) score -= 25;
  else if (s.firstResponseSeconds > 300) score -= 10;
  score -= Math.min(24, s.unansweredInboundCount * 8);
  if (s.repeatedCustomerNudgeDetected) score -= 12;
  if (s.complaintOrEscalationDetected && !s.apologyDetected) score -= 10;
  return clamp(Math.round(score));
}

function scoreCommercial(session: WhatsAppConversationSession, lostSales: LostSaleSignal[], outcome: UnifiedOutcome) {
  const all = allText(session);
  const out = outboundText(session);
  let score = has(all, NEED_RX) ? 55 : 0;
  if (has(out, ALTERNATIVE_RX)) score += 15;
  if (has(out, SALE_CLOSE_RX)) score += 20;
  if (has(out, DELIVERY_RX)) score += 5;
  if (outcome === 'sold') score += 10;
  if (lostSales.some((x) => x.severity === 'high')) score -= 25;
  if (lostSales.some((x) => x.severity === 'medium')) score -= 10;
  return clamp(Math.round(score));
}

export function buildUnifiedConversationIntelligence(session: WhatsAppConversationSession): UnifiedConversationIntelligence {
  const signals = extractConversationSignals(session);
  const { journeyStages, lostSales, outcome } = analyzeJourney(session);
  const medicalSafetyFlags = analyzeMedicalSafety(session);
  const serviceScore = scoreService(session);
  const commercialScore = scoreCommercial(session, lostSales, outcome);
  const commercialEligible = signals.saleIntentDetected || journeyStages.some((x) => ['need', 'availability', 'alternative', 'closing'].includes(x.key) && x.detected);
  const chatSuggestedSold = outcome === 'sold';
  const effectiveUnansweredInboundCount = Math.max(
    0,
    signals.unansweredInboundCount - (terminalGratitudeUnanswered(session) ? 1 : 0)
  );
  // نقص/عدم توفر بدون بديل (lostSales.severity==='high') هي بالظبط نفس حالة
  // "stockout_recovery" في whatsappConversationEvaluationV2.ts - لازم تتابع، حتى لو
  // outcome نفسه فضل 'unknown' لأن العميل ما استخدمش كلمة NEED_RX المعروفة (زي "موجود؟"
  // بدل "متوفر؟"). عدم التوفر بدون بديل يستاهل متابعة سواء اتصنف كـneeds_followup أو لأ.
  const followupRequired = outcome === 'needs_followup' || outcome === 'complaint_unresolved' || effectiveUnansweredInboundCount > 0 || (signals.followupPromiseDetected && !signals.closingDetected) || lostSales.some((x) => x.severity === 'high');
  const suggestedFollowupReason = outcome === 'complaint_unresolved'
    ? 'شكوى لم يظهر لها حل واضح.'
    : effectiveUnansweredInboundCount > 0
      ? 'يوجد رسالة من العميل بدون رد لاحق ظاهر.'
      : signals.followupPromiseDetected && !signals.closingDetected
        ? 'تم وعد العميل بالرجوع ولم يظهر إغلاق واضح داخل الجلسة.'
        : outcome === 'needs_followup'
          ? 'فرصة/طلب لم يصل لإغلاق واضح.'
          : null;

  const highMedical = medicalSafetyFlags.some((x) => x.severity === 'high');
  const highLostSale = lostSales.some((x) => x.severity === 'high');
  const priority: UnifiedPriority = highMedical || highLostSale || outcome === 'complaint_unresolved' || effectiveUnansweredInboundCount > 1
    ? 'urgent'
    : followupRequired || medicalSafetyFlags.some((x) => x.severity === 'medium') || lostSales.length > 0
      ? 'important'
      : 'normal';

  const confidencePenalty = session.mediaCount > 0 ? Math.min(25, session.mediaCount * 5) : 0;
  const confidence = clamp(Math.round((signals.deterministicConfidence + 90) / 2 - confidencePenalty));
  const requiresHumanApproval = highMedical || confidence < 78 || session.mediaCount > 0 || priority === 'urgent';

  const strengths = unique([
    ...(signals.greetingDetected ? ['ترحيب واضح'] : []),
    ...(signals.firstResponseSeconds != null && signals.firstResponseSeconds <= 300 ? ['سرعة رد جيدة'] : []),
    ...(journeyStages.find((x) => x.key === 'alternative')?.detected ? ['اقتراح بديل/ترشيح'] : []),
    ...(outcome === 'sold' ? ['إغلاق بيع ظاهر من النص'] : []),
    ...(outcome === 'complaint_resolved' ? ['احتواء شكوى'] : []),
  ]);
  const weaknesses = unique([
    ...lostSales.map((x) => x.summary),
    ...medicalSafetyFlags.filter((x) => x.severity !== 'info').map((x) => x.summary),
    ...(signals.waitsOver10Minutes > 0 ? [`${signals.waitsOver10Minutes} انتظار أطول من 10 دقائق`] : []),
    ...(effectiveUnansweredInboundCount > 0 ? [`${effectiveUnansweredInboundCount} رسالة عميل بلا رد لاحق ظاهر`] : []),
  ]);

  const outcomeLabel: Record<UnifiedOutcome, string> = {
    sold: 'بيع ظاهر من المحادثة',
    not_sold: 'لم يتم البيع',
    needs_followup: 'تحتاج متابعة',
    complaint_resolved: 'شكوى تم احتواؤها',
    complaint_unresolved: 'شكوى غير محسومة',
    unknown: 'غير محسومة',
  };
  const executiveSummary = `${outcomeLabel[outcome]}. خدمة ${serviceScore}%، أداء بيعي ${commercialScore}%. ${followupRequired ? `المتابعة مطلوبة: ${suggestedFollowupReason}` : 'لا توجد متابعة عاجلة مثبتة.'} ${requiresHumanApproval ? 'تحتاج اعتماد بشري قبل الأثر الرسمي.' : 'صالحة لمراجعة بشرية سريعة.'}`;

  return {
    version: 'whatsapp-review-v4',
    outcome,
    priority,
    confidence,
    requiresHumanApproval,
    followupRequired,
    suggestedFollowupReason,
    commercialEligible,
    chatSuggestedSold,
    serviceScore,
    commercialScore,
    journeyStages,
    lostSales,
    medicalSafetyFlags,
    strengths,
    weaknesses,
    executiveSummary,
  };
}

function amountOf(row: CustomerInvoiceReadRow) {
  for (const key of ['net_total', 'net_amount', 'discounted_amount', 'total_amount', 'amount', 'gross_total', 'gross_amount']) {
    const value = Number(row[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

const rowDate = (row: CustomerInvoiceReadRow) => String(row.invoice_date || row.sale_date || '').trim() || null;
const rowBranch = (row: CustomerInvoiceReadRow) => String(row.branch_name || row.branch || '').trim() || null;
const rowInvoiceNumber = (row: CustomerInvoiceReadRow) => String(row.invoice_number || row.invoice_no || '').trim() || null;
const normalizeBranch = (v?: string | null) => normalizeArabic(v).replace(/^فرع\s+/i, '');
const DAY_MS = 86_400_000;

function extractInvoiceHints(session: WhatsAppConversationSession) {
  const text = allText(session);
  const invoiceNumbers = unique([...text.matchAll(/(?:فاتور(?:ه|ة)|invoice|inv)\s*[:#-]?\s*(\d{3,12})/gi)].map((m) => m[1]));
  const money = [...text.matchAll(/(?:جنيه|ج\.م|egp)?\s*(\d{2,6}(?:[.,]\d{1,2})?)\s*(?:جنيه|ج\.م|egp)/gi)]
    .map((m) => Number(String(m[1]).replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0);
  return { invoiceNumbers, money };
}

function invoiceCandidate(row: CustomerInvoiceReadRow, session: WhatsAppConversationSession, lookup: InvoiceLookup, fallbackIdentityStrategies: string[]): InvoiceCandidate {
  const reasons: string[] = [];
  let score = 0;
  const rowIdentityStrategies = Array.isArray(row.__matched_identity_strategies)
    ? row.__matched_identity_strategies.map(String)
    : fallbackIdentityStrategies;
  const date = rowDate(row);
  const branch = rowBranch(row);
  const number = rowInvoiceNumber(row);
  const amount = amountOf(row);
  const hints = extractInvoiceHints(session);
  const invoiceTs = date ? new Date(date).getTime() : NaN;
  if (Number.isFinite(invoiceTs)) {
    const startTs = session.startedAt.getTime();
    const endTs = session.endedAt.getTime();
    const beforeStartDays = (startTs - invoiceTs) / DAY_MS;
    const afterEndDays = (invoiceTs - endTs) / DAY_MS;
    if (invoiceTs >= startTs - 0.25 * DAY_MS && invoiceTs <= endTs + 1.5 * DAY_MS) {
      score += 42;
      reasons.push(invoiceTs >= startTs && invoiceTs <= endTs ? 'الفاتورة تمت أثناء المحادثة' : 'الفاتورة في نفس يوم/قرب وقت المحادثة');
    } else if (afterEndDays > 1.5 && afterEndDays <= 3) {
      score += 25;
      reasons.push('الفاتورة خلال 3 أيام بعد المحادثة');
    } else if ((beforeStartDays >= 0 && beforeStartDays <= 7) || (afterEndDays >= 0 && afterEndDays <= 7)) {
      score += 8;
      reasons.push('الفاتورة داخل نافذة أسبوع من المحادثة');
    } else {
      score -= 60;
      reasons.push('الفاتورة خارج نافذة 7 أيام');
    }
  }
  if (lookup.branch && branch && normalizeBranch(lookup.branch) === normalizeBranch(branch)) { score += 18; reasons.push('نفس الفرع'); }
  else if (lookup.branch && branch) { score -= 12; reasons.push('الفرع مختلف'); }
  if (number && hints.invoiceNumbers.includes(number)) { score += 40; reasons.push('رقم الفاتورة مذكور بالشات'); }
  if (amount != null && hints.money.some((x) => Math.abs(x - amount) <= Math.max(2, amount * .01))) { score += 18; reasons.push('القيمة قريبة من مبلغ مذكور بالشات'); }
  const identityScore = rowIdentityStrategies.includes('customer_id') || rowIdentityStrategies.includes('code')
    ? 24
    : rowIdentityStrategies.includes('phone')
      ? 22
      : rowIdentityStrategies.includes('phone_tail')
        ? 14
        : rowIdentityStrategies.includes('name')
          ? 6
          : 0;
  if (identityScore > 0) {
    score += identityScore;
    reasons.push(`هوية العميل: ${rowIdentityStrategies.join('+')}`);
  }
  return {
    invoiceId: String(row.id || '').trim() || null,
    invoiceNumber: number,
    invoiceDate: date,
    branch,
    sellerName: String(row.seller_name || row.normalized_seller_name || row.staff_name || '').trim() || null,
    customerCode: String(row.customer_code || '').trim() || null,
    customerName: String(row.customer_name || '').trim() || null,
    amount,
    score,
    confidence: Math.max(0, Math.min(.99, score / 110)),
    reasons,
    matchedIdentityStrategies: rowIdentityStrategies,
  };
}

export async function verifySessionAgainstInvoices(session: WhatsAppConversationSession, lookup: InvoiceLookup): Promise<UnifiedInvoiceVerification> {
  const intelligence = buildUnifiedConversationIntelligence(session);
  if (!intelligence.commercialEligible) {
    return { status: 'not_applicable', bestCandidate: null, candidates: [], verificationConfidence: 1, revenue: null, reason: 'الجلسة ليست فرصة بيع مؤهلة.', warnings: [] };
  }
  if (!(lookup.customerId || lookup.customerCode || lookup.customerPhone || lookup.customerName)) {
    return { status: 'needs_review', bestCandidate: null, candidates: [], verificationConfidence: 0, revenue: null, reason: 'هوية العميل غير كافية لمطابقة الفاتورة.', warnings: ['أدخل كود/هاتف/اسم العميل قبل الاعتماد.'] };
  }
  const result = await readCustomerInvoices({ customerId: lookup.customerId, customerCode: lookup.customerCode, customerPhone: lookup.customerPhone, customerName: lookup.customerName });
  const candidates = result.rows.map((row) => invoiceCandidate(row, session, lookup, result.matchedStrategies)).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  const best = candidates[0] || null;
  if (!best) return { status: 'not_found', bestCandidate: null, candidates, verificationConfidence: .75, revenue: null, reason: 'لم توجد فاتورة مرتبطة بقوة كافية.', warnings: result.warnings };
  const runnerUp = candidates.find((candidate) => candidate.invoiceId !== best.invoiceId) || null;
  const explicitInvoiceHint = best.reasons.includes('رقم الفاتورة مذكور بالشات');
  const ambiguousTop = Boolean(
    runnerUp &&
    !explicitInvoiceHint &&
    Math.abs(best.score - runnerUp.score) <= 8
  );
  if (ambiguousTop) {
    return {
      status: 'needs_review',
      bestCandidate: best,
      candidates,
      verificationConfidence: Math.min(best.confidence, .6),
      revenue: best.amount,
      reason: 'يوجد أكثر من فاتورة قريبة جدًا في قوة التطابق؛ يلزم اختيار بشري قبل الاعتماد.',
      warnings: [...result.warnings, 'ambiguous_top_invoice_candidates'],
    };
  }
  if (best.confidence >= .82) return { status: 'verified', bestCandidate: best, candidates, verificationConfidence: best.confidence, revenue: best.amount, reason: 'تطابق قوي بين هوية العميل وتوقيت/سياق المحادثة والفاتورة.', warnings: result.warnings };
  if (best.confidence >= .62) return { status: 'probable', bestCandidate: best, candidates, verificationConfidence: best.confidence, revenue: best.amount, reason: 'تطابق مرجح يحتاج مراجعة بشرية.', warnings: result.warnings };
  return { status: 'needs_review', bestCandidate: best, candidates, verificationConfidence: best.confidence, revenue: best.amount, reason: 'يوجد مرشح فاتورة لكن قوة التطابق غير كافية.', warnings: result.warnings };
}

export function summarizePortfolio(sessions: WhatsAppConversationSession[]): PortfolioSummary {
  const models = sessions.map(buildUnifiedConversationIntelligence);
  const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
  const salesEligible = models.filter((x) => x.commercialEligible).length;
  const suggestedSold = models.filter((x) => x.chatSuggestedSold).length;
  return {
    sessions: models.length,
    urgent: models.filter((x) => x.priority === 'urgent').length,
    important: models.filter((x) => x.priority === 'important').length,
    normal: models.filter((x) => x.priority === 'normal').length,
    salesEligible,
    suggestedSold,
    needsFollowup: models.filter((x) => x.followupRequired).length,
    complaints: models.filter((x) => x.outcome === 'complaint_resolved' || x.outcome === 'complaint_unresolved').length,
    averageServiceScore: average(models.map((x) => x.serviceScore)),
    averageCommercialScore: average(models.map((x) => x.commercialScore)),
    conversionSuggestionRate: salesEligible ? Number(((suggestedSold / salesEligible) * 100).toFixed(1)) : null,
  };
}
