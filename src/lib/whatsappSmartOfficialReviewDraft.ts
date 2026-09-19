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
  options?: { missingMediaMessageIds?: string[]; journey?: ConversationJourneyResult | null }
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
