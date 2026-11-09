import { describe, expect, it } from 'vitest';
import { resolveScheduleCell, type ScheduleActualDay } from '../scheduleActualCell';

const work = { shift_start: '09:00:00', shift_end: '17:00:00', is_off: false, is_day_off: false, source_kind: 'weekly' };
const off = { shift_start: null, shift_end: null, is_off: true, is_day_off: true, source_kind: 'weekly' };
const actual = (patch: Partial<ScheduleActualDay>): ScheduleActualDay => ({
  staff_id: 's', date: '2026-11-08', has_summary: true, first_in: null, last_out: null,
  status: 'approved', resolution_status: null, time_off_kind: null, ...patch,
});
const run = (plan: typeof work | typeof off | null, a: ScheduleActualDay | null, extra = {}) =>
  resolveScheduleCell({ date: '2026-11-08', today: '2026-11-09', plan, actual: a, actualsAvailable: true, ...extra });

describe('resolveScheduleCell', () => {
  it('shows a day off with a check-in as worked on the off day', () => {
    expect(run(off, actual({ first_in: '2026-11-08T07:00:00Z' })).kind).toBe('worked_on_off');
  });
  it('does not call a lone check-out on an off day a worked day', () => {
    expect(run(off, actual({ last_out: '2026-11-07T23:00:00Z' })).kind).toBe('checkout_only_on_off');
  });
  it('shows a past work day with no punches as no punch', () => {
    expect(run(work, actual({})).kind).toBe('no_punch');
  });
  it('separates approved leave from absence', () => {
    expect(run(work, actual({ time_off_kind: 'sick_leave' }))).toMatchObject({ kind: 'leave', label: 'إجازة مرضية' });
  });
  it('never turns a failed attendance read into absence', () => {
    expect(run(work, null, { actualsAvailable: false }).kind).toBe('planned');
  });
  it('separates a missing attendance day from no punch', () => {
    expect(run(work, null).kind).toBe('no_data');
  });
  it('keeps today and future days as planned until punches arrive', () => {
    expect(run(work, actual({}), { date: '2026-11-09' }).kind).toBe('planned');
  });
  it('renders actual times in Cairo time', () => {
    const cell = run(work, actual({ first_in: '2026-11-08T07:05:00Z', last_out: '2026-11-08T15:10:00Z' }));
    expect(cell).toMatchObject({ kind: 'present', actualIn: '09:05', actualOut: '17:10' });
  });
});
