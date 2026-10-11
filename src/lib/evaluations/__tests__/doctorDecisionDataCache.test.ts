import { describe, it, expect } from 'vitest';
import { supabase } from '@/lib/supabase';
import { invalidateDoctorDecisionData, loadBranchPerformanceWindow } from '@/lib/evaluations/doctorDecisionDataService';

// The decision cache keeps a promise per branch window. A thrown request or parser error must surface as a
// failed source and leave the cache, never stay pinned as a rejected promise that every retry receives.
const validWindow = {
  branch: 'فرع الشامي', windowStart: '2026-06-26', windowEnd: '2026-10-26', dataAsOf: null,
  cycles: [{ start: '2026-09-26', endExclusive: '2026-10-26' }], ambiguousNames: [], branchCycles: [], doctors: [],
};

describe('doctor decision data cache', () => {
  it('turns a throwing parser into a failed source and retries the next call', async () => {
    const client = supabase as unknown as { rpc: (...a: unknown[]) => Promise<unknown> };
    const original = client.rpc;
    let calls = 0;
    try {
      invalidateDoctorDecisionData();
      // cycles contains null: the shape parser throws on it.
      client.rpc = async () => { calls += 1; return { data: { ...validWindow, cycles: [null] }, error: null }; };
      const first = await loadBranchPerformanceWindow({ branch: 'فرع الشامي', cycleLabel: '2026-10' });
      expect(first.status).toBe('failed');
      client.rpc = async () => { calls += 1; return { data: validWindow, error: null }; };
      const second = await loadBranchPerformanceWindow({ branch: 'فرع الشامي', cycleLabel: '2026-10' });
      expect(second.status).toBe('available');
      expect(calls).toBe(2);
      // A successful window is shared (no duplicate request) until it expires or is invalidated.
      const third = await loadBranchPerformanceWindow({ branch: 'فرع الشامي', cycleLabel: '2026-10' });
      expect(third.status).toBe('available');
      expect(calls).toBe(2);
    } finally {
      client.rpc = original;
      invalidateDoctorDecisionData();
    }
  });

  it('keys the window by branch: one branch never serves another', async () => {
    const client = supabase as unknown as { rpc: (...a: unknown[]) => Promise<unknown> };
    const original = client.rpc;
    try {
      invalidateDoctorDecisionData();
      client.rpc = async (_fn: unknown, params: unknown) => ({ data: { ...validWindow, branch: (params as { p_branch: string }).p_branch }, error: null });
      const shami = await loadBranchPerformanceWindow({ branch: 'فرع الشامي', cycleLabel: '2026-10' });
      const shokry = await loadBranchPerformanceWindow({ branch: 'فرع شكري', cycleLabel: '2026-10' });
      expect(shami.value?.branch).toBe('فرع الشامي');
      expect(shokry.value?.branch).toBe('فرع شكري');
    } finally {
      client.rpc = original;
      invalidateDoctorDecisionData();
    }
  });
});
