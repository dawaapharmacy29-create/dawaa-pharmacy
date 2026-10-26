// Why a customer-request proposal cannot be approved, from facts the page already has. This is a
// display aid only: dawaa_approve_whatsapp_customer_request_action_v2 re-checks every rule (plus
// the current analysis, conversation staff evidence, cross-branch cover and catalog code) and
// remains the enforcing boundary. An empty list never means "approved", only "may be submitted".
import { isOperatingBranch, normalizeBranchName } from '@/lib/branch';

export const APPROVAL_MIN_CONFIDENCE = 80;

export interface ApprovalReadinessAction {
  customerId: string | null;
  productId: string | null;
  productCode: string | null;
  staffId: string | null;
  branch: string | null;
  confidence: number | null;
}

export interface ApprovalReadinessSource {
  customerId: string | null;
  staffId: string | null;
  branch: string | null;
}

export function customerRequestApprovalBlockers(
  action: ApprovalReadinessAction,
  source: ApprovalReadinessSource | null
): string[] {
  const blockers: string[] = [];
  if (!action.customerId) blockers.push('العميل غير محدد');
  if (!action.productId) blockers.push('الصنف غير مربوط بالكتالوج');
  else if (!action.productCode?.trim()) blockers.push('كود الصنف غير موجود');
  if (!action.staffId) blockers.push('الدكتور المسؤول غير محسوم');
  if ((action.confidence ?? 0) < APPROVAL_MIN_CONFIDENCE) blockers.push(`ثقة الاقتراح أقل من ${APPROVAL_MIN_CONFIDENCE}%`);
  if (!isOperatingBranch(action.branch)) blockers.push('فرع العملية ليس فرع تشغيل معتمد');
  if (!source) {
    blockers.push('بيانات المصدر غير متاحة للمراجعة');
    return blockers;
  }
  if (action.customerId && action.customerId !== source.customerId) blockers.push('العميل على الاقتراح يختلف عن عميل المصدر');
  if (action.staffId && action.staffId !== source.staffId) blockers.push('الدكتور على الاقتراح يختلف عن دكتور المصدر');
  if (normalizeBranchName(action.branch) !== normalizeBranchName(source.branch)) blockers.push('فرع الاقتراح يختلف عن فرع المصدر');
  return blockers;
}

// A complaint follow-up written by an earlier engine is not current evidence: the canonical
// complaint projector withdraws it only when it replaces it, so one the current analysis did not
// confirm (e.g. "العميل لم يعد للرد" after the customer did reply) stays a human decision.
export const CANONICAL_COMPLAINT_CREATOR = 'si-canonical-complaint-projection-v1';

export function legacyComplaintReviewReason(action: { actionType: string; status: string; createdBy: string | null }): string | null {
  if (action.actionType !== 'complaint_followup' || action.status === 'dismissed') return null;
  if (action.createdBy === CANONICAL_COMPLAINT_CREATOR) return null;
  return 'متابعة شكوى من محرك سابق لم يؤكدها التحليل الحالي؛ راجع الرسائل وقرر يدويًا قبل أي تنفيذ.';
}

/**
 * `ready` is a proposal; only `created` WITH a linked operational record is executed work. A
 * `created` row without lineage is an inconsistency to review, never shown as done.
 */
export type OperationalActionLifecycle = 'proposal' | 'materialized' | 'materialized_without_target' | 'withdrawn' | 'error' | 'unknown';

export function operationalActionLifecycle(action: { status: string; targetTable: string | null; targetId: string | null }): OperationalActionLifecycle {
  if (action.status === 'proposed' || action.status === 'ready') return 'proposal';
  if (action.status === 'created') return action.targetTable && action.targetId ? 'materialized' : 'materialized_without_target';
  if (action.status === 'dismissed') return 'withdrawn';
  if (action.status === 'error') return 'error';
  return 'unknown';
}
