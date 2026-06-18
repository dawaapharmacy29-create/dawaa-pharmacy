/**
 * approverRoles.ts — Approver role definitions
 * Uses the central permission system for role normalization.
 */
import {
  normalizeRole,
  isPrivilegedRole,
  getRoleLabel,
  type RoleKey,
} from '@/lib/core/permissionSystem';

export type ApproverRoleKey = RoleKey;

export const APPROVER_ROLES: RoleKey[] = [
  'general_manager',
  'executive_manager',
  'branches_manager',
  'branch_manager',
  'customer_service_manager',
];

export function isApproverRole(role?: string | null): boolean {
  const key = normalizeRole(role);
  return APPROVER_ROLES.includes(key) || isPrivilegedRole(key);
}

export function canApproveFor(approverRole?: string | null, targetRole?: string | null): boolean {
  if (!isApproverRole(approverRole)) return false;
  if (normalizeRole(approverRole) === 'general_manager') return true;
  return true;
}

export function userCanApprove(
  allowedRoles?: Array<string | null> | string | null,
  userRole?: string | null
): boolean {
  if (!isApproverRole(userRole)) return false;
  const normalizedUserRole = normalizeRole(userRole);
  if (normalizedUserRole === 'general_manager' || isPrivilegedRole(normalizedUserRole)) return true;

  if (!allowedRoles || (Array.isArray(allowedRoles) && allowedRoles.length === 0)) {
    return isApproverRole(normalizedUserRole);
  }

  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
  return roles.map((role) => normalizeRole(role)).includes(normalizedUserRole);
}

export function formatApproverList(roles?: Array<string | null> | string | null): string {
  if (!roles || (Array.isArray(roles) && roles.length === 0)) return 'أي مدير معتمد';
  const list = Array.isArray(roles) ? roles : [roles];
  const labels = list
    .filter(Boolean)
    .map((role) => getRoleLabel(normalizeRole(role)))
    .filter(Boolean);
  return labels.length ? labels.join('، ') : 'أي مدير معتمد';
}
