/**
 * core/permissions.ts — redirect to central permissionSystem
 * ⚠️ مُوحَّد — استخدم src/lib/core/permissionSystem.ts مباشرة
 */
export {
  isAdminRole,
  isBranchManagerRole,
  hasPermission,
  normalizeRole,
  getUserDataScope,
  canSeeAllBranches,
  getDefaultPermissionsForRole,
  mergePermissions as mergePermissionMaps,
} from '@/lib/core/permissionSystem';
