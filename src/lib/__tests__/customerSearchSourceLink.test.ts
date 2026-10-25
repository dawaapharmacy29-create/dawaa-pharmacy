import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal in-memory Supabase for customer creation followed by WhatsApp source linking.
type Row = Record<string, any>;
const state: { tables: Record<string, Row[]>; failSourceRead: boolean } = { tables: {}, failSourceRead: false };

function from(table: string) {
  const filters: Array<(row: Row) => boolean> = [];
  let patch: Row | null = null;
  let inserted: Row | null = null;
  const rows = () => (state.tables[table] ??= []).filter((row) => filters.every((f) => f(row)));
  const builder: any = {
    select: () => builder,
    limit: () => builder,
    order: () => builder,
    eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return builder; },
    is: (key: string, value: unknown) => { filters.push((row) => (row[key] ?? null) === value); return builder; },
    not: (key: string) => { filters.push((row) => row[key] != null); return builder; },
    in: (key: string, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return builder; },
    or: () => builder,
    insert: (row: Row) => { inserted = { id: `${table}-${(state.tables[table] ??= []).length + 1}`, ...row }; state.tables[table].push(inserted); return builder; },
    update: (next: Row) => { patch = next; return builder; },
    single: async () => ({ data: inserted, error: null }),
    maybeSingle: async () => {
      const target = rows()[0];
      if (patch && target) { Object.assign(target, patch); return { data: { id: target.id }, error: null }; }
      return { data: target ?? null, error: null };
    },
    then: (resolve: (value: unknown) => void) =>
      resolve(state.failSourceRead && table === 'whatsapp_review_sources'
        ? { data: null, error: { message: 'read failed' } }
        : { data: inserted ? null : rows(), error: null }),
  };
  return builder;
}
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => from(table), rpc: async () => ({ data: null, error: null }) } }));

import { createCustomerFromSearch } from '../customerSearch';

describe('createCustomerFromSearch → earlier WhatsApp sources', () => {
  beforeEach(() => {
    state.failSourceRead = false;
    state.tables = {
      customers: [{ id: 'cust-18663', customer_code: '18663', name: 'عميل سابق', is_duplicate: false }],
      customer_aliases: [],
      whatsapp_review_sources: [{ id: 'src-1', customer_id: null, customer_code: '18663', customer_name: 'عميل', customer_phone: null }],
      whatsapp_review_audit: [],
    };
  });

  it('adding an unrelated customer links the source of the customer that already existed, with audit and a visible note', async () => {
    const created = await createCustomerFromSearch({ name: 'عميل جديد', phone: '01000000000', code: '55555' });
    expect(created.name).toBe('عميل جديد');
    expect(state.tables.whatsapp_review_sources[0].customer_id).toBe('cust-18663');
    expect(state.tables.whatsapp_review_audit).toHaveLength(1);
    expect(created.sourceLinkFailed).toBe(false);
    expect(created.sourceLinkNote).toContain('تم ربط');
  });

  it('a failed link step never fails or hides behind the saved customer: it is returned for the screen to show', async () => {
    state.failSourceRead = true;
    const created = await createCustomerFromSearch({ name: 'عميل جديد', phone: '01000000000', code: '55555' });
    expect(created.id).toBeTruthy();
    expect(created.sourceLinkFailed).toBe(true);
    expect(created.sourceLinkNote).toContain('تعذر فحص محادثات واتساب السابقة');
    expect(state.tables.whatsapp_review_sources[0].customer_id).toBeNull();
  });
});
