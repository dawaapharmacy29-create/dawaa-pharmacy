import type { ConversationReviewState, SevereErrorsState } from '@/lib/conversationReviews';

// Top-level conversation_sales_reviews flag columns that are DERIVED from the criteria and severe
// errors of an evaluation. A review version must never carry flags from a different evaluation than
// its raw_scores/review_items (e.g. a manager correction inheriting the automatic row's flags), so
// every derived flag is produced here, in one place, from the same state the score was computed
// from. The correction command re-checks each of these rules server-side against raw_scores.
//
// Mapping (criterion choice values from REVIEW_CRITERIA / SEVERE_ERRORS):
//   has_complaint               angry_customer applies, or severe insult       (reviewer save rule)
//   has_medical_error           severe medical_error, or any item errorType medical_error
//   has_invoice_error           severe invoice_error
//   has_delivery_issue          severe delivery_error
//   bad_tone_flag               tone applies and choice in dry|bad|very_bad|insult
//   severe_bad_tone_flag        tone applies and choice in very_bad|insult
//   rushed_response_flag        understanding applies and choice = rushed
//   misunderstood_customer_flag understanding applies and choice in wrong|caused_error
//   bad_alternative_flag        unavailable_items applies and choice = bad_alternative
//   closing_message_used        closing_message applies and choice in official|respectful
//                               (same rule as the automatic writer)
//   follow_up_promised          followup_after_wait applies
export const DERIVED_EVALUATION_FLAG_COLUMNS = [
  'has_complaint',
  'has_medical_error',
  'has_invoice_error',
  'has_delivery_issue',
  'bad_tone_flag',
  'severe_bad_tone_flag',
  'rushed_response_flag',
  'misunderstood_customer_flag',
  'bad_alternative_flag',
  'closing_message_used',
  'follow_up_promised',
] as const;

export type DerivedEvaluationFlagColumn = (typeof DERIVED_EVALUATION_FLAG_COLUMNS)[number];

type CriterionLike = { applies?: boolean; choice?: string } | undefined;

function chose(item: CriterionLike, values: string[]) {
  return Boolean(item?.applies) && values.includes(String(item?.choice ?? ''));
}

export function deriveConversationReviewEvaluationFlags(
  criteria: ConversationReviewState,
  severeErrors: SevereErrorsState,
  reviewItems: Array<{ errorType?: string | null }>
): Record<DerivedEvaluationFlagColumn, boolean> {
  return {
    has_complaint: Boolean(criteria.angry_customer?.applies || severeErrors.insult),
    has_medical_error: Boolean(
      severeErrors.medical_error || reviewItems.some((item) => item.errorType === 'medical_error')
    ),
    has_invoice_error: Boolean(severeErrors.invoice_error),
    has_delivery_issue: Boolean(severeErrors.delivery_error),
    bad_tone_flag: chose(criteria.tone, ['dry', 'bad', 'very_bad', 'insult']),
    severe_bad_tone_flag: chose(criteria.tone, ['very_bad', 'insult']),
    rushed_response_flag: chose(criteria.understanding, ['rushed']),
    misunderstood_customer_flag: chose(criteria.understanding, ['wrong', 'caused_error']),
    bad_alternative_flag: chose(criteria.unavailable_items, ['bad_alternative']),
    closing_message_used: chose(criteria.closing_message, ['official', 'respectful']),
    follow_up_promised: Boolean(criteria.followup_after_wait?.applies),
  };
}
