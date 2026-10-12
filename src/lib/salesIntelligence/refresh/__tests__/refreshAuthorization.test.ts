import { describe, expect, it, vi } from 'vitest';
import {
  authorizeRefreshActor,
  isRefreshSourceInActorScope,
  SALES_INTELLIGENCE_REFRESH_PERMISSIONS,
} from '../../../../../server/sales-intelligence-refresh-authorization';

const actor = (role: string, overrides: Record<string, unknown> = {}) => ({
  id: 'account-1',
  staff_id: 'staff-1',
  branch: 'فرع شكري',
  role,
  active: true,
  is_active: true,
  status: 'active',
  can_login: true,
  ...overrides,
});

function permissionClient(options: {
  currentActorId?: string | null;
  hasPermission?: boolean;
  topManagement?: boolean;
  branchKeys?: Record<string, string | null>;
} = {}) {
  return {
    rpc: vi.fn(async (functionName: string, args?: Record<string, unknown>) => {
      switch (functionName) {
        case 'dawaa_current_staff_account_id_strict':
          return {
            data: Object.prototype.hasOwnProperty.call(options, 'currentActorId')
              ? options.currentActorId
              : 'account-1',
            error: null,
          };
        case 'dawaa_current_actor_can':
          expect(args?.required_permissions).toEqual([...SALES_INTELLIGENCE_REFRESH_PERMISSIONS]);
          return { data: options.hasPermission ?? true, error: null };
        case 'dawaa_actor_is_top_management_v1':
          return { data: options.topManagement ?? false, error: null };
        case 'dawaa_customer_request_branch_key':
          return {
            data: options.branchKeys?.[String(args?.p_branch)] ?? null,
            error: null,
          };
        default:
          return { data: null, error: { message: 'unexpected_rpc' } };
      }
    }),
  };
}

async function authorize(role: string, options: {
  currentActorId?: string | null;
  hasPermission?: boolean;
  topManagement?: boolean;
  staff?: Record<string, unknown>;
} = {}) {
  const client = permissionClient(options);
  const result = await authorizeRefreshActor({
    client,
    sessionAccountId: 'account-1',
    staff: actor(role, options.staff),
  });
  return { client, result };
}

describe('Sales Intelligence refresh authorization', () => {
  it.each(['general_manager', 'admin', 'executive_manager', 'branches_manager'])(
    'allows %s only when canonical review permission is present',
    async (role) => {
      const { result } = await authorize(role, { topManagement: true });
      expect(result).toEqual({ allowed: true, topManagement: true });
    }
  );

  it('allows a scoped customer service manager with canonical permission', async () => {
    const { client, result } = await authorize('customer_service_manager');
    expect(result.allowed).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith('dawaa_current_actor_can', {
      required_permissions: [...SALES_INTELLIGENCE_REFRESH_PERMISSIONS],
    });
    await expect(isRefreshSourceInActorScope({
      client,
      actor: actor('customer_service_manager'),
      source: { id: 'source-1', branch: 'فرع آخر', staff_id: 'another-staff' },
      topManagement: result.topManagement,
    })).resolves.toBe(true);
  });

  it('denies customer service manager without canonical review permission', async () => {
    const { result } = await authorize('customer_service_manager', { hasPermission: false });
    expect(result).toEqual({ allowed: false, topManagement: false });
  });

  it('denies permission holders outside branch and staff scope', async () => {
    const { client, result } = await authorize('branch_manager', {
      branchKeys: { 'فرع شكري': 'shokry', 'فرع آخر': 'other' },
    });
    await expect(isRefreshSourceInActorScope({
      client,
      actor: actor('branch_manager'),
      source: { id: 'source-1', branch: 'فرع آخر', staff_id: 'another-staff' },
      topManagement: result.topManagement,
    })).resolves.toBe(false);
  });

  it('allows matching branch scope or direct source-staff ownership', async () => {
    const { client, result } = await authorize('branch_manager', {
      branchKeys: { 'فرع شكري': 'shokry' },
    });
    await expect(isRefreshSourceInActorScope({
      client,
      actor: actor('branch_manager'),
      source: { id: 'source-branch', branch: 'فرع شكري', staff_id: 'another-staff' },
      topManagement: result.topManagement,
    })).resolves.toBe(true);

    await expect(isRefreshSourceInActorScope({
      client,
      actor: actor('pharmacist'),
      source: { id: 'source-owner', branch: 'فرع آخر', staff_id: 'staff-1' },
      topManagement: result.topManagement,
    })).resolves.toBe(true);
  });

  it('denies inactive accounts before permission or scope checks', async () => {
    const { client, result } = await authorize('general_manager', {
      staff: { active: false },
    });
    expect(result.allowed).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([null, 'another-account'])(
    'denies invalid or mismatched verified session identity (%s)',
    async (currentActorId) => {
      const { client, result } = await authorize('general_manager', {
        currentActorId,
        topManagement: true,
      });
      expect(result.allowed).toBe(false);
      expect(client.rpc).toHaveBeenCalledTimes(1);
    }
  );

  it('does not let a role bypass a missing permission', async () => {
    const { result } = await authorize('general_manager', {
      hasPermission: false,
      topManagement: true,
    });
    expect(result.allowed).toBe(false);
  });

  it('preserves top-management scope for a permitted actor', async () => {
    const { client, result } = await authorize('executive_manager', { topManagement: true });
    await expect(isRefreshSourceInActorScope({
      client,
      actor: actor('executive_manager'),
      source: { id: 'source-1', branch: 'أي فرع', staff_id: 'another-staff' },
      topManagement: result.topManagement,
    })).resolves.toBe(true);
  });

  it('does not use a legacy identity header when strict session identity is absent', async () => {
    const { result } = await authorize('general_manager', {
      currentActorId: null,
      topManagement: true,
    });
    expect(result.allowed).toBe(false);
  });
});
