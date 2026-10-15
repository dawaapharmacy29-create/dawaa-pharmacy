import { describe, expect, it } from 'vitest';
import { supabase } from '@/lib/supabase';
import { resolveWhatsAppCustomerIdentity } from '@/lib/whatsappCustomerResolverV4';

// Live safeguard formerly asserted (as source text) by the retired V25 governance script:
// customer identity resolution must never guess between same-name customers.
const CUSTOMERS = [
  { id: 'c1', name: 'أحمد الشامي', customer_code: 'C1', phone: '01011111111', branch: 'فرع الشامي', segment: 'vip' },
  { id: 'c2', name: 'أحمد الشامي', customer_code: 'C2', phone: '01022222222', branch: 'فرع شكري', segment: 'regular' },
];

async function withFakeCustomers<T>(run: () => Promise<T>): Promise<T> {
  const client = supabase as unknown as { from: (table: string) => unknown };
  const original = client.from;
  client.from = (table: string) => {
    const rows = table === 'customers' ? CUSTOMERS : [];
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'or', 'ilike', 'eq', 'in', 'order']) chain[method] = () => chain;
    chain.limit = async () => ({ data: rows, error: null });
    return chain;
  };
  try {
    return await run();
  } finally {
    client.from = original;
  }
}

describe('WhatsApp customer resolver — no-guess safeguard (live path)', () => {
  it('resolves uniquely only when the branch disambiguates same-name customers', async () => {
    const result = await withFakeCustomers(() => resolveWhatsAppCustomerIdentity('أحمد الشامي', 'فرع شكري'));
    expect(result.strategy).toBe('name_exact_branch');
    expect(result.customer?.id).toBe('c2');
  });

  it('never auto-picks a record when the name is ambiguous and no branch is known', async () => {
    const result = await withFakeCustomers(() => resolveWhatsAppCustomerIdentity('أحمد الشامي', null));
    expect(result.strategy).toBe('ambiguous');
    expect(result.customer).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(1);
  });
});
