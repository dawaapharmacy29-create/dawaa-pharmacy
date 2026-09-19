// SmartOfficialReviewDraftV1 — يحوّل تحليل المحادثة لاقتراح فعلي لكل بند من بنود التقييم
// الرسمي (REVIEW_CRITERIA)، بدل ما المراجع يبدأ من صفحة شبه فاضية. بيعيد استخدام محرك
// الاقتراح الموجود بالفعل (whatsappReviewScoring.ts -> buildOfficialReviewSuggestion) —
// اللي أصلًا بيعمل معظم المطلوب (status/confidence/reason/evidenceMessageIds لكل بند) —
// من غير أي محرك اقتراح موازي جديد. الإضافة هنا بس: تغليف بالـshape المطلوب (applies/
// suggestedChoice/sourceEngine/needsHumanReview) + قرار "يحتاج مراجعة بشرية" أوسع
// (بياخد في الاعتبار الميديا الناقصة كمان، مش بس status البند نفسه).
//
// قيد صارم: الملف ده ممنوع يلمس severe errors خالص — severeErrorAutoApplied ثابتة false
// دايمًا، وده موثّق في الاختبارات. أي اعتماد نهائي لسه محتاج حفظ بشري من Reviews.tsx —
// الملف ده بيرجع اقتراح فقط، مش بيكتب أي نقطة أو درجة.
import { buildOfficialReviewSuggestion, type WhatsAppOfficialReviewSuggestion } from '@/lib/whatsappReviewScoring';
import type { WhatsAppConversationSession } from '@/lib/whatsappConversationParser';
import type { ReviewCriterionKey } from '@/lib/conversationReviews';

const MIN_CONFIDENT_CONFIDENCE = 70;

export interface SmartOfficialReviewDraftCriterion {
  key: ReviewCriterionKey;
  label: string;
  applies: boolean;
  suggestedChoice: string | null;
  suggestedLabel: string;
  confidence: number;
  reason: string;
  evidenceMessageIds: string[];
  sourceEngine: 'whatsapp-review-scoring-v1';
  needsHumanReview: boolean;
}

export interface SmartOfficialReviewDraftV1 {
  version: 'smart-official-review-draft-v1';
  provisionalScore: number | null;
  scoreLabel: string;
  confidentCriteriaCount: number;
  needsReviewCriteriaCount: number;
  topPositives: string[];
  topConcerns: string[];
  criteria: SmartOfficialReviewDraftCriterion[];
  disclaimer: string;
  /** ثابتة false دايمًا — ممنوع اعتماد severe error تلقائيًا في هذه الطبقة. */
  severeErrorAutoApplied: false;
}

function needsHumanReview(item: WhatsAppOfficialReviewSuggestion['items'][number], missingMediaMessageIds: Set<string>): boolean {
  if (item.status === 'review_required') return true;
  if (item.confidence < MIN_CONFIDENT_CONFIDENCE) return true;
  if (item.evidenceMessageIds.some((id) => missingMediaMessageIds.has(id))) return true;
  return false;
}

export function buildSmartOfficialReviewDraftV1(
  session: WhatsAppConversationSession,
  customerName?: string | null,
  options?: { missingMediaMessageIds?: string[] }
): SmartOfficialReviewDraftV1 {
  const suggestion = buildOfficialReviewSuggestion(session, customerName);
  const missingMedia = new Set(options?.missingMediaMessageIds || []);

  const criteria: SmartOfficialReviewDraftCriterion[] = suggestion.items.map((item) => ({
    key: item.key,
    label: item.label,
    applies: item.status !== 'not_applicable',
    suggestedChoice: item.selectedOption,
    suggestedLabel: item.selectedLabel,
    confidence: item.confidence,
    reason: item.reason,
    evidenceMessageIds: item.evidenceMessageIds,
    sourceEngine: 'whatsapp-review-scoring-v1',
    needsHumanReview: needsHumanReview(item, missingMedia),
  }));

  const confidentCriteriaCount = criteria.filter((c) => c.applies && !c.needsHumanReview).length;
  const needsReviewCriteriaCount = criteria.filter((c) => c.needsHumanReview).length;

  const topPositives = criteria
    .filter((c) => c.applies && !c.needsHumanReview && c.confidence >= 85)
    .slice(0, 3)
    .map((c) => `${c.label}: ${c.suggestedLabel}`);
  const topConcerns = criteria
    .filter((c) => c.needsHumanReview)
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
