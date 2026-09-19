import type { WhatsAppConversationSession } from './whatsappConversationParser';
import { rankSuggestedCriteriaByHistoricalUse } from './whatsappHistoricalReviewCalibration';
import { classifySmartConversation } from './whatsappSmartReviewCore';
import { analyzeSmartConversationDeep, type SmartDeepConversationAnalysis } from './whatsappSmartConversationIntelligence';
import { refineSmartDeepConversationAnalysis } from './whatsappSmartConversationRefinement';
import { buildSmartReviewQualityGate, type SmartReviewQualityGate } from './whatsappSmartReviewQualityGate';
import { buildSmartQuickDecision, type SmartQuickDecisionResult } from './whatsappSmartReviewDecision';
import { applySmartReviewMessageScope, type SmartReviewScopeInput, type SmartReviewScopeResult } from './whatsappSmartReviewScope';
import type { SmartConversationReviewResult, SmartOwnedReviewSummary } from './whatsappSmartReviewResult';
import type { SmartStaffRole } from './whatsappSmartReviewOwnership';
import { buildUnifiedConversationIntelligence, type UnifiedInvoiceVerification } from './whatsappUnifiedIntelligenceV4';
import { buildWhatsAppOperationalIntelligenceV6 } from './whatsappOperationalIntelligenceV6';
import { classifyConversationJourney, type ConversationJourneyResult } from './whatsappConversationJourneyClassifier';

export interface SmartReviewPipelineInput extends SmartReviewScopeInput {
  invoiceVerified?: boolean;
  invoiceMatchAmbiguous?: boolean;
  /**
   * نتيجة verifySessionAgainstInvoices الحقيقية (V4) — لو متاحة، بتحل محل الـboolean bridge
   * تحت وبتدي saleState/revenue أدق (البيع المؤكد الوحيد = invoiceVerification.status==='verified').
   * الـpipeline لسه sync عمدًا (verifySessionAgainstInvoices نفسها async)، فالـcaller هو اللي
   * بيستدعيها ويمررها هنا — لضمان صفر breaking changes على الـcallers الحاليين اللي ما زالوا
   * بيمروا بس invoiceVerified/invoiceMatchAmbiguous.
   */
  invoiceVerification?: UnifiedInvoiceVerification;
}

export interface SmartReviewPipelineResult {
  scope: SmartReviewScopeResult;
  review: SmartConversationReviewResult | null;
  decision: SmartQuickDecisionResult;
  conversationIntelligence: SmartDeepConversationAnalysis | null;
  intelligence: SmartDeepConversationAnalysis | null;
  qualityGate: SmartReviewQualityGate | null;
  /**
   * Cross-check output فقط (V6/V4-based journey classification) — مصدر مستقل تمامًا عن
   * SmartIntent/analyzeSmartConversationDeep الموجود فوق. Per القرار الحالي (Option a):
   * ما بيغيّرش decision/review/qualityGate خالص، وما بيتلغيش لو staffName/role مش موجودين
   * (بيتحسب على الجلسة كلها مش الـscoped session، عشان ياخد الصورة الكاملة للرحلة). لازم
   * يتعرض في الواجهة بشكل منفصل وواضح، مش يندمج بصمت مع نتيجة SmartIntent.
   *
   * saleState هنا بياخد input.invoiceVerification (نتيجة verifySessionAgainstInvoices
   * الحقيقية) لو الـcaller مررها؛ لو لأ، بيرجع لـfallback من input.invoiceVerified/
   * invoiceMatchAmbiguous (الـbooleans الموجودة بالفعل في الـpipeline من الأول) عشان
   * الـcallers اللي لسه ما اتحدثوش (زي SmartConversationReviewRebuild.tsx) يفضلوا شغالين
   * زي ما هما. البيع المؤكد الوحيد = invoiceVerification.status === 'verified'.
   */
  journeyCrossCheck: ConversationJourneyResult;
}

function fallbackInvoiceVerification(input: Pick<SmartReviewPipelineInput, 'invoiceVerified' | 'invoiceMatchAmbiguous'>): UnifiedInvoiceVerification {
  const status = input.invoiceVerified ? 'verified' : input.invoiceMatchAmbiguous ? 'needs_review' : 'not_applicable';
  return { status, bestCandidate: null, candidates: [], verificationConfidence: status === 'verified' ? 0.9 : status === 'needs_review' ? 0.5 : 1, revenue: null, reason: 'مشتقة من input.invoiceVerified/invoiceMatchAmbiguous — الـcaller لم يمرر نتيجة verifySessionAgainstInvoices الحقيقية.', warnings: [] };
}

function buildJourneyCrossCheck(session: WhatsAppConversationSession, input: SmartReviewPipelineInput): ConversationJourneyResult {
  const base = buildUnifiedConversationIntelligence(session);
  const operational = buildWhatsAppOperationalIntelligenceV6(session, base);
  const invoiceVerification = input.invoiceVerification || fallbackInvoiceVerification(input);
  return classifyConversationJourney(session, operational, base, invoiceVerification);
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
  qualityGate: SmartReviewQualityGate,
  options?: { invoiceVerified?: boolean; invoiceMatchAmbiguous?: boolean },
): SmartOwnedReviewSummary {
  const classified = classifySmartConversation(scoredSession, options);
  const responseSeconds = classified.responseTurns
    .map((turn) => turn.responseLatencySeconds)
    .filter((value): value is number => Number.isFinite(value));
  const deepReasons = deepReviewReasons(deep);
  const rankedCriteria = rankSuggestedCriteriaByHistoricalUse([
    ...classified.suggestedReviewCriteria,
    ...deep.suggestedCriteria,
  ]);

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
    suggestedReviewCriteria: rankedCriteria,
    reviewReasons: unique([...classified.reviewReasons, ...deepReasons, ...qualityGate.reasons]),
    evidenceMessageIds: unique([
      ...classified.evidenceMessageIds,
      ...deep.evidenceMessageIds,
      ...qualityGate.criticalMissingMediaMessageIds,
    ]),
    requiresHumanReview: classified.requiresHumanReview || deep.humanReviewRequired || qualityGate.humanReviewRequired,
  };
}

export function runSmartReviewPipeline(
  session: WhatsAppConversationSession,
  input: SmartReviewPipelineInput,
): SmartReviewPipelineResult {
  const conversationIntelligence = refineSmartDeepConversationAnalysis(session, analyzeSmartConversationDeep(session));
  const journeyCrossCheck = buildJourneyCrossCheck(session, input);
  const scope = applySmartReviewMessageScope(session, input);
  if (!scope.valid || !scope.scoredSession) {
    return {
      scope,
      review: null,
      decision: emptyDecision(scope.blockingReasons),
      conversationIntelligence,
      intelligence: null,
      qualityGate: null,
      journeyCrossCheck,
    };
  }

  const intelligence = refineSmartDeepConversationAnalysis(scope.scoredSession, analyzeSmartConversationDeep(scope.scoredSession));
  const qualityGate = buildSmartReviewQualityGate(scope.scoredSession, intelligence);

  if (!input.staffName || !input.role) {
    const reasons = ['اختيار المسؤول والدور مطلوب قبل القرار الذكي على نطاق زمني محدد', ...qualityGate.reasons];
    return {
      scope,
      review: null,
      decision: emptyDecision(reasons),
      conversationIntelligence,
      intelligence,
      qualityGate,
      journeyCrossCheck,
    };
  }

  const summary = buildScopedSummary(scope.scoredSession, input.staffName, input.role, intelligence, qualityGate, {
    invoiceVerified: input.invoiceVerified,
    invoiceMatchAmbiguous: input.invoiceMatchAmbiguous,
  });

  const blockingReasons = [...scope.blockingReasons];
  if (input.invoiceMatchAmbiguous) blockingReasons.push('ربط الفاتورة غير مؤكد');
  if (qualityGate.humanReviewRequired) blockingReasons.push(...qualityGate.reasons);

  const review: SmartConversationReviewResult = {
    sessionId: scope.scoredSession.id,
    staffSummaries: [summary],
    unassignedMessageIds: [],
    handoffs: [],
    safeForOfficialScoring: blockingReasons.length === 0 && !summary.requiresHumanReview,
    blockingReasons: unique(blockingReasons),
  };

  return {
    scope,
    review,
    decision: buildSmartQuickDecision(review, input.staffName, input.role),
    conversationIntelligence,
    intelligence,
    qualityGate,
    journeyCrossCheck,
  };
}
