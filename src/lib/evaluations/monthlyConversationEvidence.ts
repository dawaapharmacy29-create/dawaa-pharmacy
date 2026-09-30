export const CONVERSATION_STRENGTH_MIN_AVERAGE = 8.5;
export const CONVERSATION_STRENGTH_MIN_SAMPLES = 3;

export type ConversationStrengthEvidenceInput = {
  reviewCount: number;
  coreAverage: number | null;
  complaints?: number | null;
  badTone?: number | null;
  severeBadTone?: number | null;
  criticalErrors?: number | null;
};

export function hasStrongConversationEvidence(input: ConversationStrengthEvidenceInput) {
  if (Number(input.reviewCount || 0) < CONVERSATION_STRENGTH_MIN_SAMPLES) return false;
  if (input.coreAverage === null || Number(input.coreAverage) < CONVERSATION_STRENGTH_MIN_AVERAGE) return false;
  if (Number(input.complaints || 0) > 0) return false;
  if (Number(input.badTone || 0) > 0) return false;
  if (Number(input.severeBadTone || 0) > 0) return false;
  if (Number(input.criticalErrors || 0) > 0) return false;
  return true;
}
