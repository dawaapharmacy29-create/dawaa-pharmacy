import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  calls: [] as Array<{ column: string; values: string[]; limit: number }>,
  rows: [] as Array<Record<string, unknown>>,
  fail: false,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      if (table !== 'customers') throw new Error(`unexpected table ${table}`);
      return {
        select() {
          return {
            in(column: string, values: string[]) {
              return {
                async limit(limit: number) {
                  transport.calls.push({ column, values, limit });
                  if (transport.fail) return { data: null, error: { message: 'synthetic_outage' } };
                  return {
                    data: transport.rows.filter((row) => values.includes(String(row[column]))),
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  },
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('customer display profile enrichment is batched', () => {
  beforeEach(() => {
    vi.resetModules();
    transport.calls = [];
    transport.rows = [];
    transport.fail = false;
  });

  it('loads a rendered page of 25 customers with one query and keeps per-customer results', async () => {
    const { loadCustomerDisplayProfile } = await import('../customerDisplay');
    transport.rows = Array.from({ length: 25 }, (_, i) => ({
      id: uuid(i),
      customer_notes: `note-${i}`,
    }));
    const profiles = await Promise.all(
      Array.from({ length: 25 }, (_, i) => loadCustomerDisplayProfile({ customer_id: uuid(i) }))
    );
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]).toMatchObject({ column: 'id' });
    expect(profiles.map((profile) => profile?.customer_notes)).toEqual(
      Array.from({ length: 25 }, (_, i) => `note-${i}`)
    );
  });

  it('never queries composite keys of unregistered customers or non-UUID ids', async () => {
    const { loadCustomerDisplayProfile } = await import('../customerDisplay');
    expect(
      await loadCustomerDisplayProfile({ customer_code: 'name:عميل غير مسجل|branch:فرع الشامي' })
    ).toBeNull();
    expect(await loadCustomerDisplayProfile({ customer_id: 'not-a-uuid' })).toBeNull();
    expect(transport.calls).toHaveLength(0);
  });

  it('resolves code lookups to the first matching customer and misses to null', async () => {
    const { loadCustomerDisplayProfile } = await import('../customerDisplay');
    transport.rows = [
      { customer_code: '7661', customer_notes: 'first' },
      { customer_code: '7661', customer_notes: 'second' },
    ];
    const [hit, miss] = await Promise.all([
      loadCustomerDisplayProfile({ customer_code: '7661' }),
      loadCustomerDisplayProfile({ customer_code: '9999' }),
    ]);
    expect(hit?.customer_notes).toBe('first');
    expect(miss).toBeNull();
    expect(transport.calls).toEqual([
      { column: 'customer_code', values: ['7661', '9999'], limit: 20 },
    ]);
  });

  it('a failed batch leaves each row without enrichment instead of throwing', async () => {
    const { loadCustomerDisplayProfile } = await import('../customerDisplay');
    transport.fail = true;
    await expect(loadCustomerDisplayProfile({ customer_id: uuid(1) })).resolves.toBeNull();
  });

  it('bounds each query to 50 values', async () => {
    const { loadCustomerDisplayProfile } = await import('../customerDisplay');
    await Promise.all(
      Array.from({ length: 120 }, (_, i) => loadCustomerDisplayProfile({ customer_id: uuid(i) }))
    );
    expect(transport.calls.map((call) => call.values.length)).toEqual([50, 50, 20]);
  });
});
