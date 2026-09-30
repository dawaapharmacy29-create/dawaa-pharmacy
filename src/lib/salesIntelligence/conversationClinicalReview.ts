import type { CaseIntelligenceView } from './types';

export interface ConversationClinicalReviewSection {
  present: boolean;
  evidenceMessageIds: string[];
  triggerMessageIds: string[];
  mediaContextMissing: boolean;
  reason: string;
}

export interface ConversationClinicalReview {
  version: 'conversation-clinical-review-v1';
  caseId: string;
  detected: boolean;
  manualReviewOnly: true;
  consultation: ConversationClinicalReviewSection;
  dosageUsage: ConversationClinicalReviewSection;
}

const CONSULTATION_CONTEXT_RX =
  /(?:استشار(?:ة|ه)|تشخيص|اعراض|أعراض|حامل|حمل|رضاع(?:ة|ه)|مرضع|طفل|رضيع|حساسي(?:ة|ه)|ضغط|سكر|حرار(?:ة|ه)|كح(?:ة|ه)|اسهال|إسهال|قيء|ترجيع|استفراغ|دوخ(?:ة|ه)|التهاب|صداع|وجع|ألم|الم|رشح|برد|جرح|تداخل|يتعارض|روشت(?:ة|ه)|تحليل|مناسب\s+(?:ل|مع)|آمن\s+(?:ل|مع)|امن\s+(?:ل|مع))/i;

const DOSAGE_USAGE_RX =
  /(?:جرع(?:ة|ه)|طريق(?:ة|ه)\s*الاستخدام|طريقة\s*الإستخدام|(?:مرة|مره|مرتين|ثلاث\s*مرات|اربع\s*مرات|أربع\s*مرات)\s*(?:في|ف)?\s*(?:اليوم|يوميا|يوميًا)?|كل\s*\d+\s*(?:ساع(?:ة|ه)|ساعات)|(?:قبل|بعد)\s*(?:الاكل|الأكل)|على\s*الريق|لمد(?:ة|ه)\s*\d+\s*(?:يوم|ايام|أيام)|(?:خد|خدي|خدوا|ياخد|تاخد|تاخدي|يتاخد|تؤخذ|استخدم|استخدمي|يستخدم)\s+[^\n]{0,40}(?:قرص|كبسول(?:ة|ه)|مل|ملي|نقط(?:ة|ه)?|بخ(?:ة|ه)|بختين|ملعق(?:ة|ه)|معلق(?:ة|ه)))/i;

const MEDIA_PLACEHOLDER_RX =
  /(?:<image omitted>|<voice message omitted>|audio omitted|<video omitted>|<document omitted>|صورة محذوفة|صوت محذوف|فيديو محذوف)/i;

function ordered(view: CaseIntelligenceView) {
  return view.interaction.messages
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

function contextWindow(
  messages: CaseIntelligenceView['interaction']['messages'],
  triggerIds: string[]
): string[] {
  const triggerSet = new Set(triggerIds);
  const indexes = messages
    .map((message, index) => triggerSet.has(message.id) ? index : -1)
    .filter((index) => index >= 0);
  const picked = new Set<string>();
  for (const index of indexes) {
    for (let i = Math.max(0, index - 2); i <= Math.min(messages.length - 1, index + 2); i += 1) {
      const message = messages[i];
      if (message.role === 'system') continue;
      picked.add(message.id);
    }
  }
  return messages.filter((message) => picked.has(message.id)).map((message) => message.id);
}

function section(
  messages: CaseIntelligenceView['interaction']['messages'],
  triggerMessageIds: string[],
  kind: 'consultation' | 'dosage'
): ConversationClinicalReviewSection {
  if (!triggerMessageIds.length) {
    return {
      present: false,
      evidenceMessageIds: [],
      triggerMessageIds: [],
      mediaContextMissing: false,
      reason: kind === 'consultation'
        ? 'لم يتم رصد سياق استشارة طبية واضح في النص المتاح.'
        : 'لم يتم رصد شرح جرعة أو طريقة استخدام في رسائل الموظف.',
    };
  }
  const evidenceMessageIds = contextWindow(messages, triggerMessageIds);
  const evidenceSet = new Set(evidenceMessageIds);
  const mediaContextMissing = messages.some(
    (message) => evidenceSet.has(message.id) && MEDIA_PLACEHOLDER_RX.test(message.text)
  );
  return {
    present: true,
    evidenceMessageIds,
    triggerMessageIds,
    mediaContextMissing,
    reason: kind === 'consultation'
      ? 'تم رصد سياق استشارة/حالة صحية. يُعرض للمراجعة منفصلًا ولا يصدر عنه تقييم طبي آلي.'
      : 'تم رصد شرح جرعة أو طريقة استخدام في رسالة موظف. يُعرض للمراجعة منفصلًا ولا يصدر عنه تقييم طبي آلي.',
  };
}

/**
 * Router only — NOT a medical evaluator.
 * It detects clinical/usage context and isolates the nearby conversation slice for a human reviewer.
 * It never decides whether advice, dose, product choice or usage instructions are medically correct.
 */
export function buildConversationClinicalReview(view: CaseIntelligenceView): ConversationClinicalReview {
  const messages = ordered(view);
  const consultationTriggers = messages
    .filter((message) => message.meaningful && CONSULTATION_CONTEXT_RX.test(message.text))
    .map((message) => message.id);
  const dosageTriggers = messages
    .filter(
      (message) =>
        message.role === 'staff' &&
        message.meaningful &&
        DOSAGE_USAGE_RX.test(message.text)
    )
    .map((message) => message.id);

  const consultation = section(messages, consultationTriggers, 'consultation');
  const dosageUsage = section(messages, dosageTriggers, 'dosage');

  return {
    version: 'conversation-clinical-review-v1',
    caseId: view.caseId,
    detected: consultation.present || dosageUsage.present,
    manualReviewOnly: true,
    consultation,
    dosageUsage,
  };
}
