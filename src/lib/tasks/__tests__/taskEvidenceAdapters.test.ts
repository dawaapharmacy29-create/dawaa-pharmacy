import { describe, expect, it } from 'vitest';
import {
  cleaningTaskToTaskEvidence,
  customerFollowupToTaskEvidence,
  managerChecklistToTaskEvidence,
  shiftNoteToTaskEvidence,
} from '../taskEvidenceAdapters';

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
const MANAGER_ID = '22222222-2222-4222-8222-222222222222';

describe('task evidence adapters', () => {
  it('maps reviewed cleaning work to completed evidence without financial fields', () => {
    const evidence = cleaningTaskToTaskEvidence({
      id: '33333333-3333-4333-8333-333333333333',
      branch: 'فرع شكري',
      task_date: '2026-08-24',
      shift: 'morning',
      responsible_staff_id: STAFF_ID,
      status: 'approved',
      reviewed_at: '2026-08-24T10:00:00+03:00',
      created_by: MANAGER_ID,
      created_at: '2026-08-24T08:00:00+03:00',
      review_photo_url: 'https://example.test/evidence.jpg',
    });

    expect(evidence?.status).toBe('completed');
    expect(evidence?.subjectStaffId).toBe(STAFF_ID);
    expect(evidence?.sourceType).toBe('cleaning_task');
    expect(evidence?.evidenceRef).toBe('https://example.test/evidence.jpg');
    expect(Object.keys(evidence?.metadata || {})).not.toContain('points');
  });

  it('marks an overdue incomplete manager checklist item as missed', () => {
    const evidence = managerChecklistToTaskEvidence(
      {
        id: '44444444-4444-4444-8444-444444444444',
        staff_id: STAFF_ID,
        branch: 'فرع الشامي',
        task_date: '2026-08-23',
        task_key: 'opening-check',
        completed: false,
        created_at: '2026-08-23T09:00:00+03:00',
      },
      '2026-08-24T12:00:00+03:00'
    );

    expect(evidence?.status).toBe('missed');
    expect(evidence?.taskKey).toBe('opening-check');
  });

  it('treats a contacted follow-up as accepted rather than missed', () => {
    const evidence = customerFollowupToTaskEvidence(
      {
        id: 'followup-1',
        branch: 'فرع شكري',
        assigned_staff_id: STAFF_ID,
        followup_reason_key: 'vip-followup',
        followup_status: 'pending',
        followup_datetime: '2026-08-24T09:00:00+03:00',
        contacted_at: '2026-08-24T09:10:00+03:00',
        attempt_count: 1,
        created_at: '2026-08-24T08:00:00+03:00',
      },
      '2026-08-24T12:00:00+03:00'
    );

    expect(evidence?.status).toBe('accepted');
    expect(evidence?.acceptedAt).toBe('2026-08-24T06:10:00.000Z');
  });

  it('excludes duplicate or hidden follow-ups from performance evidence', () => {
    const duplicate = customerFollowupToTaskEvidence({
      id: 'followup-duplicate',
      branch: 'فرع شكري',
      assigned_staff_id: STAFF_ID,
      is_duplicate: true,
      created_at: '2026-08-24T08:00:00+03:00',
    });

    expect(duplicate).toBeNull();
  });

  it('requires a canonical resolved staff id for shift-note evidence', () => {
    const unresolved = shiftNoteToTaskEvidence(
      {
        id: '55555555-5555-4555-8555-555555555555',
        branch: 'فرع شكري',
        title: 'تسليم طلب',
        status: 'completed',
        completed_at: '2026-08-24T10:00:00+03:00',
      },
      'legacy-name-only'
    );

    const resolved = shiftNoteToTaskEvidence(
      {
        id: '55555555-5555-4555-8555-555555555555',
        branch: 'فرع شكري',
        title: 'تسليم طلب',
        status: 'completed',
        completed_at: '2026-08-24T10:00:00+03:00',
      },
      STAFF_ID
    );

    expect(unresolved).toBeNull();
    expect(resolved?.status).toBe('completed');
    expect(resolved?.subjectStaffId).toBe(STAFF_ID);
  });
});
