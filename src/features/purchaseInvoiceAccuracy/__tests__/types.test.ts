import { describe, expect, it } from 'vitest';
import { getStaffStatusKey, type StaffReportRow } from '../types';

function row(overrides: Partial<StaffReportRow> = {}): StaffReportRow {
  return {
    staff_id: 'staff-1',
    staff_name: 'موظف',
    branch: 'الشامي',
    reviewed_count: 10,
    correct_count: 10,
    mixup_count: 0,
    negligence_count: 0,
    customer_problem_count: 0,
    total_points: 20,
    accuracy_rate: 100,
    avg_points: 2,
    ...overrides,
  };
}

describe('purchase invoice accuracy staff status', () => {
  it('does not classify tiny samples as operational risk', () => {
    expect(getStaffStatusKey(row({ reviewed_count: 1, correct_count: 0, accuracy_rate: 0 }))).toBe('insufficient_sample');
    expect(getStaffStatusKey(row({ reviewed_count: 4, correct_count: 0, accuracy_rate: 0 }))).toBe('insufficient_sample');
  });

  it('classifies mature samples using accuracy and severe errors', () => {
    expect(getStaffStatusKey(row({ reviewed_count: 5, accuracy_rate: 100 }))).toBe('excellent');
    expect(getStaffStatusKey(row({ accuracy_rate: 90, negligence_count: 1 }))).toBe('very_good');
    expect(getStaffStatusKey(row({ accuracy_rate: 75, negligence_count: 2 }))).toBe('follow_up');
    expect(getStaffStatusKey(row({ accuracy_rate: 60, negligence_count: 3 }))).toBe('operational_risk');
  });
});
