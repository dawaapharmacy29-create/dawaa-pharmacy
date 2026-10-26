import { describe, expect, it } from 'vitest';
import { canonicalActiveStaff, canonicalStaffFromReference, type StaffDirectoryIdentity } from '../staffDirectoryReadModel';

const row = (id: string, name: string, source: StaffDirectoryIdentity['source'], active = true): StaffDirectoryIdentity => ({
  id, name, source, active, branch: 'شكري', role: 'pharmacist', username: null, status: 'active',
});

describe('canonical employees in selection and decision lists', () => {
  it('shows Amira and Hiba exactly once despite account and spelling aliases', () => {
    const rows = [
      row('amira', 'د اميرة', 'staff'),
      row('amira', 'د/ أميرة', 'alias'),
      row('amira', 'اميرة', 'alias'),
      row('amira', 'دكتور اميرة', 'alias'),
      row('amira', 'د اميرة', 'staff_account'),
      row('hiba', 'هبه محمد', 'staff'),
      row('hiba', 'هبه', 'alias'),
      row('hiba', 'د هبه', 'alias'),
      row('hiba', 'هبه محمد', 'staff_account'),
      row('archived', 'د دنيا', 'staff', false),
      row('orphan', 'حساب وهمي', 'staff_account'),
      row('orphan', 'اسم وهمي', 'alias'),
    ];
    expect(canonicalActiveStaff(rows).map((person) => [person.id, person.name]))
      .toEqual([['amira', 'د اميرة'], ['hiba', 'هبه محمد']]);
  });

  it('keeps two confirmed different Islams as two employees', () => {
    expect(canonicalActiveStaff([
      row('farouk', 'د اسلام فاروق', 'staff'),
      row('sabaa', 'اسلام السبع', 'staff'),
      row('farouk', 'اسلام', 'alias'),
      row('sabaa', 'اسلام', 'alias'),
    ]).map((person) => person.id)).toEqual(['farouk', 'sabaa']);
  });

  it('deduplicates a repeated canonical row by immutable staff id', () => {
    expect(canonicalActiveStaff([row('amira', 'د اميرة', 'staff'), row('amira', 'د اميرة', 'staff')])).toHaveLength(1);
  });

  it('translates a linked login id to staff id without guessing from names or usernames', () => {
    const rows = [
      row('maaz', 'د معاذ', 'staff'),
      { ...row('maaz', 'د معاذ', 'staff_account'), accountId: 'login-maaz' },
      row('maaz', 'د/ معاذ', 'alias'),
    ];
    expect(canonicalStaffFromReference('login-maaz', rows)?.id).toBe('maaz');
    expect(canonicalStaffFromReference('maaz', rows)?.id).toBe('maaz');
    expect(canonicalStaffFromReference('admin', rows)).toBeNull();
    expect(canonicalStaffFromReference('د معاذ', rows)).toBeNull();
    expect(canonicalStaffFromReference('login-missing', rows)).toBeNull();
  });

  it('refuses a login id with competing linked staff owners', () => {
    const rows = [
      row('amira', 'د اميرة', 'staff'), row('other', 'أميرة أخرى', 'staff'),
      { ...row('amira', 'د اميرة', 'staff_account'), accountId: 'login-ambiguous' },
      { ...row('other', 'أميرة أخرى', 'staff_account'), accountId: 'login-ambiguous' },
    ];
    expect(canonicalStaffFromReference('login-ambiguous', rows)).toBeNull();
  });
});
