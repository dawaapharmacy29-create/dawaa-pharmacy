export const TABLES = {
  staff: "staff",
  staffAccounts: "staff_accounts",
  shiftSchedules: "shift_schedules",
  employeeTransactions: "employee_transactions",
  permissions: "permissions",
  permissionDefinitions: "permission_definitions",
  userPermissions: "user_permissions",
  userPermissionOverrides: "user_permission_overrides",
  shiftPerformanceReviews: "shift_performance_reviews",
  shiftPerformanceReviewMembers: "shift_performance_review_members",
  shiftExceptions: "shift_exceptions",
} as const;

export type SupabaseTableName = (typeof TABLES)[keyof typeof TABLES];
