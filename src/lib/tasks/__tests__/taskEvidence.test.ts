import { describe, expect, it } from 'vitest';
import { normalizeTaskEvidence, taskEvidenceStableKey } from '../taskEvidence';

describe('task evidence contract', () => {
  it('normalizes a completed operational event with canonical staff/source identity', () => {
    const evidence = normalizeTaskEvidence({
      sourceType: 'cleaning_task',
      sourceId: 'clean-1',
      taskKey: 'front-area-cleaning',
      subjectStaffId: 'staff-1',
      branch: 'فرع شكري',
      status: 'completed',
      occurredAt: '2026-08-24T10:00:00+03:00',
      completedAt: '2026-08-24T10:00:00+03:00',
      assignedByStaffId: 'staff-manager',
    });

    expect(evidence.sourceType).toBe('cleaning_task');
    expect(evidence.subjectStaffId).toBe('staff-1');
    expect(evidence.completedAt).toBe('2026-08-24T07:00:00.000Z');
    expect(taskEvidenceStableKey(evidence)).toBe('cleaning_task:clean-1:front-area-cleaning:staff-1');
  });

  it('requires a documented reason for cancellation', () => {
    expect(() => normalizeTaskEvidence({
      sourceType: 'shift_note',
      sourceId: 'note-1',
      taskKey: 'handover',
      subjectStaffId: 'staff-1',
      branch: 'فرع الشامي',
      status: 'cancelled',
      occurredAt: '2026-08-24T10:00:00+03:00',
    })).toThrow(/cancellationReason/);
  });

  it('does not accept completed evidence without completion time', () => {
    expect(() => normalizeTaskEvidence({
      sourceType: 'customer_followup',
      sourceId: 'followup-1',
      taskKey: 'daily-followup',
      subjectStaffId: 'staff-1',
      branch: 'فرع شكري',
      status: 'completed',
      occurredAt: '2026-08-24T10:00:00+03:00',
    })).toThrow(/completedAt/);
  });
});
