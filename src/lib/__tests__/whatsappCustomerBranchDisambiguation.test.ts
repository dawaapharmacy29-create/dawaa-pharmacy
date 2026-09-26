import { describe, expect, it, vi } from 'vitest';

const CUSTOMERS = [
  { id: 'c1', name: 'أحمد الشامي', customer_code: 'C1', phone: '01011111111', branch: 'فرع الشامي', segment: 'vip' },
  { id: 'c2', name: 'أحمد الشامي', customer_code: 'C2', phone: '01022222222', branch: 'فرع شكري', segment: 'regular' },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      if (table !== 'customers') {
        return { select: () => ({ or: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
      }
      const chain: any = {
        select: () => chain,
        or: () => chain,
        ilike: () => chain,
        order: () => chain,
        limit: async () => ({ data: CUSTOMERS, error: null }),
      };
      return chain;
    },
  },
}));

describe('resolveWhatsAppCustomerIdentity — branch disambiguation', () => {
  it('resolves uniquely to the matching branch when two customers share the same name across branches', async () => {
    const { resolveWhatsAppCustomerIdentity } = await import('@/lib/whatsappCustomerResolverV4');
    const result = await resolveWhatsAppCustomerIdentity('أحمد الشامي', 'فرع شكري');
    expect(result.strategy).toBe('name_exact_branch');
    expect(result.customer?.id).toBe('c2');
    expect(result.customer?.branch).toBe('فرع شكري');
  });

  it('never auto-picks a record when no branch context is available and the name is ambiguous', async () => {
    const { resolveWhatsAppCustomerIdentity } = await import('@/lib/whatsappCustomerResolverV4');
    const result = await resolveWhatsAppCustomerIdentity('أحمد الشامي', null);
    expect(result.strategy).toBe('ambiguous');
    expect(result.customer).toBeNull();
    expect(result.candidates.length).toBeGreaterThan(1);
  });
});
