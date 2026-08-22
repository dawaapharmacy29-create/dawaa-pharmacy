import { describe, expect, it } from 'vitest';
import { recordBelongsToStaff, type PointLedgerRecord, type StaffLedgerTarget } from '@/lib/pointsLedger';

const staff: StaffLedgerTarget = {
  id: 'staff-a',
  name: 'د أحمد',
  duplicate_ids: ['staff-a-old'],
  aliases: ['أحمد'],
};

describe('points ledger canonical staff identity', () => {
  it('accepts the canonical staff id', () => {
    const row: PointLedgerRecord = { staff_id: 'staff-a', employee_name: 'اسم مختلف' };
    expect(recordBelongsToStaff(row, staff)).toBe(true);
  });

  it('accepts an explicitly registered duplicate id', () => {
    const row: PointLedgerRecord = { staff_id: 'staff-a-old', employee_name: 'اسم مختلف' };
    expect(recordBelongsToStaff(row, staff)).toBe(true);
  });

  it('does not let a matching name override a mismatching canonical staff id', () => {
    const row: PointLedgerRecord = { staff_id: 'staff-b', employee_name: 'د أحمد' };
    expect(recordBelongsToStaff(row, staff)).toBe(false);
  });

  it('uses name compatibility only when the historical record has no id', () => {
    const row: PointLedgerRecord = { employee_name: 'أحمد' };
    expect(recordBelongsToStaff(row, staff)).toBe(true);
  });
});
