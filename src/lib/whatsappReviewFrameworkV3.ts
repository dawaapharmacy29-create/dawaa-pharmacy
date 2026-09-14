import type { ReviewCriterionKey } from '@/lib/conversationReviews';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import { extractConversationSignals } from '@/lib/whatsappConversationSignals';
import { buildOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';

export type ReviewTrackKey =
  | 'core'
  | 'sale'
  | 'consultation'
  | 'availability'
  | 'followup'
  | 'complaint'
  | 'delivery';

export interface HistoricalCriterionProfile {
  key: ReviewCriterionKey;
  applicabilityPct: number;
  deductedReviews: number;
  totalPointsLost: number;
}

export interface ReviewTrackModel {
  key: ReviewTrackKey;
  label: string;
  active: boolean;
  confidence: number;
  reason: string;
  criterionKeys: ReviewCriterionKey[];
  historicalApplicabilityNote: string;
  priority: 'core' | 'high' | 'medium' | 'context';
}

export interface WhatsAppReviewFrameworkV3 {
  tracks: ReviewTrackModel[];
  activeTracks: ReviewTrackModel[];
  visibleCriterionKeys: ReviewCriterionKey[];
  hiddenCriterionKeys: ReviewCriterionKey[];
  dominantTrack: ReviewTrackKey;
  dominantTrackLabel: string;
  classificationConfidence: number;
  headline: string;
  rationale: string;
  historicalGuardrails: string[];
}

// Snapshot derived from the full historical review ledger audited on 2026-09-15.
// This calibrates applicability and review priority only. It must never auto-copy old scores.
export const HISTORICAL_CRITERION_PROFILE: HistoricalCriterionProfile[] = [
  { key: 'first_response_speed', applicabilityPct: 99.9, deductedReviews: 47, totalPointsLost: 340 },
  { key: 'greeting', applicabilityPct: 99.9, deductedReviews: 28, totalPointsLost: 231 },
  { key: 'doctor_name', applicabilityPct: 99.9, deductedReviews: 25, totalPointsLost: 245 },
  { key: 'tone', applicabilityPct: 99.5, deductedReviews: 73, totalPointsLost: 267 },
  { key: 'closing_message', applicabilityPct: 99.6, deductedReviews: 214, totalPointsLost: 884 },
  { key: 'understanding', applicabilityPct: 89.8, deductedReviews: 28, totalPointsLost: 140 },
  { key: 'sales_closing', applicabilityPct: 77.4, deductedReviews: 17, totalPointsLost: 138 },
  { key: 'order_confirmation', applicabilityPct: 26.8, deductedReviews: 3, totalPointsLost: 26 },
  { key: 'consultation_quality', applicabilityPct: 10.8, deductedReviews: 17, totalPointsLost: 119 },
  { key: 'followup_after_wait', applicabilityPct: 9.3, deductedReviews: 65, totalPointsLost: 516 },
  { key: 'unavailable_items', applicabilityPct: 8.6, deductedReviews: 26, totalPointsLost: 156 },
  { key: 'customer_request_registration', applicabilityPct: 6.0, deductedReviews: 32, totalPointsLost: 480 },
  { key: 'dosage_explanation', applicabilityPct: 4.6, deductedReviews: 3, totalPointsLost: 25 },
  { key: 'cross_sell_upsell', applicabilityPct: 3.9, deductedReviews: 10, totalPointsLost: 55 },
  { key: 'order_delay_handling', applicabilityPct: 3.0, deductedReviews: 2, totalPointsLost: 20 },
  { key: 'customer_name', applicabilityPct: 2.2, deductedReviews: 3, totalPointsLost: 15 },
  { key: 'angry_customer', applicabilityPct: 1.2, deductedReviews: 6, totalPointsLost: 24 },
  { key: 'exceptional_followup_recognition', applicabilityPct: 0.2, deductedReviews: 1, totalPointsLost: 10 },
  { key: 'purchase_history_usage', applicabilityPct: 0.0, deductedReviews: 0, totalPointsLost: 0 },
];

const CORE_KEYS: ReviewCriterionKey[] = [
  'first_response_speed',
  'greeting',
  'doctor_name',
  'tone',
  'understanding',
  'closing_message',
];

const TRACK_CRITERIA: Record<Exclude<ReviewTrackKey, 'core'>, ReviewCriterionKey[]> = {
  sale: ['sales_closing', 'order_confirmation', 'cross_sell_upsell'],
  consultation: ['consultation_quality', 'dosage_explanation'],
  availability: ['unavailable_items', 'customer_request_registration'],
  followup: ['followup_after_wait', 'exceptional_followup_recognition', 'purchase_history_usage'],
  complaint: ['angry_customer'],
  delivery: ['order_delay_handling', 'order_confirmation'],
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hasText(session: WhatsAppConversationSession, pattern: RegExp, direction?: 'inbound' | 'outbound') {
  return session.messages.some((message) => (!direction || message.direction === direction) && pattern.test(message.text));
}

function profile(key: ReviewCriterionKey) {
  return HISTORICAL_CRITERION_PROFILE.find((item) => item.key === key);
}

function trackApplicabilityNote(keys: ReviewCriterionKey[]) {
  const values = keys.map(profile).filter(Boolean) as HistoricalCriterionProfile[];
  if (!values.length) return '';
  const max = Math.max(...values.map((item) => item.applicabilityPct));
  const min = Math.min(...values.map((item) => item.applicabilityPct));
  return max === min
    ? `تاريخيًا ينطبق في ${max}% من التقييمات.`
    : `تاريخيًا بنود المسار تظهر تقريبًا بين ${min}% و${max}% حسب الحالة.`;
}

export function buildWhatsAppReviewFrameworkV3(
  session: WhatsAppConversationSession,
  customerName?: string | null
): WhatsAppReviewFrameworkV3 {
  const signals = extractConversationSignals(session);
  const review = buildOfficialReviewSuggestion(session, customerName);

  const saleActive = signals.saleIntentDetected || hasText(session, /فاتور|أوردر|اوردر|ابعت|ابعث|اطلب|عاوز|محتاج|كمية|علبة|شريط|قطرة|كريم|سعر/i);
  const consultationActive = hasText(session, /جرع|استخدام|أعراض|اعراض|حامل|رضاع|ضغط|سكر|حساسي|ينفع|مناسب|استشارة|طفل|سن\s|وزن/i);
  const availabilityActive = hasText(session, /مش موجود|مش متوفر|ناقص|بديل|هنوفر|هطلبه|نواقص|غير متاح/i);
  const followupActive = signals.followupPromiseDetected || hasText(session, /لحظات|هراجع|هرجع|هتابع|هكلم|ثواني|دقايق/i, 'outbound');
  const complaintActive = signals.complaintOrEscalationDetected || hasText(session, /زعلان|شكوى|مشكلة|متأخر|تأخير|تستعجل|استعجل|مش راضي|سيئ|وحش/i, 'inbound');
  const deliveryActive = signals.deliveryIntentDetected || hasText(session, /مندوب|توصيل|العنوان|عنوان|خرج لحضرتك|في الطريق|دليفري/i);

  const tracks: ReviewTrackModel[] = [
    {
      key: 'core',
      label: 'الخدمة الأساسية',
      active: true,
      confidence: 100,
      reason: 'المسار الأساسي ينطبق على كل جلسة ذات تفاعل حقيقي: سرعة الرد، البداية، الأسلوب، الفهم والختام.',
      criterionKeys: CORE_KEYS,
      historicalApplicabilityNote: 'خمسة من بنوده ظهرت في أكثر من 99% من التقييمات التاريخية، والفهم في 89.8%.',
      priority: 'core',
    },
    {
      key: 'sale',
      label: 'البيع وإغلاق الطلب',
      active: saleActive,
      confidence: saleActive ? 84 : 72,
      reason: saleActive ? 'تم رصد نية شراء أو طلب/فاتورة.' : 'لا توجد إشارة كافية لفتح مسار البيع.',
      criterionKeys: TRACK_CRITERIA.sale,
      historicalApplicabilityNote: trackApplicabilityNote(TRACK_CRITERIA.sale),
      priority: 'high',
    },
    {
      key: 'consultation',
      label: 'الاستشارة والجرعات',
      active: consultationActive,
      confidence: consultationActive ? 72 : 76,
      reason: consultationActive ? 'تم رصد سياق طبي/استخدام/جرعة يحتاج فهمًا دلاليًا.' : 'لا يوجد سياق طبي واضح يبرر فتح هذا المسار.',
      criterionKeys: TRACK_CRITERIA.consultation,
      historicalApplicabilityNote: trackApplicabilityNote(TRACK_CRITERIA.consultation),
      priority: 'context',
    },
    {
      key: 'availability',
      label: 'النواقص والبدائل',
      active: availabilityActive,
      confidence: availabilityActive ? 88 : 82,
      reason: availabilityActive ? 'تم رصد نقص/عدم توفر/بديل.' : 'لم يتم رصد نقص أو بديل واضح.',
      criterionKeys: TRACK_CRITERIA.availability,
      historicalApplicabilityNote: trackApplicabilityNote(TRACK_CRITERIA.availability),
      priority: 'high',
    },
    {
      key: 'followup',
      label: 'الوعد والمتابعة',
      active: followupActive,
      confidence: followupActive ? 94 : 86,
      reason: followupActive ? 'تم رصد وعد بالرجوع أو المتابعة؛ الزمن بعد الوعد يصبح بندًا محوريًا.' : 'لا يوجد وعد واضح بالرجوع.',
      criterionKeys: TRACK_CRITERIA.followup,
      historicalApplicabilityNote: 'مسار نادر نسبيًا، لكنه تاريخيًا ثاني أكبر مصدر لفقد النقاط بعد الختام.',
      priority: 'high',
    },
    {
      key: 'complaint',
      label: 'الشكوى واحتواء العميل',
      active: complaintActive,
      confidence: complaintActive ? 84 : 80,
      reason: complaintActive ? 'تم رصد شكوى/استعجال/عدم رضا ويجب تقييم الاحتواء والحل.' : 'لا توجد شكوى واضحة في النص.',
      criterionKeys: TRACK_CRITERIA.complaint,
      historicalApplicabilityNote: trackApplicabilityNote(TRACK_CRITERIA.complaint),
      priority: 'high',
    },
    {
      key: 'delivery',
      label: 'الدليفري وتأخير الأوردر',
      active: deliveryActive,
      confidence: deliveryActive ? 90 : 82,
      reason: deliveryActive ? 'تم رصد سياق توصيل؛ يجب فصل سبب التأخير عن طريقة تعامل الدكتور.' : 'لا يوجد سياق توصيل واضح.',
      criterionKeys: TRACK_CRITERIA.delivery,
      historicalApplicabilityNote: trackApplicabilityNote(TRACK_CRITERIA.delivery),
      priority: 'context',
    },
  ];

  const activeTracks = tracks.filter((track) => track.active);
  const visible = new Set<ReviewCriterionKey>(CORE_KEYS);
  activeTracks.forEach((track) => track.criterionKeys.forEach((key) => visible.add(key)));

  // Customer-name personalization only becomes relevant when an actual customer identity is available.
  if (customerName && customerName.trim()) visible.add('customer_name');

  // Database-dependent criteria are not opened merely from text unless the follow-up path exists.
  if (!followupActive) {
    visible.delete('exceptional_followup_recognition');
    visible.delete('purchase_history_usage');
  }

  const visibleCriterionKeys = review.items
    .map((item) => item.key)
    .filter((key) => visible.has(key));
  const hiddenCriterionKeys = review.items
    .map((item) => item.key)
    .filter((key) => !visible.has(key));

  const contextual = activeTracks.filter((track) => track.key !== 'core');
  const dominant = contextual.find((track) => track.key === 'complaint')
    || contextual.find((track) => track.key === 'followup')
    || contextual.find((track) => track.key === 'availability')
    || contextual.find((track) => track.key === 'delivery')
    || contextual.find((track) => track.key === 'consultation')
    || contextual.find((track) => track.key === 'sale')
    || tracks[0];

  const classificationConfidence = clamp(
    activeTracks.reduce((sum, track) => sum + track.confidence, 0) / Math.max(1, activeTracks.length)
      - (signals.mediaCount ? 8 : 0)
  );

  const headline = contextual.length
    ? `جلسة ${dominant.label} + الخدمة الأساسية`
    : 'جلسة خدمة أساسية بدون سيناريو إضافي مؤكد';

  const rationale = contextual.length
    ? `تم فتح ${activeTracks.length} مسار فقط من أصل 7. البنود غير المرتبطة بالسياق مخفية بدل تحويلها تلقائيًا إلى «تحتاج مراجعة».`
    : 'لا توجد أدلة كافية على بيع/استشارة/نقص/متابعة/شكوى/دليفري، لذلك يظل التقييم مركزًا على البنود الأساسية فقط.';

  return {
    tracks,
    activeTracks,
    visibleCriterionKeys,
    hiddenCriterionKeys,
    dominantTrack: dominant.key,
    dominantTrackLabel: dominant.label,
    classificationConfidence,
    headline,
    rationale,
    historicalGuardrails: [
      'السجل التاريخي يستخدم لمعايرة انطباق البنود والأولوية فقط، وليس لنسخ الدرجة القديمة.',
      'لا يُفتح بند سياقي إلا بوجود دليل على انطباقه في المحادثة الحالية.',
      'سبب الدليفري أو المخزون لا يتحول تلقائيًا إلى خصم على الدكتور؛ الذي يُقيّم هو طريقة التعامل والمتابعة.',
      'البنود الطبية والدلالية تحتاج Evidence وفهم للسياق قبل الحسم النهائي.',
    ],
  };
}
