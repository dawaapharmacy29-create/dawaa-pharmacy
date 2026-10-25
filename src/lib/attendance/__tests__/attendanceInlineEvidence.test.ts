import { describe, it, expect } from 'vitest';
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
  it('writes an overnight dated override through the existing authorized RPC only', async () => {
    await withRpc({ data: { success: true }, error: null }, async (calls) => {
      await resolveDatedAttendanceShift({ staffId: 's1', date: '2026-10-24', start: '22:00', end: '06:00', note: 'documented evidence' });
      expect(calls).toEqual([['resolve_dated_shift_from_attendance_v1', { p_staff_id: 's1', p_date: '2026-10-24', p_start: '22:00', p_end: '06:00', p_note: 'documented evidence' }]]);
    });
  });
  it('preserves database rejection of approved or unauthorized changes', async () => {
    await withRpc({ data: null, error: { message: 'approved_attendance_cannot_be_rewritten' } }, async () => {
      await failure(() => resolveDatedAttendanceShift({ staffId: 's1', date: '2026-10-24', start: '09:00', end: '17:00', note: 'evidence' }));
    });
  });
  it('requires an affirmative saved acknowledgement', async () => {
    await withRpc({ data: null, error: null }, async () => {
      await failure(() => resolveDatedAttendanceShift({ staffId: 's1', date: '2026-10-24', start: '09:00', end: '17:00', note: 'evidence' }));
    });
  });
});
