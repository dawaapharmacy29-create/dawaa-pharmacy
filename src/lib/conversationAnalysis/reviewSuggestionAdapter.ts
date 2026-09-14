import { REVIEW_CRITERIA, type ConversationReviewState } from '@/lib/conversationReviews';
import type { CriterionAssessment, WhatsAppChatAnalysis } from './whatsappChatAnalyzer';

function chooseByScore(key: string, score: number | null) {
  const criterion = REVIEW_CRITERIA.find((c) => c.key === key);
  if (!criterion || score == null) return criterion?.defaultChoice || '';
  const sorted = [...criterion.choices].sort((a, b) => Math.abs(a.pointsEarned - score) - Math.abs(b.pointsEarned - score));
  return sorted[0]?.value || criterion.defaultChoice;
}

function assessmentFor(analysis: WhatsAppChatAnalysis, key: string): CriterionAssessment | undefined {
  return analysis.criteria.find((item) => item.key === key);
}

export function buildReviewSuggestionState(analysis: WhatsAppChatAnalysis): ConversationReviewState {
  return REVIEW_CRITERIA.reduce((acc, criterion) => {
    const detected = assessmentFor(analysis, criterion.key);
    acc[criterion.key] = {
      applies: detected ? detected.applies : criterion.defaultApplies,
      choice: detected ? chooseByScore(criterion.key, detected.score) : criterion.defaultChoice,
      notes: detected
        ? [detected.summary, detected.evidence[0]?.excerpt ? `دليل: ${detected.evidence[0].excerpt}` : ''].filter(Boolean).join('\n')
        : 'لم يتم تحليل هذا البند آليًا بعد؛ يحتاج مراجعة بشرية.',
    };
    return acc;
  }, {} as ConversationReviewState);
}

export function buildSmartReviewNotes(analysis: WhatsAppChatAnalysis) {
  const positive = analysis.positives.length ? `إيجابيات: ${analysis.positives.join('، ')}` : '';
  const risks = analysis.risks.length ? `مخاطر: ${analysis.risks.join(' | ')}` : '';
  const training = analysis.training.length ? `تدريب مقترح: ${analysis.training.join(' | ')}` : '';
  const review = analysis.manualReviewReasons.length ? `يحتاج مراجعة بشرية: ${analysis.manualReviewReasons.join(' | ')}` : '';
  return [positive, risks, training, review].filter(Boolean).join('\n');
}
