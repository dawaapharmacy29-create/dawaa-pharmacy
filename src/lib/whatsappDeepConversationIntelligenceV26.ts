export type SampleQuality = 'insufficient' | 'limited' | 'usable' | 'strong';

export type ResponseMetricSummary = {
  count: number;
  averageSeconds: number | null;
  medianSeconds: number | null;
  p90Seconds: number | null;
  p95Seconds: number | null;
  maxSeconds: number | null;
  over5Minutes: number;
  over10Minutes: number;
  unanswered: number;
};

export type DeepJourneyStage = 'consultation' | 'objection' | 'upsell';

export type DeepJourneySignal = {
  stage: DeepJourneyStage;
  detected: boolean;
  confidence: number;
  evidenceMessageIds: string[];
  reason: string;
};

export type LostReasonCode =
  | 'stockout_dead_end'
  | 'price_objection_unhandled'
  | 'no_close'
  | 'no_followup'
  | 'no_cross_sell'
  | 'slow_response'
  | 'unanswered_customer'
  | 'customer_no_reply_after_offer'
  | 'unknown';

export type MedicalHardGate = {
  blocked: boolean;
  reasons: string[];
  requiresPharmacistReview: boolean;
};

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};

const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;

export function summarizeResponseMetrics(turns: Array<{ response_latency_seconds?: number | null; no_response?: boolean | null }>): ResponseMetricSummary {
  // Number(null) === 0 في JS، فلو فلترنا بعد التحويل، الـTurns اللي معندهاش رد
  // (response_latency_seconds: null, no_response: true) كانت بتتحسب غلط كرد بـ0 ثانية
  // بدل ما تتستبعد، وده بيلخبط count والمتوسط والـPercentiles كلهم.
  const measured = turns
    .map((row) => row.response_latency_seconds)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return {
    count: measured.length,
    averageSeconds: average(measured),
    medianSeconds: percentile(measured, 50),
    p90Seconds: percentile(measured, 90),
    p95Seconds: percentile(measured, 95),
    maxSeconds: measured.length ? Math.max(...measured) : null,
    over5Minutes: measured.filter((value) => value > 300).length,
    over10Minutes: measured.filter((value) => value > 600).length,
    unanswered: turns.filter((row) => Boolean(row.no_response)).length,
  };
}

export function classifySampleQuality(eligibleConversations: number): { quality: SampleQuality; label: string } {
  if (eligibleConversations < 3) return { quality: 'insufficient', label: 'عينة غير كافية للحكم' };
  if (eligibleConversations < 8) return { quality: 'limited', label: 'عينة محدودة — تُقرأ بحذر' };
  if (eligibleConversations < 20) return { quality: 'usable', label: 'عينة قابلة للاستخدام' };
  return { quality: 'strong', label: 'عينة قوية' };
}

const CONSULTATION_RX = /(اعراض|أعراض|جرعة|استخدام|ينفع|مناسب|حامل|رضاعة|سكر|ضغط|حساسية|كحة|حرارة|سخونية|وجع|التهاب|طفل|طفلة)/i;
const OBJECTION_RX = /(غالي|سعره عالي|مش مناسب|مش عايز|مش عاوز|هفكر|خليني اشوف|مش مقتنع|أرخص|ارخص)/i;
const UPSELL_RX = /(تحب|ممكن نضيف|نضيف|معاه|كمان|عرض|باكدج|حجم اكبر|حجم أكبر|لو محتاج)/i;

export type CommercialClosingResponsibilityV27 = 'pharmacy' | 'customer' | 'inventory' | 'unknown';

export type CommercialFrictionFactsV26 = {
  stockout: boolean;
  alternativeOffered: boolean;
  priceObjection: boolean;
  chatClosed: boolean;
  closingResponsibility: CommercialClosingResponsibilityV27;
  closingEvidence: string | null;
};

export function detectCommercialFrictionFactsV26(
  messages: Array<{ text?: string | null; direction?: string | null }>
): CommercialFrictionFactsV26 {
  const outbound = messages.filter((message) => message.direction === 'outbound').map((message) => String(message.text || '')).join('\n');
  const inbound = messages.filter((message) => message.direction === 'inbound').map((message) => String(message.text || '')).join('\n');
  const all = messages.map((message) => String(message.text || '')).join('\n');
  const stockout = /(غير متوفر|مش موجود|ناقص|خلص)/i.test(outbound);
  const alternativeOffered = /(بديل|نرشح|ارشح|أرشح|بداله|بدلها)/i.test(outbound);
  const priceObjection = /(غالي|سعره عالي|أرخص|ارخص|مش مناسب|هفكر)/i.test(inbound);
  const chatClosed = /(تم تأكيد|تم التاكيد|الأوردر اتأكد|الاوردر اتاكد|جاري الارسال|جاري الإرسال|فاتورة|فاتوره|الإجمالي|الاجمالي)/i.test(all);

  const AVAILABILITY_OR_OFFER_RX = /(موجود|متوفر|متاح|بديل|نرشح|ارشح|أرشح|بداله|بدلها)/i;
  const CUSTOMER_ACCEPT_RX = /(^|\s)(تمام|ماشي|موافق|اوكي|أوكي|خلاص|ابعت|ابعته|ابعتي|هات|هاته|هاخده|هاخدها)(\s|$)/i;
  const CUSTOMER_REQUEST_RX = /(عايز|عاوز|محتاج|متوفر|موجود|سعر|بكام|ابعت|ابعث|طلب|اوردر|أوردر)/i;

  let closingResponsibility: CommercialClosingResponsibilityV27 = 'unknown';
  let closingEvidence: string | null = null;

  if (!chatClosed && stockout) {
    closingResponsibility = 'inventory';
    closingEvidence = 'العائق المثبت هو عدم توافر الصنف من رد الصيدلية.';
  } else if (!chatClosed) {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (message.direction !== 'outbound' || !AVAILABILITY_OR_OFFER_RX.test(String(message.text || ''))) continue;
      const later = messages.slice(index + 1, index + 5);
      const accepted = later.find((row) => row.direction === 'inbound' && CUSTOMER_ACCEPT_RX.test(String(row.text || '')));
      if (accepted) {
        closingResponsibility = 'pharmacy';
        closingEvidence = 'العميل وافق بعد عرض/تأكيد الصيدلية ولم يظهر تأكيد نهائي للأوردر.';
        break;
      }
      const laterInbound = messages.slice(index + 1).find((row) => row.direction === 'inbound');
      if (!laterInbound && messages.slice(0, index).some((row) => row.direction === 'inbound' && CUSTOMER_REQUEST_RX.test(String(row.text || '')))) {
        closingResponsibility = 'customer';
        closingEvidence = 'الصيدلية قدمت ردًا تجاريًا ولم يظهر رد لاحق من العميل.';
      }
    }
  }

  return {
    // Stock state must come from the pharmacy side. A customer asking "مش موجود؟" is not evidence
    // that stock is actually unavailable.
    stockout,
    alternativeOffered,
    priceObjection,
    // Conversation closure only; this is intentionally NOT named/provided as invoice-proven sale.
    chatClosed,
    closingResponsibility,
    closingEvidence,
  };
}

export function detectDeepJourneyStages(messages: Array<{ id: string; text?: string | null; direction?: string | null }>): DeepJourneySignal[] {
  const scan = (rx: RegExp, direction?: string) => messages.filter((m) => (!direction || m.direction === direction) && rx.test(String(m.text || '')));
  const consultation = scan(CONSULTATION_RX);
  const objections = scan(OBJECTION_RX, 'inbound');
  const upsell = scan(UPSELL_RX, 'outbound');
  return [
    { stage: 'consultation', detected: consultation.length > 0, confidence: consultation.length ? 86 : 45, evidenceMessageIds: consultation.map((m) => m.id).slice(0, 8), reason: consultation.length ? 'تم رصد استشارة/فهم حالة أو استخدام.' : 'لا يوجد دليل نصي كافٍ على مرحلة استشارة.' },
    { stage: 'objection', detected: objections.length > 0, confidence: objections.length ? 91 : 50, evidenceMessageIds: objections.map((m) => m.id).slice(0, 8), reason: objections.length ? 'تم رصد اعتراض أو تردد من العميل.' : 'لم يظهر اعتراض واضح.' },
    { stage: 'upsell', detected: upsell.length > 0, confidence: upsell.length ? 82 : 50, evidenceMessageIds: upsell.map((m) => m.id).slice(0, 8), reason: upsell.length ? 'تم رصد محاولة بيع إضافي/تكميلي.' : 'لم يظهر Upsell واضح.' },
  ];
}

export function deriveLostReasonCodes(input: {
  stockout?: boolean;
  alternativeOffered?: boolean;
  priceObjection?: boolean;
  sold?: boolean;
  followupPromised?: boolean;
  followupCompleted?: boolean;
  upsellDetected?: boolean;
  salesEligible?: boolean;
  p90ResponseSeconds?: number | null;
  unanswered?: number;
  closingResponsibility?: CommercialClosingResponsibilityV27;
}) {
  const reasons: LostReasonCode[] = [];
  if (input.stockout && !input.alternativeOffered) reasons.push('stockout_dead_end');
  if (input.priceObjection && !input.sold && !input.alternativeOffered) reasons.push('price_objection_unhandled');
  if (input.salesEligible && !input.sold && (input.closingResponsibility == null || input.closingResponsibility === 'pharmacy')) reasons.push('no_close');
  if (input.salesEligible && !input.sold && input.closingResponsibility === 'customer') reasons.push('customer_no_reply_after_offer');
  if (input.followupPromised && !input.followupCompleted) reasons.push('no_followup');
  if (input.sold && !input.upsellDetected) reasons.push('no_cross_sell');
  if ((input.p90ResponseSeconds || 0) > 600) reasons.push('slow_response');
  if ((input.unanswered || 0) > 0) reasons.push('unanswered_customer');
  return reasons.length ? [...new Set(reasons)] : ['unknown'];
}

const DOSE_RX = /(\d+\s*(مجم|mg|مل|ml|قرص|كبسول|مرة|مرتين|ثلاث مرات)|قبل الاكل|بعد الاكل|كل \d+ ساعات)/i;
const CHILD_RX = /(طفل|طفلة|رضيع|رضيعة|سن\s*\d+|عمره|عمرها)/i;
const PREGNANCY_RX = /(حامل|حمل|رضاعة|مرضع)/i;
const INTERACTION_RX = /(تفاعل|تداخل دوائي|مع دواء|بياخد|بتاخد|دواء مزمن|ادوية مزمنة|أدوية مزمنة)/i;
const ALLERGY_RX = /(حساسية|حساسيه|تحسس)/i;
const RED_FLAG_RX = /(ضيق نفس|الم صدر|ألم صدر|نزيف|إغماء|اغماء|تشنج|زرقة|حساسية شديدة|حساسيه شديده)/i;

export function evaluateMedicalHardGate(messages: Array<{ text?: string | null }>): MedicalHardGate {
  const all = messages.map((m) => String(m.text || '')).join('\n');
  const reasons: string[] = [];
  if (DOSE_RX.test(all)) reasons.push('جرعة أو طريقة استخدام');
  if (CHILD_RX.test(all)) reasons.push('طفل/عمر صغير');
  if (PREGNANCY_RX.test(all)) reasons.push('حمل أو رضاعة');
  if (INTERACTION_RX.test(all)) reasons.push('تداخلات أو أدوية مصاحبة');
  if (ALLERGY_RX.test(all)) reasons.push('حساسية');
  if (RED_FLAG_RX.test(all)) reasons.push('Red Flag صحي محتمل');
  return { blocked: reasons.length > 0, reasons, requiresPharmacistReview: reasons.length > 0 };
}

export function buildExplainableInvoiceMatchScore(input: {
  sameBranch?: boolean;
  sameDayOrNear?: boolean;
  withinThreeDays?: boolean;
  invoiceNumberMentioned?: boolean;
  amountMatched?: boolean;
  customerCodeMatched?: boolean;
  customerIdMatched?: boolean;
  phoneMatched?: boolean;
  phoneTailMatched?: boolean;
  nameOnlyMatched?: boolean;
}) {
  let score = 0;
  const reasons: string[] = [];
  const add = (condition: boolean | undefined, points: number, reason: string) => { if (condition) { score += points; reasons.push(`${reason} +${points}`); } };
  add(input.sameDayOrNear, 42, 'توقيت الفاتورة قريب جدًا من المحادثة');
  add(!input.sameDayOrNear && input.withinThreeDays, 25, 'الفاتورة خلال 3 أيام');
  add(input.sameBranch, 18, 'نفس الفرع');
  add(input.invoiceNumberMentioned, 40, 'رقم الفاتورة مذكور بالشات');
  add(input.amountMatched, 18, 'قيمة الفاتورة قريبة من مبلغ مذكور');
  add(input.customerCodeMatched, 24, 'تطابق كود العميل');
  add(input.customerIdMatched, 24, 'تطابق معرف العميل');
  add(input.phoneMatched, 22, 'تطابق الهاتف');
  add(input.phoneTailMatched, 14, 'تطابق آخر أرقام الهاتف');
  add(input.nameOnlyMatched, 6, 'تطابق الاسم فقط');
  const confidence = Math.max(0, Math.min(0.99, score / 110));
  return { score, confidence: Number(confidence.toFixed(2)), reasons };
}
