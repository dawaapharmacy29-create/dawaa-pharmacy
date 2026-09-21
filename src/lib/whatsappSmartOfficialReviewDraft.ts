// SmartOfficialReviewDraftV1 — يحوّل تحليل المحادثة لاقتراح فعلي لكل بند من بنود التقييم
// الرسمي (REVIEW_CRITERIA)، بدل ما المراجع يبدأ من صفحة شبه فاضية. بيعيد استخدام محرك
// الاقتراح الموجود بالفعل (whatsappReviewScoring.ts -> buildOfficialReviewSuggestion) —
// اللي أصلًا بيعمل معظم المطلوب (status/confidence/reason/evidenceMessageIds لكل بند) —
// من غير أي محرك اقتراح موازي جديد.
//
// status لكل بند:
//   confident       — applies، ثقة >= العتبة، مفيش دليل بميديا ناقصة، ومفيش تضارب مع V6/Journey.
//                     ده البند الوحيد اللي يستحق prefill تلقائي في reviewState.
//   review_required — إما المحرك الأساسي نفسه غير متأكد، أو الثقة منخفضة، أو الدليل فيه
//                     ميديا ناقصة، أو فيه تضارب صريح بين اقتراح Smart Review وV6/Journey
//                     Cross-check (زي بند بيع مقترح بثقة بينما V6 مبيلقاش أي إشارة بيع خالص).
//   unsupported     — المحرك الأساسي معندهوش أساس كافٍ يقترح عليه حاجة لهذه المحادثة
//                     (يقابل status='not_applicable' في المحرك الأساسي).
//
// قيد صارم: الملف ده ممنوع يلمس severe errors خالص — severeErrorAutoApplied ثابتة false
// دايمًا، وده موثّق في الاختبارات. أي اعتماد نهائي لسه محتاج حفظ بشري من Reviews.tsx —
// الملف ده بيرجع اقتراح فقط، مش بيكتب أي نقطة أو درجة.
import { buildOfficialReviewSuggestion, type ReviewSuggestionStatus } from '@/lib/whatsappReviewScoring';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import type { ReviewCriterionKey } from '@/lib/conversationReviews';
import type { ConversationJourneyResult } from '@/lib/whatsappConversationJourneyClassifier';
import type { SmartConversationEvaluationV2 } from '@/lib/whatsappConversationEvaluationV2';
import type { ConversationTimingV28 } from '@/lib/whatsappConversationTimingV28';

const MIN_CONFIDENT_CONFIDENCE = 70;

// البنود المرتبطة بالبيع — الوحيدة اللي منطقيًا ممكن تتقاطع مع saleState من V6/Journey.
const SALES_RELATED_CRITERIA = new Set<ReviewCriterionKey>(['sales_closing', 'order_confirmation', 'cross_sell_upsell']);

export type SmartCriterionStatus = 'confident' | 'review_required' | 'unsupported';

export interface SmartOfficialCriterionSuggestion {
  criterionKey: ReviewCriterionKey;
  label: string;
  applies: boolean;
  suggestedChoice: string | null;
  suggestedLabel: string;
  confidence: number;
  status: SmartCriterionStatus;
  reason: string;
  evidenceMessageIds: string[];
  sourceEngine: 'whatsapp-review-scoring-v1';
}

export interface SmartOfficialReviewDraftV1 {
  version: 'smart-official-review-draft-v1';
  provisionalScore: number | null;
  scoreLabel: string;
  confidentCriteriaCount: number;
  needsReviewCriteriaCount: number;
  topPositives: string[];
  topConcerns: string[];
  criteria: SmartOfficialCriterionSuggestion[];
  disclaimer: string;
  /** ثابتة false دايمًا — ممنوع اعتماد severe error تلقائيًا في هذه الطبقة. */
  severeErrorAutoApplied: false;
}

/**
 * مُصدَّرة لأغراض الاختبار المباشر — محرك الاقتراح الحالي (whatsappReviewScoring.ts) لسه
 * ما بيوصلش أي بند من بنود البيع لـstatus='assessed' فعليًا (كلها review_required/
 * not_applicable بتصميمه الحالي)، فمفيش سيناريو محادثة حقيقي يفعّل التضارب ده دلوقتي —
 * لكن المنطق جاهز ومُختبر بشكل مباشر، وهيشتغل تلقائيًا أول ما المحرك الأساسي يتطور.
 */
export function conflictsWithJourney(key: ReviewCriterionKey, rawStatus: ReviewSuggestionStatus, journey?: ConversationJourneyResult | null): boolean {
  if (!journey || rawStatus !== 'assessed' || !SALES_RELATED_CRITERIA.has(key)) return false;
  // Smart Review واثق إن فيه بيع/طلب اتأكد، لكن V6/Journey ملقاش أي إشارة بيع خالص — تضارب حقيقي.
  return journey.saleState === 'no_verified_invoice';
}

function resolveStatus(
  rawStatus: ReviewSuggestionStatus,
  confidence: number,
  hasMissingMediaEvidence: boolean,
  hasJourneyConflict: boolean
): SmartCriterionStatus {
  if (rawStatus === 'not_applicable') return 'unsupported';
  if (rawStatus === 'review_required') return 'review_required';
  if (confidence < MIN_CONFIDENT_CONFIDENCE || hasMissingMediaEvidence || hasJourneyConflict) return 'review_required';
  return 'confident';
}

export function buildSmartOfficialReviewDraftV1(
  session: WhatsAppConversationSession,
  customerName?: string | null,
  options?: { missingMediaMessageIds?: string[]; journey?: ConversationJourneyResult | null; evaluationV2?: SmartConversationEvaluationV2 | null; timingV28?: ConversationTimingV28 | null }
): SmartOfficialReviewDraftV1 {
  const suggestion = buildOfficialReviewSuggestion(session, customerName);
  const missingMedia = new Set(options?.missingMediaMessageIds || []);

  const criteria: SmartOfficialCriterionSuggestion[] = suggestion.items.map((item) => {
    const hasMissingMediaEvidence = item.evidenceMessageIds.some((id) => missingMedia.has(id));
    const hasJourneyConflict = conflictsWithJourney(item.key, item.status, options?.journey);
    const status = resolveStatus(item.status, item.confidence, hasMissingMediaEvidence, hasJourneyConflict);
    return {
      criterionKey: item.key,
      label: item.label,
      applies: item.status !== 'not_applicable',
      suggestedChoice: item.selectedOption,
      suggestedLabel: item.selectedLabel,
      confidence: item.confidence,
      status,
      reason: hasJourneyConflict
        ? `${item.reason} (تضارب: V6/Journey ملقاش أي إشارة بيع مؤكدة لهذه المحادثة)`
        : item.reason,
      evidenceMessageIds: item.evidenceMessageIds,
      sourceEngine: 'whatsapp-review-scoring-v1',
    };
  });

  const evalV2 = options?.evaluationV2 || null;
  const timingV28 = options?.timingV28 || null;
  if (evalV2) {
    const byKey = new Map(criteria.map((item) => [item.criterionKey, item]));
    const set = (
      key: ReviewCriterionKey,
      patch: Partial<SmartOfficialCriterionSuggestion>
    ) => {
      const current = byKey.get(key);
      if (current) Object.assign(current, patch);
    };

    // سرعة أول رد تعتمد على الـTurn الفعلي: آخر رسالة للعميل → أول رد صيدلية بعدها.
    // ده يمنع حساب وقت من بداية الـCase أو تحميل دكتور جديد تأخير حصل قبل استلامه.
    if (timingV28?.responseSummary.firstResponseSeconds != null) {
      const seconds = timingV28.responseSummary.firstResponseSeconds;
      const minutes = seconds / 60;
      const choice = minutes <= 5
        ? 'within_5'
        : minutes <= 10
          ? 'five_to_10'
          : minutes <= 20
            ? 'ten_to_20'
            : minutes <= 30
              ? 'over_20'
              : 'over_30';
      const firstTurn = timingV28.responseTurns.find((turn) => turn.responseLatencySeconds === seconds) || timingV28.responseTurns[0];
      set('first_response_speed', {
        applies: true,
        suggestedChoice: choice,
        suggestedLabel: choice === 'within_5'
          ? 'من 0 إلى 5 دقائق'
          : choice === 'five_to_10'
            ? 'أكثر من 5 إلى 10 دقائق'
            : choice === 'ten_to_20'
              ? 'أكثر من 10 إلى 20 دقيقة'
              : choice === 'over_20'
                ? 'أكثر من 20 إلى 30 دقيقة'
                : 'أكثر من 30 دقيقة',
        confidence: 99,
        status: 'confident',
        reason: `زمن أول رد الفعلي محسوب من آخر رسالة في Turn العميل إلى أول رد بعدها: ${Math.max(0, Math.round(seconds / 60))} دقيقة.`,
        evidenceMessageIds: [
          ...(firstTurn?.inboundMessageIds || []),
          ...(firstTurn?.responseMessageId ? [firstTurn.responseMessageId] : []),
        ],
      });
    }

    // افتتاح الرسالة: V2 يفحص عناصر محددة (تحية/الصيدلية/اسم المسؤول/عرض المساعدة)
    // بدل اعتبار أي كلمة ترحيب = رسالة رسمية كاملة.
    if (evalV2.opening.coverage >= 80 && evalV2.opening.score != null) {
      const hasGreeting = evalV2.opening.passed.includes('تحية مناسبة');
      const hasDoctor = evalV2.opening.passed.includes('تعريف المسؤول بنفسه');
      const missing = evalV2.opening.missing.length;
      const choice = missing === 0
        ? 'official_full'
        : hasGreeting && hasDoctor
          ? 'close_with_name'
          : hasGreeting
            ? 'greeting_no_name'
            : 'direct_reply';
      set('greeting', {
        applies: true,
        suggestedChoice: choice,
        suggestedLabel: choice === 'official_full'
          ? 'استخدم الرسالة الرسمية كاملة'
          : choice === 'close_with_name'
            ? 'رسالة قريبة وبها اسم الدكتور'
            : choice === 'greeting_no_name'
              ? 'رحب بدون اسم الدكتور'
              : 'رد مباشرة بدون ترحيب مناسب',
        confidence: evalV2.opening.evidence.confidence,
        status: evalV2.opening.evidence.confidence >= MIN_CONFIDENT_CONFIDENCE ? 'confident' : 'review_required',
        reason: `فحص الافتتاح V2: ${evalV2.opening.passed.join('، ') || 'لا عناصر مكتملة'}${missing ? `؛ الناقص: ${evalV2.opening.missing.join('، ')}` : ''}.`,
        evidenceMessageIds: evalV2.opening.evidence.messageIds,
      });
      set('doctor_name', {
        applies: true,
        suggestedChoice: hasDoctor ? 'start' : 'none',
        suggestedLabel: hasDoctor ? 'ذكر اسمه في بداية المحادثة' : 'لم يذكر اسمه',
        confidence: evalV2.opening.evidence.confidence,
        status: 'confident',
        reason: hasDoctor ? 'تم رصد تعريف المسؤول بنفسه ضمن افتتاح الجلسة.' : 'لم يتم رصد تعريف واضح للمسؤول ضمن افتتاح الجلسة.',
        evidenceMessageIds: evalV2.opening.evidence.messageIds,
      });
    }

    if (evalV2.serviceRecovery.detected) {
      const recoveryScore = evalV2.serviceRecovery.score ?? 0;
      const delayChoice = recoveryScore >= 90
        ? 'handled_full'
        : recoveryScore >= 70
          ? 'informed_only'
          : recoveryScore >= 45
            ? 'late_apology'
            : 'not_informed';

      set('order_delay_handling', {
        applies: evalV2.serviceRecovery.issueType === 'order_delay',
        suggestedChoice: evalV2.serviceRecovery.issueType === 'order_delay' ? delayChoice : null,
        suggestedLabel: evalV2.serviceRecovery.issueType === 'order_delay'
          ? delayChoice === 'handled_full'
            ? 'أبلغ العميل واعتذر وحدد خطوة متابعة واضحة'
            : delayChoice === 'informed_only'
              ? 'اعتذر واهتم لكن التوقيت/المتابعة تحتاج توضيح'
              : delayChoice === 'late_apology'
                ? 'الاعتذار موجود لكن إدارة التأخير ناقصة'
                : 'لم تتم إدارة التأخير بشكل كافٍ'
          : 'استعادة خدمة غير مرتبطة بتأخير أوردر',
        confidence: evalV2.serviceRecovery.confidence,
        status: evalV2.serviceRecovery.issueType === 'order_delay' ? 'confident' : 'review_required',
        reason: `${evalV2.serviceRecovery.summary}${evalV2.serviceRecovery.missing.length ? ` الناقص: ${evalV2.serviceRecovery.missing.join('، ')}.` : ''}`,
        evidenceMessageIds: evalV2.serviceRecovery.evidenceMessageIds,
      });

      // في محادثة recovery لا نعتبر عدم وجود بيع جديد "فرصة ضائعة"؛ الهدف الأساسي
      // هو استعادة رضا العميل وإغلاق مشكلة الطلب السابق.
      if (evalV2.sale.outcome === 'not_applicable') {
        set('sales_closing', {
          applies: false,
          suggestedChoice: null,
          suggestedLabel: 'غير منطبق — المحادثة لاستعادة خدمة وليست رحلة بيع جديدة',
          confidence: 96,
          status: 'unsupported',
          reason: 'المحادثة بدأت كاعتذار/متابعة مشكلة قائمة، ولم يظهر احتياج شرائي جديد من العميل.',
          evidenceMessageIds: evalV2.serviceRecovery.evidenceMessageIds,
        });
        set('cross_sell_upsell', {
          applies: false,
          suggestedChoice: null,
          suggestedLabel: 'غير منطبق على استعادة الخدمة',
          confidence: 96,
          status: 'unsupported',
          reason: 'الأولوية هنا حل المشكلة واستعادة الثقة، وليس الضغط لزيادة السلة.',
          evidenceMessageIds: evalV2.serviceRecovery.evidenceMessageIds,
        });
      }
    }

        // إغلاق البيع لا يعتبر "تم" من مجرد كلمة موافقة؛ نعتمد على مراحل البيع المتدرجة.
    if (evalV2.sale.outcome === 'invoice_verified_sale' || evalV2.sale.outcome === 'order_confirmed') {
      set('sales_closing', {
        applies: true,
        suggestedChoice: 'clear_order',
        suggestedLabel: 'قاد المحادثة لطلب واضح باحتراف',
        confidence: evalV2.sale.outcome === 'invoice_verified_sale' ? Math.max(95, evalV2.sale.confidence) : Math.max(88, evalV2.sale.confidence),
        status: 'confident',
        reason: evalV2.sale.outcome === 'invoice_verified_sale'
          ? `تم إثبات البيع بفاتورة${evalV2.sale.invoiceNumber ? ` رقم ${evalV2.sale.invoiceNumber}` : ''}.`
          : 'تم رصد تأكيد واضح للطلب داخل المحادثة، مع بقاء الفاتورة غير مؤكدة.',
        evidenceMessageIds: evalV2.sale.evidenceMessageIds,
      });
    } else if (evalV2.sale.outcome === 'customer_accepted') {
      set('sales_closing', {
        applies: true,
        suggestedChoice: 'helped',
        suggestedLabel: 'ساعد العميل على القرار بدون ضغط',
        confidence: 72,
        status: 'review_required',
        reason: 'العميل وافق مبدئيًا لكن لا يوجد دليل كافٍ أن الطلب اتنفذ؛ لا نحسبها بيعًا مكتملًا.',
        evidenceMessageIds: evalV2.sale.evidenceMessageIds,
      });
    } else if (evalV2.sale.outcome === 'opportunity_detected' || evalV2.sale.outcome === 'stockout_blocked') {
      set('sales_closing', {
        applies: true,
        suggestedChoice: 'passive',
        suggestedLabel: 'رد فقط بدون محاولة إغلاق رغم وجود فرصة',
        confidence: 68,
        status: 'review_required',
        reason: evalV2.sale.reason,
        evidenceMessageIds: evalV2.sale.evidenceMessageIds,
      });
    }

    if (evalV2.orderCompleteness.applicable && evalV2.orderCompleteness.score != null) {
      const score = evalV2.orderCompleteness.score;
      const choice = evalV2.orderCompleteness.missingCritical.length
        ? 'important_missing'
        : score >= 90
          ? 'full'
          : score >= 70
            ? 'minor_missing'
            : 'many_missing';
      set('order_confirmation', {
        applies: true,
        suggestedChoice: choice,
        suggestedLabel: choice === 'full'
          ? 'أكد كل البيانات المطلوبة'
          : choice === 'minor_missing'
            ? 'ناقص بند بسيط'
            : choice === 'many_missing'
              ? 'ناقص أكثر من بند'
              : 'لم يؤكد بيانات مهمة',
        confidence: 88,
        status: 'confident',
        reason: `اكتمال بيانات الأوردر: ${evalV2.orderCompleteness.confirmedCount}/${evalV2.orderCompleteness.requiredCount}${evalV2.orderCompleteness.missingCritical.length ? `؛ الناقص المهم: ${evalV2.orderCompleteness.missingCritical.join('، ')}` : ''}.`,
        evidenceMessageIds: evalV2.orderCompleteness.items.flatMap((item) => item.evidenceMessageIds).slice(0, 12),
      });
    }

    if (evalV2.closing.score != null && evalV2.closing.coverage >= 70) {
      const score = evalV2.closing.score;
      const completed = ['invoice_verified_sale', 'order_confirmed', 'probable_sale'].includes(evalV2.sale.outcome);
      const choice = score >= 90 ? 'official' : score >= 50 ? 'respectful' : completed ? 'none_completed' : 'left_open';
      set('closing_message', {
        applies: true,
        suggestedChoice: choice,
        suggestedLabel: choice === 'official'
          ? 'استخدم رسالة الختام الرسمية'
          : choice === 'respectful'
            ? 'ختام محترم قريب من الرسمي'
            : choice === 'none_completed'
              ? 'لا يوجد ختام رغم اكتمال المحادثة'
              : 'ترك العميل بدون إغلاق',
        confidence: evalV2.closing.evidence.confidence,
        status: evalV2.closing.evidence.confidence >= MIN_CONFIDENT_CONFIDENCE ? 'confident' : 'review_required',
        reason: `فحص نهاية الجلسة: ${evalV2.closing.passed.join('، ') || 'لا عناصر ختام مكتملة'}${evalV2.closing.missing.length ? `؛ الناقص: ${evalV2.closing.missing.join('، ')}` : ''}.`,
        evidenceMessageIds: evalV2.closing.evidence.messageIds,
      });
    }

    // وجود فرص متابعة ذكية يجعل البند منطبقًا، لكن "هل سجّلها فعليًا" يحتاج قاعدة البيانات.
    if (evalV2.followups.length) {
      set('exceptional_followup_recognition', {
        applies: true,
        suggestedChoice: null,
        suggestedLabel: 'يحتاج مراجعة تسجيل المتابعة',
        confidence: Math.max(...evalV2.followups.map((item) => item.confidence)),
        status: 'review_required',
        reason: `تم اكتشاف ${evalV2.followups.length} فرصة متابعة: ${evalV2.followups.map((item) => item.label).join('، ')}. إثبات التسجيل يحتاج بيانات النظام.`,
        evidenceMessageIds: Array.from(new Set(evalV2.followups.flatMap((item) => item.evidenceMessageIds))).slice(0, 12),
      });
    }

    // Cross-sell لا يتحول لنقطة إيجابية تلقائيًا بدون مراجعة مناسبة المنتج طبيًا.
    if (evalV2.opportunities.explicitCrossSellOffers > 0) {
      set('cross_sell_upsell', {
        applies: true,
        suggestedChoice: null,
        suggestedLabel: 'تم رصد اقتراح إضافي — راجع مناسبته',
        confidence: 75,
        status: 'review_required',
        reason: 'تم رصد محاولة Cross-sell/Up-sell نصيًا، لكن ملاءمة الاقتراح طبيًا وتجاريًا تحتاج مراجعة بشرية.',
        evidenceMessageIds: evalV2.opportunities.evidenceMessageIds,
      });
    }
  }

  const confidentCriteriaCount = criteria.filter((c) => c.status === 'confident').length;
  const needsReviewCriteriaCount = criteria.filter((c) => c.status === 'review_required').length;

  const topPositives = criteria
    .filter((c) => c.status === 'confident' && c.confidence >= 85)
    .slice(0, 3)
    .map((c) => `${c.label}: ${c.suggestedLabel}`);
  const topConcerns = criteria
    .filter((c) => c.status === 'review_required')
    .slice(0, 3)
    .map((c) => `${c.label}: ${c.reason}`);

  return {
    version: 'smart-official-review-draft-v1',
    provisionalScore: suggestion.provisionalScore,
    scoreLabel: suggestion.scoreLabel,
    confidentCriteriaCount,
    needsReviewCriteriaCount,
    topPositives,
    topConcerns,
    criteria,
    disclaimer: suggestion.disclaimer,
    severeErrorAutoApplied: false,
  };
}
