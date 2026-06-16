import type { User } from "@/types";
import { normalizeBranchName } from "@/lib/branch";
import { normalizeRole } from "@/lib/permissionMatrix";

export type DataScope = "all_branches" | "branch_only" | "assigned_only" | "own_only";

const ALL_BRANCH_ROLES = new Set(["general_manager", "executive_manager", "branches_manager", "procurement_manager"]);
const BRANCH_ROLES = new Set(["branch_manager", "customer_service_manager", "customer_service", "shift_supervisor_morning", "shift_supervisor_evening", "pharmacist", "inventory_assistant", "assistant", "cleaning_supervisor"]);
const OWN_ROLES = new Set(["delivery"]);

export function getUserDataScope(user?: Pick<User, "role" | "branch"> | null): DataScope {
  const role = normalizeRole(user?.role);
  if (ALL_BRANCH_ROLES.has(role)) return "all_branches";
  if (BRANCH_ROLES.has(role)) return "branch_only";
  if (OWN_ROLES.has(role)) return "assigned_only";
  return "own_only";
}

export function canSeeAllBranches(user?: Pick<User, "role" | "branch"> | null) {
  return getUserDataScope(user) === "all_branches";
}

export function effectiveBranchFilter(user: Pick<User, "role" | "branch"> | null | undefined, requestedBranch?: string | null, allValue = "كل الفروع") {
  if (canSeeAllBranches(user)) return requestedBranch || allValue;
  return normalizeBranchName(user?.branch || requestedBranch || "");
}

export function rowMatchesUserBranch(user: Pick<User, "role" | "branch"> | null | undefined, rowBranch?: string | null) {
  if (canSeeAllBranches(user)) return true;
  const userBranch = normalizeBranchName(user?.branch || "");
  if (!userBranch) return false;
  const branch = normalizeBranchName(rowBranch || "");
  return branch === userBranch;
}

export function rowMatchesAssignedUser(user: Pick<User, "name" | "username" | "role" | "branch"> | null | undefined, row: Record<string, unknown>) {
  if (!user) return false;
  if (canSeeAllBranches(user) || getUserDataScope(user) === "branch_only") return true;
  const names = [user.name, user.username].filter(Boolean).map(String);
  const assigned = [row.assigned_to, row.responsible_name, row.assigned_doctor, row.created_by_name, row.closed_by, row.updated_by]
    .filter(Boolean)
    .map(String);
  return assigned.some((value) => names.includes(value));
}

export function scopeDescription(user?: Pick<User, "role" | "branch"> | null) {
  const scope = getUserDataScope(user);
  if (scope === "all_branches") return "كل الفروع";
  if (scope === "branch_only") return `فرعك فقط: ${normalizeBranchName(user?.branch || "") || "غير محدد"}`;
  if (scope === "assigned_only") return "المهام المسندة لك فقط";
  return "بياناتك الشخصية فقط";
}
