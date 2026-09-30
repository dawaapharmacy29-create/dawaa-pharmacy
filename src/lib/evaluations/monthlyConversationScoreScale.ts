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
 */
export function normalizeConversationDimensionScore(
  key: ConversationDimensionScaleKey,
  rawScore: number
) {
  const maxPoints = CONVERSATION_DIMENSION_MAX_POINTS[key];
  if (!Number.isFinite(rawScore) || !Number.isFinite(maxPoints) || maxPoints <= 0) return 0;
  const normalized = (rawScore / maxPoints) * 10;
  return Math.round(Math.max(0, Math.min(10, normalized)) * 10) / 10;
}
