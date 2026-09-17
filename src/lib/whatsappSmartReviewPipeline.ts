import type { WhatsAppConversationSession } from './whatsappConversationParser';
import { classifySmartConversation } from './whatsappSmartReviewCore';
import { analyzeSmartConversationDeep, type SmartDeepConversationAnalysis } from './whatsappSmartConversationIntelligence';
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
  conversationIntelligence: SmartDeepConversationAnalysis | null;
  intelligence: SmartDeepConversationAnalysis | null;
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

function deepReviewReasons(deep: SmartDeepConversationAnalysis) {
  const reasons: string[] = [];
  if (deep.salesOpportunities.some((item) => item.handling === 'missed')) reasons.push('ظهرت فرصة بيع واضحة بدون توجيه أو إغلاق كافٍ');
  if (deep.salesOpportunities.some((item) => item.handling === 'partial')) reasons.push('فرصة البيع اتعالجت جزئيًا وكان ممكن إغلاقها بشكل أفضل');
  if (deep.consultationCommunication === 'weak') reasons.push('أسلوب شرح الاستشارة غير كافٍ ويحتاج مراجعة');
  if (deep.consultationCommunication === 'partial') reasons.push('شرح الاستشارة موجود لكنه غير مكتمل');
  if (deep.unavailableItem.detected && !deep.unavailableItem.alternativeOffered && !deep.unavailableItem.requestRegistered) {
    reasons.push('الصنف غير متاح ولم يظهر بديل أو تسجيل طلب للعميل');
  }
  if (deep.unavailableItem.detected && deep.unavailableItem.alternativeOffered && !deep.unavailableItem.alternativeExplained) {
    reasons.push('تم عرض بديل لكن لم يظهر شرح كافٍ للبديل');
  }
  if (deep.customerRequest.detected && deep.customerRequest.needsConfirmation) reasons.push('تم رصد طلب عميل لكن بياناته غير مكتملة وتحتاج تأكيد');
  return reasons;
}

function buildScopedSummary(
  scoredSession: WhatsAppConversationSession,
  staffName: string,
  role: SmartStaffRole,
  deep: SmartDeepConversationAnalysis,
  options?: { invoiceVerified?: boolean; invoiceMatchAmbiguous?: boolean },
): SmartOwnedReviewSummary {
  const classified = classifySmartConversation(scoredSession, options);
  const responseSeconds = classified.responseTurns
    .map((turn) => turn.responseLatencySeconds)
    .filter((value): value is number => Number.isFinite(value));
  const deepReasons = deepReviewReasons(deep);

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
    suggestedReviewCriteria: unique([...classified.suggestedReviewCriteria, ...deep.suggestedCriteria]),
    reviewReasons: unique([...classified.reviewReasons, ...deepReasons]),
    evidenceMessageIds: unique([...classified.evidenceMessageIds, ...deep.evidenceMessageIds]),
    requiresHumanReview: classified.requiresHumanReview || deep.humanReviewRequired,
  };
}

export function runSmartReviewPipeline(
  session: WhatsAppConversationSession,
  input: SmartReviewPipelineInput,
): SmartReviewPipelineResult {
  const conversationIntelligence = analyzeSmartConversationDeep(session);
  const scope = applySmartReviewMessageScope(session, input);
  if (!scope.valid || !scope.scoredSession) {
    return {
      scope,
      review: null,
      decision: emptyDecision(scope.blockingReasons),
      conversationIntelligence,
      intelligence: null,
    };
  }

  if (!input.staffName || !input.role) {
    const reasons = ['اختيار المسؤول والدور مطلوب قبل القرار الذكي على نطاق زمني محدد'];
    return {
      scope,
      review: null,
      decision: emptyDecision(reasons),
      conversationIntelligence,
      intelligence: analyzeSmartConversationDeep(scope.scoredSession),
    };
  }

  const intelligence = analyzeSmartConversationDeep(scope.scoredSession);
  const summary = buildScopedSummary(scope.scoredSession, input.staffName, input.role, intelligence, {
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
    conversationIntelligence,
    intelligence,
  };
}
