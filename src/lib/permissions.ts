/**
 * permissions.ts — DEPRECATED
 * هذا الملف يُوجِّه إلى النظام المركزي للصلاحيات.
 * استخدم: import { ... } from "@/lib/core/permissionSystem"
 */
export type { RoleKey as UserRole } from '@/lib/core/permissionSystem';
export {
  isAdminRole,
  isBranchManagerRole,
  hasPermission,
  getDefaultPermissionsForRole,
  mergePermissions,
  normalizeRole,
  ROLES,
  PERMISSION_CATEGORIES,
} from '@/lib/core/permissionSystem';

// Legacy type compat
export interface Permission {
  resource: string;
  action: string;
  condition?: (data?: unknown) => boolean;
}
export interface RolePermissions {
  role: string;
  permissions: Permission[];
  description: string;
}

// Legacy helper — kept for backward compat only
function getCurrentUserId(): string | null {
  return null;
}
export const rolePermissions: RolePermissions[] = [
  {
    role: 'admin',
    permissions: [{ resource: '*', action: '*' }],
    description: 'مدير النظام - صلاحيات كاملة',
  },
  {
    role: 'manager',
    permissions: [{ resource: 'customers', action: 'read' }],
    description: 'مدير - صلاحيات إدارية',
  },
  {
    role: 'staff',
    permissions: [{ resource: 'customers', action: 'read' }],
    description: 'موظف - صلاحيات محدودة',
  },
  {
    role: 'viewer',
    permissions: [{ resource: 'customers', action: 'read' }],
    description: 'مشاهد - للقراءة فقط',
  },
];
