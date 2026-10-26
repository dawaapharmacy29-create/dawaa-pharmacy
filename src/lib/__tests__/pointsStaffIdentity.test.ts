import { describe, expect, it } from 'vitest';
import { buildUniquePointsStaffNames, resolvePointsStaffId } from '../pointsStaffIdentity';

const staff = [
  { id: 's1', name: 'د/ أحمد علي' },
  { id: 's2', name: 'أحمد علي' },
  { id: 's3', name: 'د/ بسنت محمد' },
];
const ids = new Set(staff.map((s) => s.id));
const unique = buildUniquePointsStaffNames(staff);

describe('points identity is fail-closed', () => {
  it('does not resolve duplicated names to the first staff', () => {
    expect(resolvePointsStaffId({ employee_name: 'احمد علي' }, ids, unique)).toBeNull();
  });
  it('resolves a unique historical name-only record', () => {
    expect(resolvePointsStaffId({ employee_name: 'بسنت محمد' }, ids, unique)).toBe('s3');
  });
  it('preserves an explicit employee id despite a misleading name', () => {
    expect(resolvePointsStaffId({ employee_id: 's1', employee_name: 'بسنت محمد' }, ids, unique)).toBe('s1');
  });
  it('never replaces unknown historical ids using names', () => {
    expect(resolvePointsStaffId({ staff_id: 'retired', employee_name: 'بسنت محمد' }, ids, unique)).toBeNull();
  });
  it('does not resolve contradictory explicit ids', () => {
    expect(resolvePointsStaffId({ staff_id: 's1', employee_id: 's2', employee_name: 'بسنت محمد' }, ids, unique)).toBeNull();
  });
});
