import { describe, it, expect } from 'vitest';
import { supabase } from '@/lib/supabase';
import { approveAttendanceResolution, getAttendanceCommandCenterBundleV1, getAttendanceDiagnosticSummaryV1 } from '@/lib/attendance/attendanceResolutionService';

type Rpc = (fn: string, params?: unknown) => Promise<unknown>;
const bundle = (total: number) => ({ rows: [], summary: { total_cases: total, causes: [] }, generated_at: '2026-10-09T00:00:00Z' });

describe('attendance command center in-flight sharing', () => {
  it('shares one bundle request between the inbox and the summary', async () => {
    const client = supabase as unknown as { rpc: Rpc };
    const original = client.rpc;
    let bundleCalls = 0;
    try {
      client.rpc = async (fn) => { if (fn === 'get_attendance_command_center_bundle_v1') bundleCalls += 1; return { data: bundle(3), error: null }; };
      const args = { start: '2026-09-26', end: '2026-10-25', branch: 'فرع الشامي' };
      const [a, b] = await Promise.all([getAttendanceCommandCenterBundleV1(args), getAttendanceDiagnosticSummaryV1(args)]);
      expect(a.summary.total_cases).toBe(3);
      expect(b.total_cases).toBe(3);
      expect(bundleCalls).toBe(1);
    } finally {
      client.rpc = original;
    }
  });

  it('a read after a mutation never joins a request that started before it', async () => {
    const client = supabase as unknown as { rpc: Rpc };
    const original = client.rpc;
    let release: (v: unknown) => void = () => undefined;
    let bundleCalls = 0;
    try {
      client.rpc = async (fn) => {
        if (fn === 'get_attendance_command_center_bundle_v1') {
          bundleCalls += 1;
          if (bundleCalls === 1) return new Promise((resolve) => { release = resolve; }); // pre-mutation read, still running
          return { data: bundle(0), error: null };
        }
        return { data: { id: 'r1' }, error: null };
      };
      const args = { start: '2026-09-26', end: '2026-10-25', branch: 'فرع شكري' };
      const before = getAttendanceCommandCenterBundleV1(args);
      await approveAttendanceResolution({ staffId: 's1', date: '2026-10-01', note: 'ok' });
      const after = getAttendanceCommandCenterBundleV1(args);
      // Checked before awaiting: a read that joined the pre-mutation request would otherwise wait on it.
      const callsAfterMutation = bundleCalls;
      release({ data: bundle(1), error: null });
      expect(callsAfterMutation).toBe(2);
      expect((await after).summary.total_cases).toBe(0);
      expect((await before).summary.total_cases).toBe(1);
    } finally {
      client.rpc = original;
    }
  });
});
