/**
 * permissionMatrix.ts
 * Re-exports from the central permission system for backward compatibility.
 * ⚠️ لا تُضف صلاحيات هنا — اذهب إلى src/lib/core/permissionSystem.ts
 */
import type { User } from '@/types';
import { normalizeBranchName } from '@/lib/branch';
import {
  canSeeAllBranches,
  getUserDataScope,
  PERMISSION_CATEGORIES as PC,
} from '@/lib/core/permissionSystem';

export type {
  RoleKey,
  DataScope,
  RoleDefinition,
  PermissionCategory,
  PermissionDef,
} from '@/lib/core/permissionSystem';

export {
  ROLES,
  ROLE_MAP,
  ROLE_PERMISSIONS,
  PERMISSION_CATEGORIES,
  ALL_PERMISSION_KEYS,
  PERMISSION_MAP,
  normalizeRole,
  getRoleDefinition,
  getRoleLabel,
  getRoleLevel,
  isAdminRole,
  isPrivilegedRole,
  isBranchManagerRole,
  getUserDataScope,
  canSeeAllBranches,
  getDefaultPermissionsForRole,
  hasPermission as userHasPermission,
  hasPermission,
  hasAnyPermission,
  hasAllPermissions,
  mergePermissions as mergePermissionMaps,
} from '@/lib/core/permissionSystem';

// ─── Data Scope Helpers ───────────────────────────────────────
export function effectiveBranchFilter(
  user: Pick<User, 'role' | 'branch'> | null | undefined,
  requestedBranch?: string | null,
  allValue = 'كل الفروع'
): string {
  if (canSeeAllBranches(user?.role)) return requestedBranch || allValue;
  return normalizeBranchName(user?.branch || requestedBranch || '');
}

export function rowMatchesUserBranch(
  user: Pick<User, 'role' | 'branch'> | null | undefined,
  rowBranch?: string | null
): boolean {
  if (canSeeAllBranches(user?.role)) return true;
  const userBranch = normalizeBranchName(user?.branch || '');
  if (!userBranch) return false;
  return normalizeBranchName(rowBranch || '') === userBranch;
}

// ─── Page Sections (kept for PermissionGate backward compat) ──
export interface PermissionSection {
  key: string;
  label: string;
  permission: string;
}

export interface PagePermissionDefinition {
  path: string;
  pageKey: string;
  label: string;
  viewPermission: string;
  sections: PermissionSection[];
}

export interface RoleScopeDefinition {
  scope: string;
  description: string;
}

function categorySections(key: string): PermissionSection[] {
  return (
    PC.find((category) => category.key === key)?.permissions.map((permission) => ({
      key: permission.key,
      label: permission.label,
      permission: permission.key,
    })) || []
  );
}

export const PAGE_PERMISSION_DEFINITIONS: PagePermissionDefinition[] = [
  {
    path: '/customers',
    pageKey: 'customers',
    label: 'العملاء',
    viewPermission: 'view_customers',
    sections: categorySections('customers'),
  },
  {
    path: '/customer-service',
    pageKey: 'customer_service',
    label: 'خدمة العملاء',
    viewPermission: 'view_customer_service',
    sections: categorySections('customer_service'),
  },
  {
    path: '/team',
    pageKey: 'team',
    label: 'الفريق',
    viewPermission: 'view_team',
    sections: categorySections('team'),
  },
  {
    path: '/points',
    pageKey: 'points',
    label: 'النقاط',
    viewPermission: 'view_points',
    sections: categorySections('points'),
  },
  {
    path: '/analytics',
    pageKey: 'analytics',
    label: 'التحليلات',
    viewPermission: 'view_analytics',
    sections: categorySections('analytics'),
  },
  {
    path: '/staff-accounts',
    pageKey: 'staff_accounts',
    label: 'الحسابات',
    viewPermission: 'view_staff_accounts',
    sections: categorySections('accounts'),
  },
  {
    path: '/schedule',
    pageKey: 'schedule',
    label: 'الجدول',
    viewPermission: 'view_schedule',
    sections: categorySections('schedule'),
  },
  {
    path: '/reviews',
    pageKey: 'reviews',
    label: 'التقييمات',
    viewPermission: 'view_reviews',
    sections: categorySections('reviews'),
  },
];

export function getVisibleSectionsForPath(
  path: string,
  checker: (permission?: string) => boolean
): PermissionSection[] {
  const page = PAGE_PERMISSION_DEFINITIONS.find((definition) => definition.path === path);
  if (!page) return [];
  return page.sections.filter((section) => checker(section.permission));
}

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  all_branches: 'كل الفروع',
  branch_only: 'الفرع الخاص',
  assigned_only: 'المُسند إليه',
  own_only: 'بياناته الشخصية',
};

export function getPermissionScopeForRole(role?: string | null): RoleScopeDefinition {
  const scope = getUserDataScope(role);
  return { scope, description: SCOPE_DESCRIPTIONS[scope] || 'محدود' };
}
