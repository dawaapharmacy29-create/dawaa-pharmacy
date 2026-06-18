/**
 * rolePermissionPresets.ts
 * Preset helpers — built on top of the central permission system.
 * ⚠️ لا تُعرِّف صلاحيات هنا — اذهب إلى src/lib/core/permissionSystem.ts
 */
import {
  ROLES,
  ROLE_PERMISSIONS,
  getDefaultPermissionsForRole,
  mergePermissions,
  normalizeRole,
  type RoleKey,
} from '@/lib/core/permissionSystem';

export type { RoleKey };

export interface PermissionPreset {
  key: RoleKey;
  label: string;
  description: string;
  match: string[];
  permissions: Record<string, boolean>;
}

export const PERMISSION_PRESETS: PermissionPreset[] = ROLES.map((role) => ({
  key: role.key,
  label: role.labelAr,
  description: role.description,
  match: [role.key, role.labelAr],
  permissions: getDefaultPermissionsForRole(role.key),
}));

export type PermissionPresetKey = RoleKey;

export function getPresetForRole(role?: string | null): PermissionPreset | undefined {
  const key = normalizeRole(role);
  return PERMISSION_PRESETS.find((p) => p.key === key);
}

export function mergePermissionsWithPreset(
  basePermissions: Record<string, boolean>,
  presetKey: RoleKey
): Record<string, boolean> {
  const preset = getPresetForRole(presetKey);
  if (!preset) return basePermissions;
  return mergePermissions(preset.permissions, basePermissions);
}
