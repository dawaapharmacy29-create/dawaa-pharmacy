import {
  MAX_CONVERSATION_PENALTY,
  REVIEW_CRITERIA,
  baseDoctorImpactFromScore,
  conversationLevel,
  evaluateConversationReview,
  type ConversationReviewResult,
  type ConversationReviewState,
  type ReviewCriterionKey,
  type SevereErrorsState,
} from './conversationReviews';
import type { SmartConversationEvaluationV2 } from './whatsappConversationEvaluationV2';

export type SalesJourneyAxisKey =
  | 'discovery'
  | 'conversion'
  | 'basket'
  | 'fulfillment'
  | 'retention';

export interface SalesJourneyAxisResult {
  key: SalesJourneyAxisKey;
  label: string;
  weight: number;
  score: number | null;
  earned: number;
  possible: number;
  applicableCriteria: number;
  summary: string;
}

export interface SalesJourneyReviewV2 extends ConversationReviewResult {
  scoringVersion: 'sales-journey-review-v2';
  legacyScore: number;
  salesJourneyAxes: SalesJourneyAxisResult[];
  activeWeight: number;
  saleOutcomeLabel: string | null;
  saleOutcomeConfidence: number | null;
  growthSignals: {
    convertedSale: boolean;
    verifiedSale: boolean;
    missedSale: boolean;
    crossSellSuccess: boolean;
    followupOpportunities: number;
    orderCompletenessScore: number | null;
  };
}

const AXES: Array<{
  key: SalesJourneyAxisKey;
  label: string;
  weight: number;
  criteria: ReviewCriterionKey[];
}> = [
  {
    key: 'discovery',
    label: 'فهم العميل وفتح فرصة البيع',
    weight: 15,
    criteria: [
      'first_response_speed',
      'greeting',
      'doctor_name',
      'customer_name',
      'tone',
      'understanding',
      'consultation_quality',
      'dosage_explanation',
    ],
  },
  {
    key: 'conversion',
    label: 'تحويل الفرصة إلى بيع',
    weight: 35,
    criteria: ['unavailable_items', 'sales_closing'],
  },
  {
    key: 'basket',
    label: 'زيادة قيمة البيع بشكل مناسب',
    weight: 15,
    criteria: ['cross_sell_upsell', 'purchase_history_usage'],
  },
  {
    key: 'fulfillment',
    label: 'تنفيذ الأوردر باحتراف',
    weight: 15,
    criteria: [
      'order_confirmation',
      'order_delay_handling',
      'customer_request_registration',
      'followup_after_wait',
    ],
  },
  {
    key: 'retention',
    label: 'الاحتفاظ بالعميل والمتابعة',
    weight: 20,
    criteria: [
      'closing_message',
      'exceptional_followup_recognition',
      'angry_customer',
    ],
  },
];

function criterionMax(key: ReviewCriterionKey) {
  return REVIEW_CRITERIA.find((item) => item.key === key)?.maxPoints ?? 0;
}

function criterionScore(
  legacy: ConversationReviewResult,
  state: ConversationReviewState,
  keys: ReviewCriterionKey[]
) {
  let earned = 0;
  let possible = 0;
  let applicableCriteria = 0;

  for (const key of keys) {
    const stateItem = state[key];
    if (!stateItem?.applies) continue;
    const row = legacy.reviewItems.find((item) => item.key === key);
    if (!row) continue;
    applicableCriteria += 1;
    earned += row.pointsEarned;
    possible += criterionMax(key);
  }

  return {
    earned,
    possible,
    applicableCriteria,
    score: possible > 0 ? Math.round((earned / possible) * 100) : null,
  };
}

function shouldAxisApply(
  key: SalesJourneyAxisKey,
  state: ConversationReviewState,
  evaluation?: SmartConversationEvaluationV2 | null
) {
  if (key === 'discovery') return true;

  if (key === 'conversion') {
    return Boolean(
      state.sales_closing?.applies ||
      state.unavailable_items?.applies ||
      (evaluation && evaluation.sale.outcome !== 'not_applicable')
    );
  }

  if (key === 'basket') {
    return Boolean(
      state.cross_sell_upsell?.applies ||
      state.purchase_history_usage?.applies ||
      (evaluation && evaluation.opportunities.detected > 0)
    );
  }

  if (key === 'fulfillment') {
    return Boolean(
      state.order_confirmation?.applies ||
      state.order_delay_handling?.applies ||
      state.customer_request_registration?.applies ||
      state.followup_after_wait?.applies ||
      evaluation?.orderCompleteness.applicable
    );
  }

  return Boolean(
    state.closing_message?.applies ||
    state.exceptional_followup_recognition?.applies ||
    state.angry_customer?.applies ||
    (evaluation && evaluation.followups.length > 0)
  );
}

function axisSummary(
  key: SalesJourneyAxisKey,
  score: number | null,
  evaluation?: SmartConversationEvaluationV2 | null
) {
  if (score == null) return 'غير منطبق على هذه المحادثة.';

  if (key === 'conversion' && evaluation) return evaluation.sale.label;
  if (key === 'fulfillment' && evaluation?.orderCompleteness.applicable) {
    return `اكتمال الأوردر ${evaluation.orderCompleteness.confirmedCount}/${evaluation.orderCompleteness.requiredCount}.`;
  }
  if (key === 'retention' && evaluation) {
    return evaluation.followups.length
      ? `${evaluation.followups.length} فرصة متابعة محتملة بعد المحادثة.`
      : 'لا توجد متابعة إضافية واضحة من التحليل.';
  }
  if (score >= 90) return 'أداء قوي.';
  if (score >= 75) return 'أداء جيد مع فرصة تحسين.';
  if (score >= 60) return 'يحتاج تطوير واضح.';
  return 'محور ضعيف ويحتاج تدخل تدريبي.';
}

export function evaluateSalesJourneyReviewV2(
  state: ConversationReviewState,
  severeErrors: SevereErrorsState,
  evaluation?: SmartConversationEvaluationV2 | null,
  customerType?: string | null
): SalesJourneyReviewV2 {
  const legacy = evaluateConversationReview(state, severeErrors, customerType);

  const axes = AXES.map((axis): SalesJourneyAxisResult => {
    const applicable = shouldAxisApply(axis.key, state, evaluation);
    if (!applicable) {
      return {
        key: axis.key,
        label: axis.label,
        weight: axis.weight,
        score: null,
        earned: 0,
        possible: 0,
        applicableCriteria: 0,
        summary: 'غير منطبق على هذه المحادثة.',
      };
    }

    const raw = criterionScore(legacy, state, axis.criteria);
    return {
      key: axis.key,
      label: axis.label,
      weight: axis.weight,
      ...raw,
      summary: axisSummary(axis.key, raw.score, evaluation),
    };
  });

  const activeAxes = axes.filter((axis) => axis.score != null);
  const activeWeight = activeAxes.reduce((sum, axis) => sum + axis.weight, 0);
  const finalScore = activeWeight
    ? Math.round(
        activeAxes.reduce((sum, axis) => sum + (axis.score || 0) * axis.weight, 0) /
          activeWeight
      )
    : legacy.finalScore;

  const baseDoctorImpact = baseDoctorImpactFromScore(finalScore);
  const doctorPointsImpact = Math.max(
    MAX_CONVERSATION_PENALTY,
    baseDoctorImpact + legacy.extraPenaltyPoints
  );
  const impactStatus: 'approved' | 'pending' =
    doctorPointsImpact < 0 || legacy.hasSevereError ? 'pending' : 'approved';

  const conversion = axes.find((axis) => axis.key === 'conversion');
  const retention = axes.find((axis) => axis.key === 'retention');
  const weakest = activeAxes
    .slice()
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101))[0];

  const mainNegativeReason =
    legacy.extraPenalties[0]?.label ||
    (weakest && (weakest.score ?? 100) < 90
      ? `${weakest.label}: ${weakest.score}%`
      : legacy.mainNegativeReason);

  const verifiedSale = evaluation?.sale.outcome === 'invoice_verified_sale';
  const convertedSale = Boolean(
    evaluation &&
      ['invoice_verified_sale', 'order_confirmed', 'probable_sale'].includes(
        evaluation.sale.outcome
      )
  );

  return {
    ...legacy,
    scoringVersion: 'sales-journey-review-v2',
    legacyScore: legacy.finalScore,
    finalScore,
    level: conversationLevel(finalScore),
    baseDoctorImpact,
    doctorPointsImpact,
    impactStatus,
    impactLabel:
      doctorPointsImpact > 0
        ? `+${doctorPointsImpact} نقاط حافز`
        : doctorPointsImpact < 0
          ? `${doctorPointsImpact} نقاط خصم`
          : '0 — لا يوجد تأثير على النقاط',
    impactReason:
      finalScore >= 96
        ? 'رحلة بيع وخدمة ممتازة'
        : finalScore >= 90
          ? 'رحلة بيع قوية'
          : finalScore >= 85
            ? 'رحلة جيدة مع فرص تطوير'
            : finalScore >= 80
              ? 'رحلة أقل من المستوى المستهدف'
              : 'رحلة بيع تحتاج تحسين واضح',
    mainNegativeReason,
    trainingRecommendation:
      weakest && (weakest.score ?? 100) < 90
        ? `ركز التدريب على محور «${weakest.label}» لأنه الأقل في رحلة العميل الحالية.`
        : legacy.trainingRecommendation,
    salesJourneyAxes: axes,
    activeWeight,
    saleOutcomeLabel: evaluation?.sale.label || null,
    saleOutcomeConfidence: evaluation?.sale.confidence ?? null,
    growthSignals: {
      convertedSale,
      verifiedSale,
      missedSale: legacy.missedSalesOpportunity || evaluation?.sale.outcome === 'lost_opportunity',
      crossSellSuccess: legacy.successfulCrossSell,
      followupOpportunities: evaluation?.followups.length || 0,
      orderCompletenessScore: evaluation?.orderCompleteness.score ?? null,
    },
    // keep explicit references so TS sees these derived axes as intentional context
    mainPositiveReason:
      verifiedSale && (conversion?.score ?? 0) >= 90
        ? 'تم تحويل احتياج العميل إلى بيع مؤكد مع إغلاق قوي.'
        : retention && (retention.score ?? 0) >= 90
          ? 'المحادثة حافظت على العميل وخلقت خطوة متابعة واضحة.'
          : legacy.mainPositiveReason,
  };
}
