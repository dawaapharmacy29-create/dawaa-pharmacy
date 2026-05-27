import { normalizeBranchName as normalizeBranchNameShared } from "@/lib/branch";
import type { EvaluationRuleDef } from "@/lib/evaluationRulesCatalog";

export type ShiftType = "morning" | "evening" | "night";
export type WorkloadPressure = "normal" | "medium" | "high" | "very_high";
export type NegligenceStatus = "yes" | "no" | "needs_review";
export type ShiftActionMode = "training_only" | "leader_only" | "leader_and_team" | "custom";
export type ShiftReviewStatus = "pending" | "approved" | "rejected";

export interface ShiftConfig {
  type: ShiftType;
  label: string;
  start: string;
  end: string;
}

export interface ShiftMemberDraft {
  staff_id: string;
  staff_name: string;
  staff_role: string;
  branch: string;
  shift_start?: string | null;
  shift_end?: string | null;
  was_present: boolean;
  has_permission: boolean;
  is_shift_leader: boolean;
  base_points: number;
  repeat_count: number;
  multiplier: number;
  assigned_points: number;
  notes?: string | null;
}

export const SHIFT_CONFIGS: Record<ShiftType, ShiftConfig> = {
  morning: { type: "morning", label: "الصباحي", start: "09:00", end: "18:00" },
  evening: { type: "evening", label: "المسائي", start: "18:00", end: "02:00" },
  night: { type: "night", label: "الليلي", start: "02:00", end: "09:00" },
};

export const SHIFT_ISSUES = [
  { value: "warehouse_invoices", label: "فواتير مخزن لم يتم إدخالها" },
  { value: "invoice_shelving", label: "فواتير لم يتم رصها" },
  { value: "stock_arrangement", label: "أصناف لم يتم ترتيبها" },
  { value: "handover", label: "تسليم الشيفت التالي غير واضح" },
  { value: "order_backlog", label: "تراكم طلبات بدون سبب واضح" },
  { value: "task_delay", label: "تأخير في تنفيذ مهام الشيفت" },
  { value: "task_distribution", label: "عدم توزيع المهام بين الفريق" },
  { value: "shortages", label: "إهمال النواقص أو فواتير المخزن" },
  { value: "repeat_issue", label: "مشكلة متكررة في نفس الشيفت" },
];

export function shiftLabel(type: ShiftType | string): string {
  return SHIFT_CONFIGS[type as ShiftType]?.label || type;
}
export function normalizeBranchName(branch?: string | null): string {
  const normalized = normalizeBranchNameShared(branch);
  return normalized === "غير محدد" ? "" : normalized;
}


function minutesOf(time?: string | null): number | null {
  if (!time) return null;
  const match = String(time).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function timeRangesOverlap(startA?: string | null, endA?: string | null, startB?: string | null, endB?: string | null): boolean {
  const aStart = minutesOf(startA);
  const aEnd = minutesOf(endA);
  const bStart = minutesOf(startB);
  const bEnd = minutesOf(endB);
  if (aStart == null || aEnd == null || bStart == null || bEnd == null) return true;

  const expand = (start: number, end: number) => {
    if (end <= start) return [[start, 1440], [0, end]];
    return [[start, end]];
  };

  const a = expand(aStart, aEnd);
  const b = expand(bStart, bEnd);
  return a.some(([as, ae]) => b.some(([bs, be]) => as < be && bs < ae));
}

export function shouldProtectFromAutoDeduction(pressure: WorkloadPressure): boolean {
  return pressure === "high" || pressure === "very_high";
}

export function recommendedActionMode(pressure: WorkloadPressure, negligence: NegligenceStatus): ShiftActionMode {
  if (shouldProtectFromAutoDeduction(pressure)) return "training_only";
  if (negligence !== "yes") return "training_only";
  return "leader_and_team";
}

export function buildShiftMembersWithPoints(
  members: ShiftMemberDraft[],
  leaderId: string,
  actionMode: ShiftActionMode,
  pressure: WorkloadPressure,
  negligence: NegligenceStatus,
): ShiftMemberDraft[] {
  const protectedByPressure = shouldProtectFromAutoDeduction(pressure) || negligence !== "yes";

  return members.map((member) => {
    const isLeader = member.staff_id === leaderId;
    let base = member.base_points || 0;

    if (actionMode === "training_only" || protectedByPressure) base = 0;
    else if (actionMode === "leader_only") base = isLeader ? 20 : 0;
    else if (actionMode === "leader_and_team") base = isLeader ? 20 : 5;

    const multiplier = isLeader && base > 0 ? member.multiplier || 1 : 1;
    const assigned = actionMode === "custom" ? member.assigned_points : Math.round(base * multiplier);

    return {
      ...member,
      is_shift_leader: isLeader,
      base_points: base,
      multiplier,
      assigned_points: assigned,
    };
  });
}

export function shiftDeductionRule(issueCategory: string, severity: string): EvaluationRuleDef {
  const title = SHIFT_ISSUES.find((item) => item.value === issueCategory)?.label || "تقييم أداء الشيفت";
  return {
    code: `SHIFT_${issueCategory.toUpperCase()}`,
    category: "تقييم أداء الشيفتات",
    title,
    description: "خصم مرتبط بتقييم أداء الشيفت بعد مراجعة ضغط العمل الحقيقي.",
    default_points: 20,
    type: "deduction",
    severity: severity === "critical" ? "critical" : severity === "high" ? "high" : severity === "medium" ? "medium" : "low",
    role_scope: "all",
    requires_approval: true,
    evidence_required: false,
    allowed_approver_roles: ["branch_manager", "general_manager"],
    repeat_policy: "double_per_cycle",
    active: true,
    max_points_cap: 160,
  };
}

