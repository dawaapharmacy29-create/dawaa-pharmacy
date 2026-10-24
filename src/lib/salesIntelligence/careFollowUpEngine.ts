// Care follow-up for service (nursing) cases — separate from sales recovery and complaints.
//
// Pure: derives at most ONE suggestion per case with a deterministic key, so re-analysis can
// never duplicate it. It never creates an action, sends a message or assigns a person; customer
// service decides. Whether it is still actionable is a display-time question (dueAt vs now): an
// old case shows "was due", never a new task dated in the past.
import type { NormalizedConversationMessageV32 } from '../whatsappConversationUnderstandingV32';
import type { ConversationCase } from './types';

export interface CareFollowUpSuggestion {
  key: string;
  kind: 'care_check_in';
  team: 'customer_service';
  /** Arabic, built only from facts found in the case messages. */
  reason: string;
  problems: Array<'device_problem' | 'leak' | 'delay' | 'symptom'>;
  dueAt: string;
  evidenceMessageIds: string[];
}

/** Check in with the patient's family a few hours after the last message of the service case. */
export const CARE_CHECK_IN_DELAY_MS = 4 * 60 * 60 * 1000;

const NURSING_CASE_RULES = ['case.classification.nursing_visit_service_not_sale', 'case.classification.nursing_chase_service_not_sale'];
const PROBLEM_RX: Array<[CareFollowUpSuggestion['problems'][number], RegExp, string]> = [
  ['device_problem', /الكانيولا|كانيولا|اتحرك(?:ت)?\s*(?:م|من)?\s*مكان/u, 'مشكلة في الكانيولا'],
  ['leak', /بيسرب|تسريب|سرب/u, 'تسريب المحلول'],
  ['symptom', /(?:عنده|عندها)\s*(?:حرار[ةه]|وجع|ألم|الم)|تعبان[ةه]?|ورم|نزيف/u, 'أعراض لدى المريض'],
];
const DELAY_RX = /شوفه\s+تاني|فين\s+الممرض|الممرض\s+(?:فين|مجاش)|اتأخر|التأخير|عالتاخير|متأخر|مجاش\s+لسه/u;

export function deriveCareFollowUpSuggestion(
  conversationCase: Pick<ConversationCase, 'caseId' | 'caseType' | 'endedAt' | 'confidence'>,
  messages: Array<Pick<NormalizedConversationMessageV32, 'id' | 'role' | 'text' | 'isMeaningful'>>
): CareFollowUpSuggestion | null {
  const nursing = conversationCase.caseType === 'follow_up' &&
    conversationCase.confidence.ruleIds.some((rule) => NURSING_CASE_RULES.includes(rule));
  if (!nursing) return null;
  const problems = new Set<CareFollowUpSuggestion['problems'][number]>();
  const labels: string[] = [];
  const evidence = new Set<string>();
  for (const message of messages) {
    if (!message.isMeaningful) continue;
    if (message.role === 'customer') {
      for (const [problem, rx, label] of PROBLEM_RX) {
        if (rx.test(message.text) && !problems.has(problem)) {
          problems.add(problem);
          labels.push(label);
          evidence.add(message.id);
        }
      }
    }
    if (DELAY_RX.test(message.text)) {
      if (!problems.has('delay')) labels.push('تأخر الممرض');
      problems.add('delay');
      evidence.add(message.id);
    }
  }
  if (!problems.size) return null;
  return {
    key: `${conversationCase.caseId}:care_check_in`,
    kind: 'care_check_in',
    team: 'customer_service',
    reason: `اطمئنان على المريض بعد خدمة التمريض: ${labels.join('، ')}. تواصل خدمة العملاء للاطمئنان، منفصل عن البيع والشكوى.`,
    problems: [...problems],
    dueAt: new Date(new Date(conversationCase.endedAt).getTime() + CARE_CHECK_IN_DELAY_MS).toISOString(),
    evidenceMessageIds: [...evidence],
  };
}

export type CareFollowUpDispositionKind = 'historical_suggestion' | 'pending_suggestion';

/**
 * What a care suggestion IS at display time. No path creates a task from it (no projector reads
 * careFollowUp), so it is never an open operational task: a past due time is a historical
 * suggestion whose present-day value is a human decision for customer service; a future due time
 * is a pending suggestion. Neither sends a message or creates an action.
 */
export function careFollowUpDisposition(
  suggestion: Pick<CareFollowUpSuggestion, 'dueAt'>,
  now: Date
): { kind: CareFollowUpDispositionKind; taskExists: false; label: string; humanReview: string | null } {
  if (careFollowUpState(suggestion, now) === 'was_due_historically') {
    return {
      kind: 'historical_suggestion',
      taskExists: false,
      label: 'اقتراح تاريخي — كان مستحقًا بعد الواقعة، ولا توجد مهمة مفتوحة ولا تُنشأ مهمة بتاريخ قديم.',
      humanReview: 'مراجعة بشرية مقترحة: يقرر فريق خدمة العملاء إن كان الاطمئنان على المريض ما زال مناسبًا الآن. لا يُرسل شيء تلقائيًا.',
    };
  }
  return {
    kind: 'pending_suggestion',
    taskExists: false,
    label: 'اقتراح فقط — لا توجد مهمة مفتوحة، ولا يُنفذ ولا يُرسل تلقائيًا.',
    humanReview: null,
  };
}

/** Display-time state: a past due time on an old case is history, never a new task. */
export function careFollowUpState(suggestion: Pick<CareFollowUpSuggestion, 'dueAt'>, now: Date): 'due_now_or_later' | 'was_due_historically' {
  return new Date(suggestion.dueAt).getTime() < now.getTime() ? 'was_due_historically' : 'due_now_or_later';
}
