export interface LegacyPermissionWriteResult {
  data: null;
  error: null;
  legacy: true;
}

/**
 * Compatibility shim for the retired `user_permissions` write path.
 *
 * Effective account permissions are persisted only in `staff_accounts.permissions`
 * and resolved through the canonical permission RPC/system. Keeping this function
 * as a no-op lets older callers migrate without re-introducing a second source of
 * permission truth.
 */
export async function upsertUserPermission(
  _userId: string,
  _permissionKey: string,
  _allowed: boolean,
  _createdBy?: string | null
): Promise<LegacyPermissionWriteResult> {
  return { data: null, error: null, legacy: true };
}
