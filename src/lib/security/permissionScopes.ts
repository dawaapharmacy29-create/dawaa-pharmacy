/**
 * permissionScopes.ts — redirect to central system
 */
import type { User } from '@/types';
export type { DataScope } from '@/lib/core/permissionSystem';
export { getUserDataScope, canSeeAllBranches } from '@/lib/core/permissionSystem';
import { canSeeAllBranches, getUserDataScope } from '@/lib/core/permissionSystem';
import { applyBranchFilter, getBranchScope, normalizeBranchScope, ALL_BRANCHES } from '@/lib/core/branchScope';

export function effectiveBranchFilter(
  user: Pick<User, 'role' | 'branch'> | null | undefined,
  requestedBranch?: string | null,
  allValue = ALL_BRANCHES
): string {
  return getBranchScope(user, requestedBranch, allValue);
}

export function rowMatchesUserBranch(
  user: Pick<User, 'role' | 'branch'> | null | undefined,
  rowBranch?: string | null
): boolean {
  return applyBranchFilter(user, rowBranch);
}

export function rowMatchesAssignedUser(
  user: Pick<User, 'name' | 'username' | 'role' | 'branch'> | null | undefined,
  row: Record<string, unknown>
): boolean {
  if (!user) return false;
  if (canSeeAllBranches(user.role) || getUserDataScope(user.role) === 'branch_only') return true;
  const names = [user.name, user.username]
    .filter(Boolean)
    .map((n) => String(n).trim().toLowerCase());
  const rowAssignee = String(row['assigned_to'] || row['staff_name'] || '').toLowerCase();
  return names.some((n) => n && rowAssignee.includes(n));
}

export function scopeDescription(scopeOrRole?: string | null): string {
  const value = String(scopeOrRole || '').trim();
  const scope = ['all_branches', 'branch_only', 'assigned_only', 'own_only'].includes(value)
    ? value
    : getUserDataScope(value);
  if (scope === 'all_branches') return 'كل الفروع وكل البيانات';
  if (scope === 'branch_only') return 'بيانات الفرع الخاص فقط';
  if (scope === 'assigned_only') return 'العملاء أو المهام المسندة للمستخدم';
  if (scope === 'own_only') return 'بيانات المستخدم الشخصية فقط';
  return 'نطاق محدود';
}

export { getBranchScope, applyBranchFilter, normalizeBranchScope, ALL_BRANCHES };
