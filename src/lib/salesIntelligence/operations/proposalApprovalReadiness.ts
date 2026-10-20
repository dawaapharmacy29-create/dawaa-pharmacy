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
