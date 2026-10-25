import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
const { loadStaffDirectoryFrom } = await import('../staffDirectoryReadModel');

function clientFor(failure: 'staff' | 'accounts' | 'aliases' | null = null, counts = { staff: 1, aliases: 1 }) {
  const staff = { id: 'staff-1', name: 'د محمد شبل', active: true };
  const result = (source: string) => ({
    data: source === 'staff'
      ? Array.from({ length: counts.staff }, () => staff)
      : source === 'aliases'
        ? Array.from({ length: counts.aliases }, () => ({ staff_id: staff.id, alias_name: 'شبل', active: true }))
        : [],
    error: failure === source ? new Error(source + ' unavailable') : null,
  });
  return {
    from(table: string) {
      const source = table === 'staff' ? 'staff' : 'aliases';
      const query: any = {
        select: () => query,
        eq: () => query,
        limit: async () => result(source),
      };
      return query;
    },
    rpc: async () => result('accounts'),
  };
}

describe('complete canonical staff directory', () => {
  for (const source of ['staff', 'accounts', 'aliases'] as const) {
    it('rejects partial ' + source + ' reads instead of asserting absence or uniqueness', async () => {
      await expect(loadStaffDirectoryFrom(clientFor(source), { requireComplete: true }))
        .rejects.toThrow('staff_directory_incomplete: ' + source);
    });
  }

  it('allows a successful empty alias read, distinct from an alias outage', async () => {
    const rows = await loadStaffDirectoryFrom(clientFor(null, { staff: 1, aliases: 0 }), { requireComplete: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('staff');
  });

  it('retains approved aliases when every source is available', async () => {
    const rows = await loadStaffDirectoryFrom(clientFor(), { requireComplete: true });
    expect(rows.find((row) => row.name === 'شبل')).toMatchObject({ id: 'staff-1', source: 'alias' });
  });

  for (const counts of [{ staff: 800, aliases: 0 }, { staff: 1, aliases: 2000 }]) {
    it('refuses uniqueness at a bounded directory read cap ' + JSON.stringify(counts), async () => {
      await expect(loadStaffDirectoryFrom(clientFor(null, counts), { requireComplete: true }))
        .rejects.toThrow('staff_directory_incomplete: read_limit_reached');
    });
  }

  it('preserves the explicit compatibility reader policy outside canonical analysis', async () => {
    const rows = await loadStaffDirectoryFrom(clientFor('aliases'));
    expect(rows).toHaveLength(1);
  });
});
