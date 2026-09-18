import type { SmartConversationReviewResult, SmartOwnedReviewSummary } from './whatsappSmartReviewResult';
import type { SmartStaffRole } from './whatsappSmartReviewOwnership';

export type SmartQuickDecision = 'clear' | 'issue' | 'detailed_review';

export interface SmartQuickDecisionResult {
  decision: SmartQuickDecision;
  reasons: string[];
  affectedCriteria: string[];
  evidenceMessageIds: string[];
  safeToQuickApprove: boolean;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function decideStaff(summary: SmartOwnedReviewSummary): SmartQuickDecisionResult {
  const criteria = unique(summary.suggestedReviewCriteria);
  const reasons = unique(summary.reviewReasons);
  const evidence = unique(summary.evidenceMessageIds);

  if (summary.unansweredTurns > 0) reasons.push('يوجد عميل بدون رد داخل فترة المسؤولية المؤكدة');
  if (summary.slowResponseTurns > 0) reasons.push('يوجد رد متأخر داخل فترة المسؤولية المؤكدة');

  if (summary.requiresHumanReview || summary.unansweredTurns > 0) {
    return {
      decision: 'detailed_review',
      reasons: unique(reasons),
      affectedCriteria: criteria,
      evidenceMessageIds: evidence,
      safeToQuickApprove: false,
    };
  }

  if (reasons.length > 0 || summary.slowResponseTurns > 0) {
    return {
      decision: 'issue',
      reasons: unique(reasons),
      affectedCriteria: criteria,
      evidenceMessageIds: evidence,
      safeToQuickApprove: false,
    };
  }

  return {
    decision: 'clear',
    reasons: [],
    affectedCriteria: criteria,
    evidenceMessageIds: evidence,
    safeToQuickApprove: true,
  };
}

export function buildSmartQuickDecision(
  review: SmartConversationReviewResult,
  staffName?: string | null,
  role?: SmartStaffRole | null,
): SmartQuickDecisionResult {
  const selected = staffName
    ? review.staffSummaries.filter((item) => item.staffName === staffName && (!role || item.role === role))
    : role
      ? review.staffSummaries.filter((item) => item.role === role)
      : review.staffSummaries;

  const blockers = [...review.blockingReasons];
  if (!selected.length) blockers.push('لا يوجد مسؤول مؤكد يمكن اتخاذ قرار مراجعة عليه');

  if (blockers.length) {
    return {
      decision: 'detailed_review',
      reasons: unique(blockers),
      affectedCriteria: unique(selected.flatMap((item) => item.suggestedReviewCriteria)),
      evidenceMessageIds: unique(selected.flatMap((item) => item.evidenceMessageIds)),
      safeToQuickApprove: false,
    };
  }

  const staffDecisions = selected.map(decideStaff);
  if (staffDecisions.some((item) => item.decision === 'detailed_review')) {
    return {
      decision: 'detailed_review',
      reasons: unique(staffDecisions.flatMap((item) => item.reasons)),
      affectedCriteria: unique(staffDecisions.flatMap((item) => item.affectedCriteria)),
      evidenceMessageIds: unique(staffDecisions.flatMap((item) => item.evidenceMessageIds)),
      safeToQuickApprove: false,
    };
  }
  if (staffDecisions.some((item) => item.decision === 'issue')) {
    return {
      decision: 'issue',
      reasons: unique(staffDecisions.flatMap((item) => item.reasons)),
      affectedCriteria: unique(staffDecisions.flatMap((item) => item.affectedCriteria)),
      evidenceMessageIds: unique(staffDecisions.flatMap((item) => item.evidenceMessageIds)),
      safeToQuickApprove: false,
    };
  }

  return {
    decision: 'clear',
    reasons: [],
    affectedCriteria: unique(staffDecisions.flatMap((item) => item.affectedCriteria)),
    evidenceMessageIds: unique(staffDecisions.flatMap((item) => item.evidenceMessageIds)),
    safeToQuickApprove: review.safeForOfficialScoring,
  };
}
