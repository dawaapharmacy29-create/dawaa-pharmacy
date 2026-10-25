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
import { getAttendanceDayEvidence, resolveDatedAttendanceShift } from '@/lib/attendance/attendanceResolutionService';

describe('inline attendance evidence boundary', () => {
  async function withRpc(result: unknown, run: (calls: Array<[string, unknown]>) => Promise<void>) {
    const client = supabase as unknown as { rpc: (fn: string, args: unknown) => Promise<unknown> };
    const original = client.rpc;
    const calls: Array<[string, unknown]> = [];
    try { client.rpc = async (fn, args) => { calls.push([fn, args]); return result; }; await run(calls); }
    finally { client.rpc = original; }
  }
  async function failure(run: () => Promise<unknown>) {
    let failed = false;
    try { await run(); } catch { failed = true; }
    expect(failed).toBe(true);
  }
  it('reads one day through the canonical queue and selects staff identity', async () => {
    await withRpc({ data: [{ staff_id: 'other', attendance_date: '2026-10-24' }, { staff_id: 's1', attendance_date: '2026-10-24', candidate_hours: 6 }], error: null }, async (calls) => {
      expect((await getAttendanceDayEvidence('s1', '2026-10-24')).candidate_hours).toBe(6);
      expect(calls[0][0]).toBe('get_attendance_resolution_queue_v4');
      expect(calls[0][1]).toMatchObject({ p_start: '2026-10-24', p_end: '2026-10-24', p_limit: 1000 });
    });
  });
  it('does not treat read failure as an absent day', async () => {
    await withRpc({ data: null, error: { message: 'outage' } }, async () => { await failure(() => getAttendanceDayEvidence('s1', '2026-10-24')); });
  });
  it('does not reuse another employee or an absent/truncated record', async () => {
    await withRpc({ data: [{ staff_id: 's2', attendance_date: '2026-10-24' }], error: null }, async () => { await failure(() => getAttendanceDayEvidence('s1', '2026-10-24')); });
  });
  it('writes an overnight dated override through the restricted server command', async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; options: RequestInit }> = [];
    try {
      globalThis.fetch = (async (url: string, options: RequestInit) => {
        requests.push({ url, options });
        return { ok: true, json: async () => ({ data: { success: true } }) } as Response;
      }) as typeof fetch;
      await withStaffSession(() => resolveDatedAttendanceShift({ staffId: 's1', date: '2026-10-24', start: '22:00', end: '06:00', note: 'documented evidence' }));
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe('/api/attendance-inline-command');
      expect(JSON.parse(String(requests[0].options.body))).toEqual({
        action: 'shift', staffId: 's1', date: '2026-10-24',
        payload: { start: '22:00', end: '06:00', note: 'documented evidence' },
      });
      expect(requests[0].options.credentials).toBe('omit');
    } finally { globalThis.fetch = originalFetch; }
  });
  it('preserves database rejection of approved or unauthorized changes', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => ({ ok: false, json: async () => ({ error: 'approved_attendance_cannot_be_rewritten' }) })) as unknown as typeof fetch;
      await withStaffSession(() => failure(() => resolveDatedAttendanceShift({ staffId: 's1', date: '2026-10-24', start: '09:00', end: '17:00', note: 'evidence' })));
    } finally { globalThis.fetch = originalFetch; }
  });
  it('requires an affirmative saved acknowledgement', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: { success: false } }) })) as unknown as typeof fetch;
      await withStaffSession(() => failure(() => resolveDatedAttendanceShift({ staffId: 's1', date: '2026-10-24', start: '09:00', end: '17:00', note: 'evidence' })));
    } finally { globalThis.fetch = originalFetch; }
  });
});
