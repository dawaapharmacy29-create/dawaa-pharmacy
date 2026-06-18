import { getCurrentCycle, getPointsCycle, type PharmacyCycle } from '@/lib/pharmacy-cycle';
import type { EvaluationRuleDef } from '@/lib/evaluationRulesCatalog';
import { userCanApprove } from '@/lib/approverRoles';

export type PointsTxnStatus = 'pending' | 'approved' | 'rejected';
export type OperationKind = 'bonus' | 'deduction' | 'admin_adjustment';

export const RULE_NOTE_PREFIX = '__RULE__:';
export const MAX_DEDUCTION_PER_EVENT = 1000;

export function embedRuleCodeInNote(code: string, note: string): string {
  const clean = note?.trim() || '';
  return `${RULE_NOTE_PREFIX}${code}${clean ? `\n${clean}` : ''}`;
}

export function extractRuleCodeFromNote(note: string | null | undefined): string | null {
  if (!note?.includes(RULE_NOTE_PREFIX)) return null;
  const rest = note.split(RULE_NOTE_PREFIX)[1];
  return (rest?.split('\n')[0] || '').trim() || null;
}

export interface PointRecordLike {
  employee_id: string;
  type: string;
  points: number;
  created_at: string;
  manager_note?: string | null;
  cycle_start?: string | null;
  cycle_end?: string | null;
  status?: string | null;
}

export function filterRecordsInCycle(
  records: PointRecordLike[],
  cycle: PharmacyCycle
): PointRecordLike[] {
  const start = cycle.start.getTime();
  const end = cycle.end.getTime();
  const { cycle_start, cycle_end } = cycleDatesISO(cycle);
  return records.filter((r) => {
    if (r.cycle_start && r.cycle_end)
      return r.cycle_start === cycle_start && r.cycle_end === cycle_end;
    const t = new Date(r.created_at).getTime();
    return t >= start && t <= end;
  });
}

/** عدد مرات تطبيق نفس القاعدة (خصم) على الموظف في الدورة قبل المعاملة الحالية */
export function countPreviousRuleApplicationsInCycle(
  records: PointRecordLike[],
  employeeId: string,
  ruleCode: string,
  cycle: PharmacyCycle
): number {
  const inCycle = filterRecordsInCycle(records, cycle);
  return inCycle.filter((r) => {
    if (r.employee_id !== employeeId) return false;
    if (r.type !== 'خصم' && r.type !== 'deduction') return false;
    return extractRuleCodeFromNote(r.manager_note || '') === ruleCode;
  }).length;
}

export function repeatMultiplier(previousCount: number): number {
  // التصعيد المطلوب للصيدلية: نفس الخطأ داخل دورة 26→25 يزيد خطيًا
  // مثال بند 20 نقطة: أول مرة 20، ثاني مرة 40، ثالث مرة 60.
  return Math.max(1, previousCount + 1);
}

export function computeDeductionWithRepeat(
  basePoints: number,
  previousCount: number,
  maxCap: number | undefined
): { base_points: number; repeat_count: number; multiplier: number; final_points: number } {
  const mult = repeatMultiplier(previousCount);
  let final = Math.round(basePoints * mult);
  const cap = maxCap ?? MAX_DEDUCTION_PER_EVENT;
  final = Math.min(final, cap);
  return {
    base_points: basePoints,
    repeat_count: previousCount,
    multiplier: mult,
    final_points: final,
  };
}

export function defaultStatusForRule(
  rule: EvaluationRuleDef | null,
  operation: OperationKind,
  actorCanApprove: boolean
): PointsTxnStatus {
  if (operation === 'admin_adjustment') return actorCanApprove ? 'approved' : 'pending';
  if (!rule) return actorCanApprove ? 'approved' : 'pending';
  if (operation === 'bonus') {
    if (rule.requires_approval && !actorCanApprove) return 'pending';
    if (rule.severity === 'critical' || rule.severity === 'high') return 'pending';
    return 'approved';
  }
  /** خصم */
  if (rule.requires_approval || rule.severity === 'critical' || rule.severity === 'high')
    return 'pending';
  if (rule.severity === 'medium' && !actorCanApprove) return 'pending';
  return actorCanApprove ? 'approved' : 'pending';
}

export function evidenceRequiredForSubmission(
  rule: EvaluationRuleDef,
  operation: OperationKind,
  note: string
): boolean {
  if (operation !== 'deduction') return false;
  if (!rule.evidence_required) return false;
  return note.trim().length < 5;
}

export function actorCanApproveRule(
  rule: EvaluationRuleDef,
  userRole: string | undefined
): boolean {
  return userCanApprove(rule.allowed_approver_roles, userRole);
}

export function cycleDatesISO(cycle: PharmacyCycle): { cycle_start: string; cycle_end: string } {
  return getPointsCycle(cycle.start);
}

export function getCycleOrCurrent(c?: PharmacyCycle): PharmacyCycle {
  return c ?? getCurrentCycle();
}
