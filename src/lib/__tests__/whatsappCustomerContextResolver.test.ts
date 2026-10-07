import { describe, expect, it, vi } from 'vitest';
import type { WhatsAppConversationSession, WhatsAppParsedMessage } from '@/lib/whatsappConversationParser';

const CUSTOMERS = [
  { id: 'c1', name: 'أحمد الشامي', display_name: 'أحمد الشامي', customer_code: '18', code: null, effective_customer_code: '18', phone: '01011111111', normalized_phone: '01011111111', branch: 'فرع الشامي', is_duplicate: false, total_purchases: 12, total_spent: 4500, avg_monthly: 375, last_purchase: '2026-09-01' },
  { id: 'c2', name: 'أحمد الشامي', display_name: 'أحمد الشامي', customer_code: '19', code: null, effective_customer_code: '19', phone: '01022222222', normalized_phone: '01022222222', branch: 'فرع شكري', is_duplicate: false, total_purchases: 3, total_spent: 600, avg_monthly: 50, last_purchase: '2026-08-15' },
  // A1 fixture shape: customer_code 17 (canonical) while legacy `code` and display name carry 13204.
  { id: '17fd9821-05c2-4ebb-93dd-38f202611a52', name: 'د معاذ ش 13204', display_name: 'د معاذ ش 13204', customer_name: 'د معاذ مزروع', customer_code: '17', code: '13204', effective_customer_code: '17', phone: '01099767693', normalized_phone: '01099767693', branch: 'فرع شكري', effective_branch: 'فرع شكري', is_duplicate: false, total_purchases: 5, total_spent: 900, avg_monthly: 80, last_purchase: '2026-09-20' },
];

// Minimal PostgREST-like stub for the canonical resolver's bounded batch queries.
function customersQuery() {
  let rows = CUSTOMERS.slice();
  const chain: any = {
    select: () => chain,
    in: (column: string, values: string[]) => {
      rows = rows.filter((row: any) => values.includes(String(row[column])));
      return chain;
    },
    or: (filter: string) => {
      const values = new Set((filter.match(/\(([^)]*)\)/g) || []).flatMap((group) => group.slice(1, -1).split(',')));
      rows = rows.filter((row: any) => Object.values(row).some((value) => values.has(String(value))));
      return chain;
    },
    eq: (column: string, value: unknown) => {
      rows = rows.filter((row: any) => row[column] === value);
      return chain;
    },
    limit: () => chain,
    maybeSingle: async () => ({ data: rows[0] || null, error: null }),
    then: (resolve: (value: unknown) => void) => resolve({ data: rows, error: null }),
  };
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      if (table === 'customers') return customersQuery();
      const empty: any = { select: () => empty, in: () => empty, then: (resolve: any) => resolve({ data: [], error: null }) };
      return empty;
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

describe('resolveCanonicalCustomerContexts (canonical identity only)', () => {
  it('resolves by the contact phone through the canonical resolver', async () => {
    const { resolveCanonicalCustomerContexts } = await import('@/lib/whatsappCustomerContextResolver');
    const s = session([msg('m1', '2026-09-01T10:00:00', 'inbound', 'اتصل بيا على 01022222222')], 'أحمد الشامي');
    s.messages[0].sender = '01022222222';
    const [result] = await resolveCanonicalCustomerContexts([s], 'WhatsApp Chat with أحمد الشامي.txt');
    expect(result.canonical.status).toBe('resolved');
    expect(result.resolution.strategy).toBe('phone_exact');
    expect(result.resolution.customer?.id).toBe('c2');
  });

  it('A1: code 17 in the filename resolves the official customer; the filename name stays display-only', async () => {
    const { resolveCanonicalCustomerContexts } = await import('@/lib/whatsappCustomerContextResolver');
    const s = session([msg('m1', '2026-10-06T09:00:00', 'inbound', 'جاست ريج أمبول')], 'معاذ مزروع');
    const [result] = await resolveCanonicalCustomerContexts([s], 'WhatsApp Chat with معاذ مزروع - 17.txt');
    expect(result.canonical.status).toBe('resolved');
    expect(result.canonical.resolvedBy).toBe('customer_code');
    expect(result.resolution.customer?.id).toBe('17fd9821-05c2-4ebb-93dd-38f202611a52');
    expect(result.canonical.customerCode).toBe('17');
    expect(result.displayNameHint).toBe('معاذ مزروع');
    expect(result.purchaseHistory).toEqual({ totalPurchases: 5, totalSpent: 900, avgMonthly: 80, lastPurchaseAt: '2026-09-20' });
  });

  it('a display name alone never resolves an identity (fail closed, no purchase history)', async () => {
    const { resolveCanonicalCustomerContexts } = await import('@/lib/whatsappCustomerContextResolver');
    const s = session([msg('m1', '2026-09-01T10:00:00', 'inbound', 'محتاج استفسار')], 'أحمد الشامي');
    const [result] = await resolveCanonicalCustomerContexts([s], 'WhatsApp Chat with أحمد الشامي.txt');
    expect(result.canonical.status).not.toBe('resolved');
    expect(result.resolution.customer).toBeNull();
    expect(result.purchaseHistory).toBeNull();
  });
});
