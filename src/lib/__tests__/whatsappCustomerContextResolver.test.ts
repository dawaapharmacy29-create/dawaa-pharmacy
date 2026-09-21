import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';

const CUSTOMERS = [
  { id: 'c1', name: 'أحمد الشامي', customer_code: 'C1', phone: '01011111111', branch: 'فرع الشامي', segment: 'vip', total_purchases: 12, total_spent: 4500, avg_monthly: 375, last_purchase: '2026-09-01' },
  { id: 'c2', name: 'أحمد الشامي', customer_code: 'C2', phone: '01022222222', branch: 'فرع شكري', segment: 'regular', total_purchases: 3, total_spent: 600, avg_monthly: 50, last_purchase: '2026-08-15' },
];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      if (table !== 'customers') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
      const chain: any = {
        _isPurchaseHistoryQuery: false,
        select: (fields: string) => {
          chain._isPurchaseHistoryQuery = fields.includes('total_purchases');
          return chain;
        },
        or: () => chain,
        ilike: () => chain,
        order: () => chain,
        eq: (field: string, value: unknown) => {
          chain._eqField = field;
          chain._eqValue = value;
          return chain;
        },
        limit: async () => ({ data: CUSTOMERS, error: null }),
        maybeSingle: async () => {
          const row = CUSTOMERS.find((c) => c.id === chain._eqValue);
          return { data: row || null, error: null };
        },
      };
      return chain;
    },
  },
}));

function msg(id: string, at: string, direction: 'inbound' | 'outbound', text: string): WhatsAppParsedMessage {
  return { id, timestamp: new Date(at), rawTimestamp: at, sender: direction === 'inbound' ? 'عميل' : 'staff', text, direction, kind: 'text', forwarded: false, raw: text };
}

function session(messages: WhatsAppParsedMessage[], customerName: string | null = 'أحمد الشامي'): WhatsAppConversationSession {
  return {
    id: 's1', startedAt: messages[0].timestamp, endedAt: messages[messages.length - 1].timestamp,
    messages, participants: ['عميل', 'staff'], outboundStaffNames: [], customerName, mediaCount: 0,
  };
}

describe('extractPhoneCandidate', () => {
  it('finds a valid Egyptian mobile number mentioned in the conversation', async () => {
    const { extractPhoneCandidate } = await import('@/lib/whatsappCustomerContextResolver');
    const s = session([msg('m1', '2026-09-01T10:00:00', 'inbound', 'رقمي 01011111111 لو حبيت تتواصل')]);
    expect(extractPhoneCandidate(s)).toBe('01011111111');
  });

  it('ignores numbers that are not a plausible Egyptian mobile', async () => {
    const { extractPhoneCandidate } = await import('@/lib/whatsappCustomerContextResolver');
    const s = session([msg('m1', '2026-09-01T10:00:00', 'inbound', 'الفاتورة رقم 123456 والمبلغ 250 جنيه')]);
    expect(extractPhoneCandidate(s)).toBeNull();
  });
});

describe('resolveCustomerContext', () => {
  it('resolves by phone when a valid number is found in the chat', async () => {
    const { resolveCustomerContext } = await import('@/lib/whatsappCustomerContextResolver');
    const s = session([msg('m1', '2026-09-01T10:00:00', 'inbound', 'اتصل بيا على 01022222222')], 'أحمد الشامي');
    const result = await resolveCustomerContext(s, null);
    expect(result.phoneCandidate).toBe('01022222222');
    expect(result.resolution.strategy).toBe('phone_exact');
    expect(result.resolution.customer?.id).toBe('c2');
  });

  it('resolves by name + branch when no phone is present', async () => {
    const { resolveCustomerContext } = await import('@/lib/whatsappCustomerContextResolver');
    const s = session([msg('m1', '2026-09-01T10:00:00', 'inbound', 'محتاج استفسار')], 'أحمد الشامي');
    const result = await resolveCustomerContext(s, 'فرع شكري');
    expect(result.resolution.strategy).toBe('name_exact_branch');
    expect(result.resolution.customer?.id).toBe('c2');
  });

  it('stays ambiguous (no auto-pick) for a duplicate name with no branch or phone, and skips purchase history', async () => {
    const { resolveCustomerContext } = await import('@/lib/whatsappCustomerContextResolver');
    const s = session([msg('m1', '2026-09-01T10:00:00', 'inbound', 'محتاج استفسار')], 'أحمد الشامي');
    const result = await resolveCustomerContext(s, null);
    expect(result.resolution.strategy).toBe('ambiguous');
    expect(result.resolution.customer).toBeNull();
    expect(result.resolution.candidates.length).toBeGreaterThan(1);
    expect(result.purchaseHistory).toBeNull();
  });

  it('fetches purchase history only once a specific customer is confidently resolved', async () => {
    const { resolveCustomerContext } = await import('@/lib/whatsappCustomerContextResolver');
    const s = session([msg('m1', '2026-09-01T10:00:00', 'inbound', 'محتاج استفسار')], 'أحمد الشامي');
    const result = await resolveCustomerContext(s, 'فرع الشامي');
    expect(result.resolution.customer?.id).toBe('c1');
    expect(result.purchaseHistory).toEqual({ totalPurchases: 12, totalSpent: 4500, avgMonthly: 375, lastPurchaseAt: '2026-09-01' });
  });
});
