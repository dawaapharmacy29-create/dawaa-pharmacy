import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches as coreCanSeeAllBranches, getUserDataScope } from '@/lib/core/permissionSystem';
import { getDashboardBranchOverride } from '@/lib/security/userDataScope';
import type { User } from '@/types';

export const ALL_BRANCHES = 'كل الفروع';
export const UNKNOWN_BRANCH = 'غير محدد';

export function normalizeBranchScope(value?: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return normalizeBranchName(raw);
}

export function getUserBranch(user?: Pick<User, 'branch'> | null | undefined): string {
  return normalizeBranchScope(user?.branch);
}

export function canSeeAllBranches(userRole?: string | null | undefined): boolean {
  return coreCanSeeAllBranches(userRole);
}

export function getBranchScope(
  user?: Pick<User, 'role' | 'branch'> | null | undefined,
  requestedBranch?: string | null,
  allValue = ALL_BRANCHES
): string {
  if (canSeeAllBranches(user?.role)) return requestedBranch || allValue;
  const overrideBranch = getDashboardBranchOverride(user as any);
  const branch = normalizeBranchScope(overrideBranch) || normalizeBranchScope(user?.branch) || normalizeBranchScope(requestedBranch);
  return branch || allValue;
}

export function applyBranchFilter(
  user?: Pick<User, 'role' | 'branch'> | null | undefined,
  rowBranch?: unknown,
  requestedBranch?: string | null
): boolean {
  if (canSeeAllBranches(user?.role)) return true;
  const targetBranch = normalizeBranchScope(requestedBranch) || getUserBranch(user);
  if (!targetBranch || targetBranch === UNKNOWN_BRANCH) return false;
  const row = normalizeBranchScope(rowBranch);
  return row === targetBranch;
}

export function isAllBranches(branch?: string | null): boolean {
  const normalized = normalizeBranchScope(branch);
  if (!normalized) return true;
  return normalized === ALL_BRANCHES || normalized === 'all' || normalized === 'الكل';
}
