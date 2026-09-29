import { describe, expect, it, vi } from 'vitest';
import type {
  WhatsAppConversationSession,
  WhatsAppParsedMessage,
} from '@/lib/whatsappConversationParser';
import {
  extractCustomerIdentityEvidence,
  loadCustomerIdentityCandidates,
  resolveCanonicalCustomerIdentity,
  resolveCanonicalCustomerIdentities,
  type CustomerIdentityCandidates,
  type CustomerIdentityEvidence,
} from '@/lib/customers/canonicalCustomerIdentityResolver';

// Canonical Customer Identity Resolver — one identity definition for every path.

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';
const ID_DUP = '44444444-4444-4444-8444-444444444444';

const CUSTOMERS: Array<Record<string, unknown>> = [
  {
    id: ID_A,
    customer_code: '4250',
    effective_customer_code: '4250',
    name: 'اليماني حسين حسن',
    normalized_phone: '01015438338',
    branch: 'فرع شكري',
    is_duplicate: false,
  },
  {
    id: ID_B,
    customer_code: '3643',
    effective_customer_code: '3643',
    name: 'ابراهيم الصياد',
    normalized_phone: '01028308235',
    branch: 'فرع شكري',
    is_duplicate: false,
  },
  {
    id: ID_C,
    customer_code: '5179',
    effective_customer_code: '5179',
    name: 'محمد الجندي',
    normalized_phone: '01028308235',
    branch: 'فرع شكري',
    is_duplicate: false,
  },
  {
    id: ID_DUP,
    customer_code: '9999',
    effective_customer_code: '9999',
    name: 'اليماني حسين',
    normalized_phone: '01099999999',
    branch: 'فرع شكري',
    is_duplicate: true,
  },
  // same display name as ID_A, different customer
  {
    id: '55555555-5555-4555-8555-555555555555',
    customer_code: '7777',
    effective_customer_code: '7777',
    name: 'اليماني حسين حسن',
    normalized_phone: '01055555555',
    branch: 'فرع الشامي',
    is_duplicate: false,
  },
];
const ALIASES = [{ alias_customer_id: ID_DUP, canonical_customer_id: ID_A }];

function fakeClient() {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(table);
      const chain: any = {
        select: () => chain,
        in: (column: string, values: string[]) => {
          if (table === 'customer_aliases') {
            return Promise.resolve({
              data: ALIASES.filter((row) => values.includes(row.alias_customer_id)),
              error: null,
            });
          }
          return Promise.resolve({
            data: CUSTOMERS.filter((row) => values.includes(String(row[column]))),
            error: null,
          });
        },
        or: (filter: string) => {
          const values = Array.from(filter.matchAll(/\.in\.\(([^)]*)\)/g)).flatMap((m) =>
            m[1].split(',')
          );
          chain._rows = CUSTOMERS.filter((row) =>
            ['effective_customer_code', 'customer_code', 'normalized_phone'].some((column) =>
              values.includes(String(row[column]))
            )
          );
          return chain;
        },
        limit: () => Promise.resolve({ data: chain._rows || [], error: null }),
      };
      return chain;
    },
  };
  return { client, calls };
}

function msg(
  id: string,
  sender: string,
  text: string,
  direction: 'inbound' | 'outbound' = 'inbound'
): WhatsAppParsedMessage {
  const at = '2026-09-15T06:46:45.000Z';
  return {
    id,
    timestamp: new Date(at),
    rawTimestamp: at,
    sender,
    text,
    direction,
    kind: 'text',
    forwarded: false,
    raw: text,
  } as WhatsAppParsedMessage;
}

function session(
  messages: WhatsAppParsedMessage[],
  customerName: string | null = null
): WhatsAppConversationSession {
  return {
    id: 's1',
    startedAt: messages[0].timestamp,
    endedAt: messages[messages.length - 1].timestamp,
    messages,
    participants: [],
    outboundStaffNames: [],
    customerName,
    mediaCount: 0,
  } as WhatsAppConversationSession;
}

async function resolve(evidence: Partial<CustomerIdentityEvidence>) {
  const { client } = fakeClient();
  const [identity] = await resolveCanonicalCustomerIdentities(client, [
    { customerCodes: [], contactPhones: [], mentionedPhones: [], ...evidence },
  ]);
  return identity;
}

describe('Canonical Customer Identity Resolver — evidence hierarchy', () => {
  it('1. exact customer_id resolves', async () => {
    const identity = await resolve({ customerId: ID_A });
    expect(identity).toMatchObject({
      status: 'resolved',
      customerId: ID_A,
      resolvedBy: 'customer_id',
    });
  });

  it('2. a unique customer code resolves', async () => {
    const identity = await resolve({ customerCodes: ['4250'] });
    expect(identity).toMatchObject({
      status: 'resolved',
      customerId: ID_A,
      customerCode: '4250',
      resolvedBy: 'customer_code',
    });
  });

  it('3. a phone mapped to exactly one customer resolves', async () => {
    const identity = await resolve({ contactPhones: ['01015438338'] });
    expect(identity).toMatchObject({
      status: 'resolved',
      customerId: ID_A,
      resolvedBy: 'contact_phone',
    });
  });

  it('4. a phone mapped to several customer codes is ambiguous and never guessed', async () => {
    const identity = await resolve({ contactPhones: ['01028308235'] });
    expect(identity.status).toBe('ambiguous');
    expect(identity.customerId).toBeNull();
    expect(identity.candidates.map((row) => row.id).sort()).toEqual([ID_B, ID_C].sort());
  });

  it('5. code and phone pointing at different customers is a contradiction, not a merge', async () => {
    const identity = await resolve({ customerCodes: ['4250'], contactPhones: ['01055555555'] });
    expect(identity.status).toBe('contradicted');
    expect(identity.customerId).toBeNull();
  });

  it('5b. customer_id A with phone B is a contradiction', async () => {
    const identity = await resolve({ customerId: ID_A, contactPhones: ['01055555555'] });
    expect(identity.status).toBe('contradicted');
  });

  it('5c. two different codes (filename vs contact label) are contradictory evidence', async () => {
    const identity = await resolve({ customerCodes: ['4250', '3643'] });
    expect(identity.status).toBe('contradicted');
  });

  it('a unique code resolves even when the phone is shared, if the phone includes that customer', async () => {
    const identity = await resolve({ customerCodes: ['3643'], contactPhones: ['01028308235'] });
    expect(identity).toMatchObject({
      status: 'resolved',
      customerId: ID_B,
      resolvedBy: 'customer_code',
    });
  });

  it('a duplicate customer record resolves to its canonical customer through customer_aliases', async () => {
    const identity = await resolve({ customerCodes: ['9999'] });
    expect(identity).toMatchObject({ status: 'resolved', customerId: ID_A });
  });

  it('8. missing identity stays unresolved', async () => {
    const identity = await resolve({ displayName: 'عميل' });
    expect(identity).toMatchObject({
      status: 'unresolved',
      customerId: null,
      reason: 'no_identity_evidence',
    });
  });

  it('9. customers with the same display name are never merged or picked by name', async () => {
    const identity = await resolve({ displayName: 'اليماني حسين حسن' });
    expect(identity.status).toBe('unresolved');
    expect(identity.customerId).toBeNull();
  });

  it('10. an untrusted (coarse snapshot) identity cannot override the canonical fine source identity', async () => {
    // The canonical fine source carries customer_id A; a phone merely mentioned in the text of a
    // coarse re-import (another customer's number) is weaker evidence and cannot win.
    const identity = await resolve({
      customerId: ID_A,
      mentionedPhones: [],
      trustedHistoricalCustomerId: ID_A,
    });
    expect(identity).toMatchObject({ status: 'resolved', customerId: ID_A });
    const conflicting = await resolve({ customerId: ID_A, trustedHistoricalCustomerId: ID_B });
    expect(conflicting.status).toBe('contradicted');
  });

  it('confidence is informational; status is the decision', async () => {
    const identity = await resolve({ contactPhones: ['01028308235'] });
    expect(identity.confidence).toBe(0);
    expect(identity.status).not.toBe('resolved');
  });
});

describe('Canonical Customer Identity Resolver — evidence extraction', () => {
  it('uses the export code and contact label; a phone only mentioned in text is weaker evidence', () => {
    const evidence = extractCustomerIdentityEvidence(
      session([msg('1', 'اليماني حسين حسن 4250', 'رقم اخويا 01028308235 ابعتوله')]),
      'اليماني حسين حسن 4250.zip'
    );
    expect(evidence.customerCodes).toEqual(['4250']);
    expect(evidence.contactPhones).toEqual([]);
    expect(evidence.mentionedPhones).toEqual(['01028308235']);
  });

  it('a mentioned phone is never written as the customer phone and never decides against a code', () => {
    const candidates: CustomerIdentityCandidates = {
      byId: new Map([
        [
          ID_A,
          {
            id: ID_A,
            customerCode: '4250',
            phones: ['01015438338'],
            name: 'A',
            branch: null,
            isDuplicate: false,
          },
        ],
      ]),
      aliasToCanonical: new Map(),
    };
    const identity = resolveCanonicalCustomerIdentity(
      { customerCodes: ['4250'], contactPhones: [], mentionedPhones: ['01028308235'] },
      candidates
    );
    expect(identity).toMatchObject({
      status: 'resolved',
      customerId: ID_A,
      normalizedPhone: '01015438338',
    });
  });

  it('uses the WhatsApp contact phone when the contact label is a number', () => {
    const evidence = extractCustomerIdentityEvidence(
      session([msg('1', '+20 101 543 8338', 'عايز دوا')]),
      'chat.zip'
    );
    expect(evidence.contactPhones).toEqual(['01015438338']);
  });
});

describe('Canonical Customer Identity Resolver — one identity for every path', () => {
  const file = 'اليماني حسين حسن 4250.zip';
  const unit = session(
    [msg('1', 'اليماني حسين حسن 4250', 'عايز بنادول'), msg('2', 'Pharmacy', 'متاح', 'outbound')],
    'اليماني حسين حسن'
  );

  it('6. watcher and auto-ingest evidence resolve to the same identity (same shared calls)', async () => {
    const { client } = fakeClient();
    const watcher = await resolveCanonicalCustomerIdentities(client, [
      extractCustomerIdentityEvidence(unit, file),
    ]);
    const autoIngest = await resolveCanonicalCustomerIdentities(client, [
      extractCustomerIdentityEvidence(unit, file),
    ]);
    expect(watcher).toEqual(autoIngest);
    expect(watcher[0]).toMatchObject({ status: 'resolved', customerId: ID_A });
  });

  it('7. re-import of the same conversation resolves to the same identity', async () => {
    const { client } = fakeClient();
    const first = await resolveCanonicalCustomerIdentities(client, [
      extractCustomerIdentityEvidence(unit, file),
    ]);
    const second = await resolveCanonicalCustomerIdentities(client, [
      extractCustomerIdentityEvidence(unit, `${file.replace('.zip', '')} (1).zip`),
    ]);
    expect(second[0].customerId).toBe(first[0].customerId);
  });

  it('batch loading is bounded: one query per evidence kind for many conversations', async () => {
    const { client, calls } = fakeClient();
    const evidences = Array.from({ length: 25 }, () => extractCustomerIdentityEvidence(unit, file));
    await loadCustomerIdentityCandidates(client, evidences);
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it('fails closed on a lookup error instead of reporting unresolved', async () => {
    const client = {
      from: () => {
        const chain: any = {
          select: () => chain,
          or: () => chain,
          limit: () => Promise.resolve({ data: null, error: { message: 'down' } }),
        };
        return chain;
      },
    };
    await expect(
      resolveCanonicalCustomerIdentities(client, [
        { customerCodes: ['4250'], contactPhones: [], mentionedPhones: [] },
      ])
    ).rejects.toThrow('customer_identity_code_lookup_failed');
  });
});

describe('source file uses no second identity definition', () => {
  it.each([
    'src/pages/WhatsAppSmartFolderWatcher.tsx',
    'src/lib/whatsappAutoIngestPipeline.ts',
    'src/lib/salesIntelligence/persistence/batchPersistenceService.ts',
  ])('%s resolves identity only through the canonical resolver', async (file) => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const code = fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8');
    expect(code).toContain('resolveCanonicalCustomerIdentities(');
    expect(code).not.toMatch(
      /resolveWhatsAppCustomerIdentity\(|resolveCustomerContext\(|enrichConversationIdentityHints|\.from\('customers'\)/
    );
  });
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({}) } }));
