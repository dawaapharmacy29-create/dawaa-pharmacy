import { describe, expect, it } from 'vitest';
import { mergeStaffChoices } from '../staffFallback';

const staff = (id: string, name = 'د أميرة', extra: Record<string, unknown> = {}) => ({
  id, name, branch: 'فرع شكري', role: 'pharmacist', active: true, ...extra,
});

describe('canonical identity in all legacy staff pickers', () => {
  it('never collapses two real staff IDs merely because name, branch and role agree', () => {
    const rows = mergeStaffChoices([staff('doctor-one'), staff('doctor-two')]);
    expect(rows.map((row) => row.id).sort()).toEqual(['doctor-one', 'doctor-two']);
    expect(rows.every((row) => row.display_name?.includes('فرع شكري'))).toBe(true);
    expect(new Set(rows.map((row) => row.display_name)).size).toBe(2);
    expect(rows.every((row) => !row.duplicate_ids?.some((id) => id !== row.id))).toBe(true);
  });

  it('keeps variations of the same employee ID as one choice', () => {
    const rows = mergeStaffChoices([
      staff('same-id', 'د أميرة'),
      staff('same-id', 'د/ أميرة', { username: 'amira' }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('same-id');
  });

  it('excludes archived and inactive entries, without inventing IDs', () => {
    const rows = mergeStaffChoices([
      staff('active'),
      staff('retired', 'د مي', { is_active: false }),
      staff('disabled', 'د بسنت', { active: false }),
      staff('missing', '', {}),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['active']);
  });
});
