export const SALES_INTELLIGENCE_REFRESH_PERMISSIONS = [
  'edit_reviews',
  'approve_reviews',
  'manage_conversation_evaluations',
] as const;

export interface RefreshAuthorizationStaff {
  id: string;
  staff_id?: string | null;
  branch?: string | null;
  role?: string | null;
  active?: boolean | null;
  is_active?: boolean | null;
  status?: string | null;
  can_login?: boolean | null;
}

export interface RefreshAuthorizationSource {
  id: string;
  staff_id?: string | null;
  branch?: string | null;
}

interface PermissionRpcClient {
  rpc(
    functionName: string,
    args?: Record<string, unknown>
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
}

function isActiveStaff(staff: RefreshAuthorizationStaff | null | undefined): boolean {
  return Boolean(
    staff?.id &&
      staff.active &&
      staff.is_active &&
      staff.status === 'active' &&
      staff.can_login !== false
  );
}

async function readBooleanRpc(
  client: PermissionRpcClient,
  functionName: string,
  args?: Record<string, unknown>
): Promise<boolean> {
  const { data, error } = await client.rpc(functionName, args);
  if (error) {
    throw new Error(`${functionName}_failed${error.message ? `: ${error.message}` : ''}`);
  }
  return data === true;
}

export async function authorizeRefreshActor(input: {
  client: PermissionRpcClient;
  sessionAccountId: string;
  staff: RefreshAuthorizationStaff | null;
}): Promise<{ allowed: boolean; topManagement: boolean }> {
  const { client, sessionAccountId, staff } = input;
  if (!isActiveStaff(staff) || staff.id.toLowerCase() !== sessionAccountId.toLowerCase()) {
    return { allowed: false, topManagement: false };
  }

  const { data: currentActorId, error: identityError } = await client.rpc(
    'dawaa_current_staff_account_id_strict'
  );
  if (identityError) {
    throw new Error(`verified_staff_identity_check_failed${identityError.message ? `: ${identityError.message}` : ''}`);
  }
  if (
    typeof currentActorId !== 'string' ||
    currentActorId.toLowerCase() !== sessionAccountId.toLowerCase()
  ) {
    return { allowed: false, topManagement: false };
  }

  const hasReviewPermission = await readBooleanRpc(client, 'dawaa_current_actor_can', {
    required_permissions: [...SALES_INTELLIGENCE_REFRESH_PERMISSIONS],
  });
  if (!hasReviewPermission) return { allowed: false, topManagement: false };

  const topManagement = await readBooleanRpc(client, 'dawaa_actor_is_top_management_v1');
  return { allowed: true, topManagement };
}

export async function isRefreshSourceInActorScope(input: {
  client: PermissionRpcClient;
  actor: RefreshAuthorizationStaff;
  source: RefreshAuthorizationSource;
  topManagement: boolean;
}): Promise<boolean> {
  const { client, actor, source, topManagement } = input;
  if (topManagement) return true;

  const role = String(actor.role || '').trim().toLowerCase();
  if (role === 'team_dawaa_alpha' || role === 'customer_service_manager') return true;

  if (
    actor.staff_id != null &&
    source.staff_id != null &&
    String(actor.staff_id) === String(source.staff_id)
  ) {
    return true;
  }

  if (![
    'branch_manager',
    'customer_service',
    'shift_supervisor_morning',
    'shift_supervisor_evening',
  ].includes(role)) {
    return false;
  }

  const [actorBranch, sourceBranch] = await Promise.all([
    client.rpc('dawaa_customer_request_branch_key', { p_branch: actor.branch ?? null }),
    client.rpc('dawaa_customer_request_branch_key', { p_branch: source.branch ?? null }),
  ]);
  if (actorBranch.error || sourceBranch.error) {
    throw new Error(
      `refresh_source_scope_check_failed: ${actorBranch.error?.message || sourceBranch.error?.message || 'branch_scope_lookup_failed'}`
    );
  }
  return typeof actorBranch.data === 'string' &&
    actorBranch.data.length > 0 &&
    actorBranch.data === sourceBranch.data;
}
