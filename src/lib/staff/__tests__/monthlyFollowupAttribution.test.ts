import { describe, expect, it } from 'vitest';
import { followupExecutorStaffId, isFollowupExecutedBy } from '@/lib/staff/monthlyFollowupAttribution';

describe('monthly follow-up executor attribution', () => {
  it('prefers the actual handler over lower-priority assignment fields', () => {
    const row = {
      handled_by_staff_id: 'handler',
      assigned_to_staff_id: 'assigned-to',
      assigned_staff_id: 'assigned',
      staff_id: 'legacy',
      requested_by_staff_id: 'requester',
    };
    expect(followupExecutorStaffId(row)).toBe('handler');
    expect(isFollowupExecutedBy(row, 'assigned')).toBe(false);
  });

  it('falls back through assigned_to, assigned_staff, then legacy staff id', () => {
    expect(followupExecutorStaffId({ assigned_to_staff_id: 'a', assigned_staff_id: 'b' })).toBe('a');
    expect(followupExecutorStaffId({ assigned_staff_id: 'b', staff_id: 'c' })).toBe('b');
    expect(followupExecutorStaffId({ staff_id: 'c' })).toBe('c');
  });

  it('never treats the requester alone as the executor', () => {
    const row = { requested_by_staff_id: 'doctor-requester' };
    expect(followupExecutorStaffId(row)).toBe('');
    expect(isFollowupExecutedBy(row, 'doctor-requester')).toBe(false);
  });
});
