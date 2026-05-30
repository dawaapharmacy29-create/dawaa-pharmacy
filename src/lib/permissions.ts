export type UserRole = "admin" | "manager" | "staff" | "viewer";

export interface Permission {
  resource: string;
  action: string;
  condition?: (data?: any) => boolean;
}

export interface RolePermissions {
  role: UserRole;
  permissions: Permission[];
  description: string;
}

/**
 * Role-based permissions configuration
 */
export const rolePermissions: RolePermissions[] = [
  {
    role: "admin",
    permissions: [
      { resource: "*", action: "*" }, // Full access
    ],
    description: "مدير النظام - صلاحيات كاملة"
  },
  {
    role: "manager",
    permissions: [
      { resource: "followups", action: "create" },
      { resource: "followups", action: "read" },
      { resource: "followups", action: "update" },
      { resource: "followups", action: "delete" },
      { resource: "customers", action: "create" },
      { resource: "customers", action: "read" },
      { resource: "customers", action: "update" },
      { resource: "analytics", action: "read" },
      { resource: "staff", action: "read" },
      { resource: "reports", action: "read" },
      { resource: "reports", action: "create" },
    ],
    description: "مدير - صلاحيات إدارية واسعة"
  },
  {
    role: "staff",
    permissions: [
      { resource: "followups", action: "create" },
      { resource: "followups", action: "read", condition: (data) => data?.assigned_to === getCurrentUserId() },
      { resource: "followups", action: "update", condition: (data) => data?.assigned_to === getCurrentUserId() },
      { resource: "customers", action: "read" },
      { resource: "analytics", action: "read", condition: () => false }, // Limited analytics
      { resource: "reports", action: "read", condition: () => false }, // No reports
    ],
    description: "موظف - صلاحيات محدودة"
  },
  {
    role: "viewer",
    permissions: [
      { resource: "followups", action: "read", condition: (data) => data?.assigned_to === getCurrentUserId() },
      { resource: "customers", action: "read" },
      { resource: "analytics", action: "read", condition: () => false },
    ],
    description: "مشاهد - صلاحيات قراءة فقط"
  }
];

/**
 * Check if a user has permission for a specific action on a resource
 */
export function hasPermission(
  userRole: UserRole,
  resource: string,
  action: string,
  data?: any
): boolean {
  const roleConfig = rolePermissions.find((r) => r.role === userRole);
  
  if (!roleConfig) {
    return false;
  }

  // Check for wildcard permission (admin)
  const wildcardPermission = roleConfig.permissions.find(
    (p) => p.resource === "*" && p.action === "*"
  );
  
  if (wildcardPermission) {
    return true;
  }

  // Check for specific permission
  const permission = roleConfig.permissions.find(
    (p) => (p.resource === resource || p.resource === "*") && 
           (p.action === action || p.action === "*")
  );

  if (!permission) {
    return false;
  }

  // Check condition if exists
  if (permission.condition) {
    return permission.condition(data);
  }

  return true;
}

/**
 * Get all permissions for a role
 */
export function getRolePermissions(userRole: UserRole): Permission[] {
  const roleConfig = rolePermissions.find((r) => r.role === userRole);
  return roleConfig?.permissions || [];
}

/**
 * Check if user can create followups
 */
export function canCreateFollowups(userRole: UserRole): boolean {
  return hasPermission(userRole, "followups", "create");
}

/**
 * Check if user can update followups
 */
export function canUpdateFollowups(userRole: UserRole, followup?: any): boolean {
  return hasPermission(userRole, "followups", "update", followup);
}

/**
 * Check if user can delete followups
 */
export function canDeleteFollowups(userRole: UserRole): boolean {
  return hasPermission(userRole, "followups", "delete");
}

/**
 * Check if user can view analytics
 */
export function canViewAnalytics(userRole: UserRole): boolean {
  return hasPermission(userRole, "analytics", "read");
}

/**
 * Check if user can manage staff
 */
export function canManageStaff(userRole: UserRole): boolean {
  return hasPermission(userRole, "staff", "create") || 
         hasPermission(userRole, "staff", "update") ||
         hasPermission(userRole, "staff", "delete");
}

/**
 * Get current user ID (placeholder - should be replaced with actual auth logic)
 */
function getCurrentUserId(): string {
  // This should be replaced with actual authentication logic
  // For now, return a placeholder
  return "current_user_id";
}

/**
 * Filter data based on user permissions
 */
export function filterDataByPermission<T>(
  data: T[],
  userRole: UserRole,
  resource: string,
  action: string = "read"
): T[] {
  const roleConfig = rolePermissions.find((r) => r.role === userRole);
  
  if (!roleConfig) {
    return [];
  }

  // Check for wildcard permission
  const wildcardPermission = roleConfig.permissions.find(
    (p) => p.resource === "*" && p.action === "*"
  );
  
  if (wildcardPermission) {
    return data;
  }

  // Filter based on permissions
  return data.filter((item) => {
    const permission = roleConfig.permissions.find(
      (p) => (p.resource === resource || p.resource === "*") && 
             (p.action === action || p.action === "*")
    );

    if (!permission) {
      return false;
    }

    if (permission.condition) {
      return permission.condition(item);
    }

    return true;
  });
}

/**
 * Get allowed actions for a resource based on user role
 */
export function getAllowedActions(
  userRole: UserRole,
  resource: string
): string[] {
  const roleConfig = rolePermissions.find((r) => r.role === userRole);
  
  if (!roleConfig) {
    return [];
  }

  const actions = roleConfig.permissions
    .filter((p) => p.resource === resource || p.resource === "*")
    .map((p) => p.action);

  return Array.from(new Set(actions));
}
