export * from '@/lib/core/permissionSystem';
export {
  hasPermission as userHasPermission,
  mergePermissions as mergePermissionMaps,
  ROLE_PERMISSION_PRESETS as ROLE_PERMISSIONS,
} from '@/lib/core/permissionSystem';

import type { User } from '@/types';
import { normalizeBranchName } from '@/lib/branch';
import { canSeeAllBranches, PERMISSION_CATEGORIES } from '@/lib/core/permissionSystem';

export function effectiveBranchFilter(
  user: Pick<User, 'role' | 'branch'> | null | undefined,
  requestedBranch?: string | null,
  allValue = 'all'
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
    PERMISSION_CATEGORIES.find((category) => category.key === key)?.permissions.map((permission) => ({
      key: permission.key,
      label: permission.label,
      permission: permission.key,
    })) || []
  );
}

export const PAGE_PERMISSION_DEFINITIONS: PagePermissionDefinition[] = [
  { path: '/customers', pageKey: 'customers', label: 'Customers', viewPermission: 'view_customers', sections: categorySections('customers') },
  { path: '/customer-service', pageKey: 'customer_service', label: 'Customer Service', viewPermission: 'view_customer_service', sections: categorySections('customer_service') },
  { path: '/welcome-messages', pageKey: 'welcome_messages', label: 'Welcome Messages', viewPermission: 'customer_welcome_messages.view', sections: categorySections('customer_service') },
  { path: '/team', pageKey: 'team', label: 'Team', viewPermission: 'view_team', sections: categorySections('team') },
  { path: '/points', pageKey: 'points', label: 'Points', viewPermission: 'view_points', sections: categorySections('points') },
  { path: '/analytics', pageKey: 'analytics', label: 'Analytics', viewPermission: 'view_analytics', sections: categorySections('analytics') },
  { path: '/staff-accounts', pageKey: 'staff_accounts', label: 'Accounts', viewPermission: 'view_staff_accounts', sections: categorySections('accounts') },
  { path: '/schedule', pageKey: 'schedule', label: 'Schedule', viewPermission: 'view_schedule', sections: categorySections('schedule') },
  { path: '/reviews', pageKey: 'reviews', label: 'Reviews', viewPermission: 'view_reviews', sections: categorySections('reviews') },
];

export function getVisibleSectionsForPath(path: string, checker: (permission?: string) => boolean): PermissionSection[] {
  const page = PAGE_PERMISSION_DEFINITIONS.find((definition) => definition.path === path);
  if (!page) return [];
  return page.sections.filter((section) => checker(section.permission));
}
