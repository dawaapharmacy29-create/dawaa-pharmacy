import type { WhatsAppConversationSession } from './whatsappConversationParser';
import { classifySmartConversation } from './whatsappSmartReviewCore';
import { buildSmartQuickDecision, type SmartQuickDecisionResult } from './whatsappSmartReviewDecision';
import { applySmartReviewMessageScope, type SmartReviewScopeInput, type SmartReviewScopeResult } from './whatsappSmartReviewScope';
import type { SmartConversationReviewResult, SmartOwnedReviewSummary } from './whatsappSmartReviewResult';
import type { SmartStaffRole } from './whatsappSmartReviewOwnership';

export interface SmartReviewPipelineInput extends SmartReviewScopeInput {
  invoiceVerified?: boolean;
  invoiceMatchAmbiguous?: boolean;
}

export interface SmartReviewPipelineResult {
  scope: SmartReviewScopeResult;
  review: SmartConversationReviewResult | null;
  decision: SmartQuickDecisionResult;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function emptyDecision(reasons: string[]): SmartQuickDecisionResult {
  return {
    decision: 'detailed_review',
    reasons: unique(reasons),
    affectedCriteria: [],
    evidenceMessageIds: [],
    safeToQuickApprove: false,
  };
}

function buildScopedSummary(
  scoredSession: WhatsAppConversationSession,
  staffName: string,
  role: SmartStaffRole,
  options?: { invoiceVerified?: boolean; invoiceMatchAmbiguous?: boolean },
): SmartOwnedReviewSummary {
  const classified = classifySmartConversation(scoredSession, options);
  const responseSeconds = classified.responseTurns
    .map((turn) => turn.responseLatencySeconds)
    .filter((value): value is number => Number.isFinite(value));

  return {
    staffName,
    role,
    startedAt: scoredSession.startedAt,
    endedAt: scoredSession.endedAt,
    messageIds: scoredSession.messages.map((message) => message.id),
    inboundCount: scoredSession.messages.filter((message) => message.direction === 'inbound').length,
    outboundCount: scoredSession.messages.filter((message) => message.direction === 'outbound').length,
    primaryTypes: classified.primaryType === 'unknown' ? [] : [classified.primaryType],
    journey: classified.journey,
    finalIntent: classified.finalIntent,
    outcome: classified.outcome,
    responseTurnCount: classified.responseTurns.length,
    unansweredTurns: classified.responseTurns.filter((turn) => turn.noResponse).length,
    slowResponseTurns: classified.responseTurns.filter((turn) => !turn.noResponse && Number(turn.responseLatencySeconds) > 600).length,
    maxResponseSeconds: responseSeconds.length ? Math.max(...responseSeconds) : null,
    suggestedReviewCriteria: classified.suggestedReviewCriteria,
    reviewReasons: classified.reviewReasons,
    evidenceMessageIds: classified.evidenceMessageIds,
    requiresHumanReview: classified.requiresHumanReview,
  };
}

export function runSmartReviewPipeline(
  session: WhatsAppConversationSession,
  input: SmartReviewPipelineInput,
): SmartReviewPipelineResult {
  const scope = applySmartReviewMessageScope(session, input);
  if (!scope.valid || !scope.scoredSession) {
    return { scope, review: null, decision: emptyDecision(scope.blockingReasons) };
  }

  if (!input.staffName || !input.role) {
    const reasons = ['اختيار المسؤول والدور مطلوب قبل القرار الذكي على نطاق زمني محدد'];
    return { scope, review: null, decision: emptyDecision(reasons) };
  }

  const summary = buildScopedSummary(scope.scoredSession, input.staffName, input.role, {
    invoiceVerified: input.invoiceVerified,
    invoiceMatchAmbiguous: input.invoiceMatchAmbiguous,
  });

  const blockingReasons = [...scope.blockingReasons];
  if (input.invoiceMatchAmbiguous) blockingReasons.push('ربط الفاتورة غير مؤكد');

  const review: SmartConversationReviewResult = {
    sessionId: scope.scoredSession.id,
    staffSummaries: [summary],
    unassignedMessageIds: [],
    handoffs: [],
    safeForOfficialScoring: blockingReasons.length === 0 && !summary.requiresHumanReview,
    blockingReasons,
  };

  return {
    scope,
    review,
    decision: buildSmartQuickDecision(review, input.staffName),
  };
}
