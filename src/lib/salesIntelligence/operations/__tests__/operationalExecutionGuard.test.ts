import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_COMPLAINT_CREATOR } from '../proposalApprovalReadiness';

const mocks = vi.hoisted(() => ({ read: vi.fn(), rpc: vi.fn(), select: vi.fn(), eq: vi.fn() }));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: mocks.select.mockImplementation(() => ({
        eq: mocks.eq.mockImplementation(() => ({ maybeSingle: mocks.read })),
      })),
    }),
    rpc: mocks.rpc,
  },
}));
vi.mock('../sourceCorrectionModel', () => ({ hasMultipleExplicitStaffIntroductions: () => false }));
const { executeOperationalAction } = await import('../sourceOperationsService');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rpc.mockResolvedValue({ data: { ok: true, target_id: 'target-1' }, error: null });
});

describe('operational submission rechecks complaint provenance', () => {
  it('refuses a legacy ready complaint even when the caller bypasses the panel', async () => {
    mocks.read.mockResolvedValue({ data: { id: 'a1', action_type: 'complaint_followup', status: 'ready', created_by: 'legacy' }, error: null });
    await expect(executeOperationalAction('a1')).rejects.toThrow(/محرك سابق/);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.select).toHaveBeenCalledWith('id,action_type,status,created_by');
    expect(mocks.eq).toHaveBeenCalledWith('id', 'a1');
  });

  it('does not turn a failed or missing read into permission to execute', async () => {
    mocks.read.mockResolvedValue({ data: null, error: new Error('read failed') });
    await expect(executeOperationalAction('a1')).rejects.toThrow('read failed');
    mocks.read.mockResolvedValue({ data: null, error: null });
    await expect(executeOperationalAction('a1')).rejects.toThrow('whatsapp_action_not_found');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('leaves canonical complaint validation and idempotent retries to the RPC', async () => {
    mocks.read.mockResolvedValue({ data: { id: 'a1', action_type: 'complaint_followup', status: 'ready', created_by: CANONICAL_COMPLAINT_CREATOR }, error: null });
    expect(await executeOperationalAction('a1')).toEqual({ targetId: 'target-1', alreadyCreated: false });
    expect(mocks.rpc).toHaveBeenCalledWith('dawaa_materialize_whatsapp_action_v1', { p_action_id: 'a1' });
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('canonical complaint stale') });
    await expect(executeOperationalAction('a1')).rejects.toThrow('canonical complaint stale');
  });

  it('preserves the explicit approval RPC path for other action types', async () => {
    mocks.read.mockResolvedValue({ data: { id: 'a1', action_type: 'customer_request', status: 'ready', created_by: 'legacy' }, error: null });
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('customer_request_requires_explicit_approval') });
    await expect(executeOperationalAction('a1')).rejects.toThrow('customer_request_requires_explicit_approval');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
