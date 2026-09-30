function normalizeDevelopmentEvidenceText(value: unknown) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u0623\u0625\u0622]/g, 'ا')
    .replace(/\u0649/g, 'ي')
    .replace(/\u0629/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const GENERIC_CONVERSATION_SCORE_SUMMARIES = new Set([
  'تقييم محادثة ممتاز',
  'تقييم محادثة قوي',
  'تقييم محادثة جيد بدون تاثير نقاط',
  'تقييم محادثة اقل من 85',
  'تقييم محادثة اقل من 80',
  'تقييم محادثة ضعيف',
  'تقييم محادثة حرج',
].map(normalizeDevelopmentEvidenceText));

export function isActionableDevelopmentIssue(value: unknown) {
  const normalized = normalizeDevelopmentEvidenceText(value);
  if (normalized.length < 4) return false;
  return !GENERIC_CONVERSATION_SCORE_SUMMARIES.has(normalized);
}

export function isActionableTrainingRecommendation(value: unknown) {
  const normalized = normalizeDevelopmentEvidenceText(value);
  if (normalized.length < 4) return false;
  if (normalized.startsWith(normalizeDevelopmentEvidenceText('لا توجد توصية تدريب واضحة'))) return false;
  return true;
}
