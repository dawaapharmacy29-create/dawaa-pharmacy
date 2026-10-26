export type ConversationDimensionScaleKey =
  | 'response_speed'
  | 'greeting'
  | 'tone_language'
  | 'understanding'
  | 'follow_up'
  | 'consultation_quality'
  | 'dosage_explanation'
  | 'alternative_handling'
  | 'sales_quality'
  | 'upsell_cross_sell'
  | 'complaint_handling'
  | 'order_confirmation'
  | 'closing_message';

export const CONVERSATION_DIMENSION_MAX_POINTS: Record<ConversationDimensionScaleKey, number> = {
  response_speed: 10,
  greeting: 10,
  tone_language: 10,
  understanding: 10,
  follow_up: 10,
  consultation_quality: 15,
  dosage_explanation: 10,
  alternative_handling: 10,
  sales_quality: 10,
  upsell_cross_sell: 10,
  complaint_handling: 10,
  order_confirmation: 10,
  closing_message: 5,
};

/**
 * conversation_sales_reviews stores raw criterion points, not a universal /10 score.
 * Normalize every dimension to the common 0..10 scale before monthly aggregation.
 * The row-level final/total score is a separate 0..100 scale (see officialConversationReview.ts).
 * Invalid input is missing evidence (null) — never a valid-looking 0 that would drag an average.
 */
export function normalizeConversationDimensionScore(
  key: ConversationDimensionScaleKey,
  rawScore: number
): number | null {
  const maxPoints = CONVERSATION_DIMENSION_MAX_POINTS[key];
  if (!Number.isFinite(rawScore) || !Number.isFinite(maxPoints) || maxPoints <= 0) return null;
  if (rawScore < 0 || rawScore > maxPoints) return null;
  const normalized = (rawScore / maxPoints) * 10;
  return Math.round(normalized * 10) / 10;
}

/** Converts a 0..10 dimension average to the 0..100 row-score scale used for display/thresholds. */
export function dimensionScoreToPercent(score: number | null): number | null {
  return score == null || !Number.isFinite(score) ? null : Math.round(score * 100) / 10;
}
