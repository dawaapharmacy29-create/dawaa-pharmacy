import { describe, it, expect } from 'vitest';
// The repository's lightweight test runner does not provide vi.mock or vi.fn.
async function withStaffSession<T>(run: () => Promise<T>): Promise<T> {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = { getItem: (_key: string) => 'test-staff-session-token-0123456789abcdef0123456789abcdef' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try { return await run(); }
  finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}
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
    const originalFetch = globalThis.fetch;
    let release: (v: unknown) => void = () => undefined;
    let bundleCalls = 0;
    try {
      globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: { status: 'approved' } }) })) as unknown as typeof fetch;
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
      await withStaffSession(() => approveAttendanceResolution({ staffId: 's1', date: '2026-10-01', note: 'ok' }));
      const after = getAttendanceCommandCenterBundleV1(args);
      // Checked before awaiting: a read that joined the pre-mutation request would otherwise wait on it.
      const callsAfterMutation = bundleCalls;
      release({ data: bundle(1), error: null });
      expect(callsAfterMutation).toBe(2);
      expect((await after).summary.total_cases).toBe(0);
      expect((await before).summary.total_cases).toBe(1);
    } finally {
      client.rpc = original;
      globalThis.fetch = originalFetch;
    }
  });
});
