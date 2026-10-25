import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  aliases: [] as Array<{ staff_id: string }>,
  staff: [] as Array<{ id: string; name: string; active: boolean; is_active: boolean }>,
  inserts: 0,
  updates: 0,
}));

vi.mock('@/lib/staffDuplicateAudit', () => ({
  normalizeStaffName: (name: string) => name.replace(/^د[\\/\\. ]*/, '').trim().replace(/[أإآ]/g, 'ا'),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      let operation: 'select' | 'insert' | 'update' = 'select';
      const query = {
        select() { return query; },
        eq() { return query; },
        limit() { return query; },
        order() { return query; },
        insert() { state.inserts += 1; operation = 'insert'; return query; },
        update() { state.updates += 1; operation = 'update'; return query; },
        maybeSingle: async () => ({
          data: operation === 'select' && table === 'staff' ? (state.staff[0] ?? null) : null,
          error: null,
        }),
        single: async () => ({ data: operation === 'insert' ? { id: 'new-alias' } : null, error: null }),
        then(resolve: (value: unknown) => unknown) {
          return Promise.resolve(resolve({
            data: table === 'staff_identity_aliases' ? state.aliases : state.staff,
            error: null,
          }));
        },
      };
      return query;
    },
  },
}));

import { confirmStaffAlias, createStaffAlias, resolveStaffNameToStaffId } from '@/lib/staffIdentityMapping';

describe('staff identity mapping fails closed', () => {
  beforeEach(() => {
    state.aliases = [];
    state.staff = [];
    state.inserts = 0;
    state.updates = 0;
  });

  it('rejects active aliases that disagree on the employee', async () => {
    state.aliases = [{ staff_id: 'one' }, { staff_id: 'two' }];
    expect(await resolveStaffNameToStaffId('د دنيا')).toBeNull();
    expect(state.inserts).toBe(0);
  });

  it('rejects an alias pointing to an inactive staff account', async () => {
    state.aliases = [{ staff_id: 'old' }];
    state.staff = [{ id: 'old', name: 'د دنيا', active: false, is_active: false }];
    expect(await resolveStaffNameToStaffId('د دنيا')).toBeNull();
  });

  it('rejects ambiguous normalized active names', async () => {
    state.staff = [
      { id: 'one', name: 'د دنيا', active: true, is_active: true },
      { id: 'two', name: 'د/ دنيا', active: true, is_active: true },
    ];
    expect(await resolveStaffNameToStaffId('د دنيا')).toBeNull();
  });

  it('resolves an unambiguous active normalized name', async () => {
    state.staff = [{ id: 'only', name: 'د دنيا', active: true, is_active: true }];
    expect(await resolveStaffNameToStaffId('د دنيا')).toBe('only');
  });

  it('never creates a second active staff owner for a normalized alias', async () => {
    state.aliases = [{ staff_id: 'courier-islam' }];
    state.staff = [{ id: 'doctor-islam', name: 'د اسلام فاروق', active: true, is_active: true }];
    expect(await createStaffAlias('doctor-islam', 'د اسلام', 'manual', 1, 'manager')).toBeNull();
    expect(state.inserts).toBe(0);
  });

  it('never creates aliases against a retired employee identity', async () => {
    state.staff = [{ id: 'old', name: 'د دنيا', active: false, is_active: false }];
    expect(await createStaffAlias('old', 'د دنيا', 'manual', 1, 'manager')).toBeNull();
    expect(state.inserts).toBe(0);
  });

  it('allows a new alias only when the target is active and no alias owns the key', async () => {
    state.staff = [{ id: 'doctor', name: 'د اسلام فاروق', active: true, is_active: true }];
    expect(await createStaffAlias('doctor', 'د اسلام فاروق', 'manual', 1, 'manager')).not.toBeNull();
    expect(state.inserts).toBe(1);
  });

  it('does not deactivate aliases when reassignment is requested', async () => {
    state.aliases = [{ staff_id: 'old' }];
    expect(await confirmStaffAlias('new', 'د دنيا', 'manager')).toBe(false);
    expect(state.updates).toBe(0);
    expect(state.inserts).toBe(0);
  });
});
