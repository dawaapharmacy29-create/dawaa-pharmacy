import { analyzeWhatsAppChat, type AnalyzeWhatsAppOptions, type WhatsAppChatAnalysis } from './whatsappChatAnalyzer';
import { analyzeConversationJourney, type JourneyAnalysis } from './conversationJourneyAnalyzer';
import { analyzeMedicalSafety, type MedicalSafetyReview } from './medicalSafetyGuard';

export type ConversationPriority = 'normal' | 'important' | 'urgent';

export type FullConversationIntelligence = {
  base: WhatsAppChatAnalysis;
  journey: JourneyAnalysis;
  medicalSafety: MedicalSafetyReview;
  executiveSummary: string;
  priority: ConversationPriority;
  requiresHumanApproval: boolean;
  commercialScore: number;
  serviceScore: number;
  detectedStrengths: string[];
  detectedWeaknesses: string[];
  followupRequired: boolean;
  suggestedFollowupReason: string | null;
};

function average(values: Array<number | null | undefined>) {
  const nums = values.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export function analyzeFullConversation(raw: string, options: AnalyzeWhatsAppOptions = {}): FullConversationIntelligence {
  const base = analyzeWhatsAppChat(raw, options);
  const journey = analyzeConversationJourney(base);
  const medicalSafety = analyzeMedicalSafety(base);

  const commercialKeys = ['sales_closing', 'cross_sell_upsell', 'understanding', 'followup_after_wait'];
  const serviceKeys = ['first_response_speed', 'greeting', 'doctor_name', 'tone', 'closing_message', 'angry_customer'];
  const commercialScore = average(base.criteria.filter((c) => commercialKeys.includes(c.key) && c.applies).map((c) => c.score == null ? null : (c.score / c.maxScore) * 100));
  const serviceScore = average(base.criteria.filter((c) => serviceKeys.includes(c.key) && c.applies).map((c) => c.score == null ? null : (c.score / c.maxScore) * 100));

  const detectedStrengths = [...new Set([
    ...base.positives,
    ...(journey.outcome === 'sold' ? ['إغلاق بيع واضح'] : []),
    ...(journey.stages.some((s) => s.stage === 'alternative') ? ['اقتراح بدائل'] : []),
    ...(journey.stages.some((s) => s.stage === 'complaint_recovery') && journey.outcome === 'complaint_resolved' ? ['احتواء شكوى العميل'] : []),
  ])];

  const detectedWeaknesses = [...new Set([
    ...base.risks,
    ...journey.lostSales.map((x) => x.summary),
    ...medicalSafety.flags.filter((x) => x.severity !== 'info').map((x) => x.summary),
  ])];

  const urgentCommercial = journey.lostSales.some((x) => x.severity === 'high');
  const urgentMedical = medicalSafety.flags.some((x) => x.severity === 'high');
  const priority: ConversationPriority = urgentMedical || urgentCommercial || base.metrics.unansweredCustomerMessages > 1
    ? 'urgent'
    : detectedWeaknesses.length > 0
      ? 'important'
      : 'normal';

  const followupRequired = journey.outcome === 'needs_followup' || journey.outcome === 'complaint_unresolved' || base.metrics.unansweredCustomerMessages > 0 || base.metrics.missedPromisedFollowups > 0;
  const suggestedFollowupReason = journey.outcome === 'complaint_unresolved'
    ? 'شكوى لم يظهر لها حل واضح في المحادثة.'
    : base.metrics.missedPromisedFollowups > 0
      ? 'وعد بالرجوع للعميل لم يُستكمل.'
      : base.metrics.unansweredCustomerMessages > 0
        ? 'يوجد رسالة/رسائل من العميل بدون رد لاحق ظاهر.'
        : journey.outcome === 'needs_followup'
          ? 'المحادثة انتهت بدون إغلاق واضح وتحتاج متابعة.'
          : null;

  const requiresHumanApproval = medicalSafety.requiresHumanReview || base.manualReviewReasons.length > 0 || base.overallConfidence < .72;

  const executiveSummary = [
    `النتيجة: ${journey.outcome === 'sold' ? 'تم البيع' : journey.outcome === 'needs_followup' ? 'تحتاج متابعة' : journey.outcome === 'complaint_resolved' ? 'شكوى تم احتواؤها' : journey.outcome === 'complaint_unresolved' ? 'شكوى غير محسومة' : journey.outcome === 'not_sold' ? 'لم يظهر بيع مكتمل' : 'غير محسومة'}.`,
    `الخدمة ${serviceScore}%، الأداء البيعي ${commercialScore}%.`,
    followupRequired ? `المتابعة مطلوبة: ${suggestedFollowupReason}` : 'لا توجد متابعة عاجلة ظاهرة من النص.',
    requiresHumanApproval ? 'الاعتماد النهائي يحتاج مراجعة بشرية.' : 'الثقة كافية لاقتراح التقييم مع بقاء حق المراجع في التعديل.',
  ].join(' ');

  return {
    base,
    journey,
    medicalSafety,
    executiveSummary,
    priority,
    requiresHumanApproval,
    commercialScore,
    serviceScore,
    detectedStrengths,
    detectedWeaknesses,
    followupRequired,
    suggestedFollowupReason,
  };
}
