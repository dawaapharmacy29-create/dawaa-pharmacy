import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StaffDirectoryIdentity } from '@/lib/readModels/staffDirectoryReadModel';
const state = vi.hoisted(() => ({ rows: [] as StaffDirectoryIdentity[], accounts: [] as any[], unavailable: false }));
vi.mock('@/lib/readModels/staffDirectoryReadModel', () => ({ readStaffDirectory: vi.fn(async () => {
  if (state.unavailable) throw new Error('directory unavailable');
  return state.rows;
}) }));
vi.mock('@/lib/staff/staffAccountsApi', () => ({ resolveStaffAccountSafe: async () => state.accounts }));
import { clearStaffCache, resolveCanonicalStaffIdentifier, resolveStaffBySellerName, resolveStaffLink } from '@/lib/staff/staffIdentityResolver';
const person = (id: string, name: string): StaffDirectoryIdentity => ({
  id, name, role: 'pharmacist', branch: 'شكري', active: true, username: null, status: 'active', source: 'staff',
});
beforeEach(() => { clearStaffCache(); state.rows = [person('person', 'د اسلام فاروق')]; state.accounts = []; state.unavailable = false; });
describe('stable employee IDs and fresh live name resolution', () => {
  it('does not retain a completed seller-name decision after archival', async () => {
    expect((await resolveStaffBySellerName('د اسلام فاروق'))?.id).toBe('person');
    state.rows = [{ ...state.rows[0], active: false }];
    expect(await resolveStaffBySellerName('د اسلام فاروق')).toBeNull();
  });
  it('an outage is retried instead of caching a rejected directory forever', async () => {
    state.unavailable = true;
    await expect(resolveStaffBySellerName('د اسلام فاروق')).rejects.toThrow('unavailable');
    state.unavailable = false;
    expect((await resolveStaffBySellerName('د اسلام فاروق'))?.id).toBe('person');
  });
  it('explicit historical staff IDs still identify an archived person after a rename or branch move', async () => {
    state.rows = [{ ...person('person', 'اسم تاريخي موثق'), branch: 'الشامي', active: false }];
    expect(await resolveCanonicalStaffIdentifier('person')).toMatchObject({ canonicalStaffId: 'person', source: 'staff.id' });
    expect(await resolveStaffBySellerName('اسم تاريخي موثق')).toBeNull();
  });
  it('an orphan account staff_id never becomes a canonical employee id', async () => {
    state.accounts = [{ id: 'login', username: 'old-login', staff_id: 'missing-person', active: true, can_login: true }];
    expect(await resolveCanonicalStaffIdentifier('login')).toMatchObject({ canonicalStaffId: null, staff: null });
  });
  it('a matching account display name cannot override an ambiguous person name', async () => {
    state.rows = [person('one', 'احمد محمد'), person('two', 'احمد محمد')];
    state.accounts = [{ id: 'login', username: 'someone', name: 'احمد محمد', staff_id: 'one', active: true, can_login: true }];
    expect((await resolveCanonicalStaffIdentifier('احمد محمد')).canonicalStaffId).toBeNull();
  });
  it('branch hints open team search when an alias has two distinct owners', () => {
    const rows = [
      { id: 'one', name: 'احمد محمد', branch: 'شكري', source: 'staff' as const },
      { id: 'two', name: 'احمد محمد', branch: 'الشامي', source: 'staff' as const },
    ];
    expect(resolveStaffLink('احمد محمد', 'شكري', rows).fallback).toBe(true);
  });
});
