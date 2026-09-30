import type { CaseIntelligenceView } from './types';
import {
  analyzeConversationEvaluation,
  type ConversationEvaluationResult,
} from './conversationEvaluation';
import {
  loadConversationEvaluationSystemEvidence,
  type ConversationEvaluationSystemEvidenceSnapshot,
} from './conversationEvaluationSystemEvidence';

export interface LoadedConversationEvaluation {
  result: ConversationEvaluationResult;
  systemEvidence: ConversationEvaluationSystemEvidenceSnapshot | null;
  systemEvidenceLoaded: boolean;
  warning: string | null;
}

/**
 * Read-only UI boundary for the final conversation evaluation.
 *
 * Failure to load operational/system truth must NEVER become a negative score. The pure analyzer
 * receives null in that case and turns only affected applicable criteria into insufficient_evidence.
 */
export async function loadConversationEvaluation(
  view: CaseIntelligenceView
): Promise<LoadedConversationEvaluation> {
  try {
    const systemEvidence = await loadConversationEvaluationSystemEvidence(view);
    return {
      result: analyzeConversationEvaluation(view, systemEvidence),
      systemEvidence,
      systemEvidenceLoaded: true,
      warning: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر تحميل أدلة النظام.';
    return {
      result: analyzeConversationEvaluation(view, null),
      systemEvidence: null,
      systemEvidenceLoaded: false,
      warning: `تعذر تحميل بعض أدلة النظام: ${message}. البنود المتأثرة لم تحصل على خصم تلقائي.`,
    };
  }
}
