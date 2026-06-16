/**
 * permissions.ts — Centralized permission checking utilities
 * Single source of truth for role and permission logic used in UI.
 */

export type UserRole =
  | "أدمن"
  | "مدير فرع"
  | "مدير الفروع"
  | "مدير خدمة العملاء"
  | "صيدلاني"
  | "مساعد"
  | "توصيل"
  | "خدمة عملاء";

export const ADMIN_ROLES: readonly UserRole[] = [
  "أدمن",
  "مدير الفروع",
];

export const BRANCH_MANAGER_ROLES: readonly UserRole[] = [
  "مدير فرع",
  "مدير الفروع",
  "مدير خدمة العملاء",
];

/**
 * Returns true if a role is an admin role.
 */
export function isAdminRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return ADMIN_ROLES.includes(role.trim() as UserRole);
}

/**
 * Returns true if a role is a branch manager or higher.
 */
export function isBranchManagerRole(role: string | null | undefined): boolean {
  if (!role) return false;
  return (
    BRANCH_MANAGER_ROLES.includes(role.trim() as UserRole) ||
    isAdminRole(role)
  );
}

/**
 * Checks whether a user's permissions object includes a specific permission key.
 * Supports dot-notation keys like "page.customers.view".
 */
export function hasPermission(
  permissions: Record<string, boolean> | null | undefined,
  key: string
): boolean {
  if (!permissions) return false;
  if (permissions[key] === true) return true;
  // Check legacy flat keys
  const flatKey = key.replace(/\./g, "_");
  return permissions[flatKey] === true;
}

/**
 * Returns true if the user is allowed to access a route, given their role and permissions.
 */
export function canAccessRoute(
  role: string | null | undefined,
  permissions: Record<string, boolean> | null | undefined,
  requiredPermission: string | null | undefined
): boolean {
  if (!requiredPermission) return true;
  if (isAdminRole(role)) return true;
  return hasPermission(permissions, requiredPermission);
}

/**
 * Returns all permission keys that are enabled for a user.
 */
export function getEnabledPermissions(
  permissions: Record<string, boolean> | null | undefined
): string[] {
  if (!permissions) return [];
  return Object.entries(permissions)
    .filter(([, v]) => v === true)
    .map(([k]) => k);
}
