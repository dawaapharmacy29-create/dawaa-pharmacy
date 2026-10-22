import { describe, expect, it } from 'vitest';
import {
  fetchInvoiceCandidates,
  type InvoiceCandidateQuery,
} from '@/lib/salesIntelligence/invoiceCandidateRetrieval';

function fakeSupabase(datasets: Record<string, any[]>, calls: Array<Record<string, any>>) {
  return {
    from(table: string) {
      if (table !== 'sales_invoices') throw new Error('unexpected table');
      let identityColumn = '';
      let identityValue = '';
      let fromIso = '';
      let toIso = '';

      const builder: any = {
        select() { return builder; },
        gte(column: string, value: string) {
          if (column === 'invoice_datetime') fromIso = value;
          return builder;
        },
        lte(column: string, value: string) {
          if (column === 'invoice_datetime') toIso = value;
          return builder;
        },
        eq(column: string, value: string) {
          identityColumn = column;
          identityValue = value;
          return builder;
        },
        limit(limit: number) {
          calls.push({ identityColumn, identityValue, fromIso, toIso, limit });
          return Promise.resolve({ data: datasets[identityColumn] || [], error: null });
        },
      };
      return builder;
    },
  };
}

describe('Invoice candidate retrieval', () => {
  it('uses separate bounded identity lookups and dedupes the merged invoices', async () => {
    const calls: Array<Record<string, any>> = [];
    const client = fakeSupabase({
      customer_code: [
        { id: 'row-code', invoice_number: '099', invoice_datetime: '2026-09-20T09:55:00Z' },
      ],
      customer_id: [
        { id: 'row-a', invoice_number: '100', invoice_datetime: '2026-09-20T10:00:00Z' },
      ],
      customer_phone: [
        { id: 'row-a', invoice_number: '100', invoice_datetime: '2026-09-20T10:00:00Z' },
        { id: 'row-b', invoice_number: '101', invoice_datetime: '2026-09-20T11:00:00Z' },
      ],
      whatsapp_phone: [
        { id: 'row-b', invoice_number: '101', invoice_datetime: '2026-09-20T11:00:00Z' },
        { id: 'row-c', invoice_number: '102', invoice_datetime: '2026-09-20T12:00:00Z' },
      ],
    }, calls);

    const query: InvoiceCandidateQuery = {
      caseId: 'case-1',
      customerId: 'cust-1',
      customerPhoneNormalized: '01012345678',
      customerCodeNormalized: '2490',
      customerNameRaw: 'الحاج محمود صالح',
      branchNameRaw: 'فرع شكري',
      windowStartIso: '2026-09-19T00:00:00.000Z',
      windowEndIso: '2026-09-27T00:00:00.000Z',
      limit: 200,
    };

    const rows = await fetchInvoiceCandidates(client, query);

    expect(calls.map((call) => call.identityColumn)).toEqual([
      'customer_code',
      'customer_id',
      'customer_phone',
      'whatsapp_phone',
    ]);
    expect(calls[0].identityValue).toBe('2490');
    expect(calls.every((call) =>
      call.fromIso === query.windowStartIso &&
      call.toIso === query.windowEndIso &&
      call.limit === query.limit
    )).toBe(true);
    expect(rows.map((row: any) => row.id)).toEqual(['row-code', 'row-a', 'row-b', 'row-c']);
  });

  it('can retrieve by pharmacy customer code even when id and phone are unavailable', async () => {
    const calls: Array<Record<string, any>> = [];
    const client = fakeSupabase({
      customer_code: [{ id: 'row-code-only', invoice_number: '74966', invoice_datetime: '2026-09-28T03:56:00Z' }],
    }, calls);
    const rows = await fetchInvoiceCandidates(client, {
      caseId: 'case-code-only',
      customerId: null,
      customerPhoneNormalized: null,
      customerCodeNormalized: '2490',
      customerNameRaw: 'الحاج محمود صالح',
      branchNameRaw: 'فرع شكري',
      windowStartIso: '2026-09-28T03:00:00.000Z',
      windowEndIso: '2026-09-28T05:00:00.000Z',
      limit: 200,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ identityColumn: 'customer_code', identityValue: '2490' });
    expect(rows.map((row: any) => row.id)).toEqual(['row-code-only']);
  });

  it('never queries the invoice table when no resolved identity exists', async () => {
    const calls: Array<Record<string, any>> = [];
    const client = fakeSupabase({}, calls);
    const rows = await fetchInvoiceCandidates(client, {
      caseId: 'case-no-id',
      customerId: null,
      customerPhoneNormalized: null,
      branchNameRaw: null,
      windowStartIso: '2026-09-19T00:00:00.000Z',
      windowEndIso: '2026-09-27T00:00:00.000Z',
      limit: 200,
    });

    expect(rows).toEqual([]);
    expect(calls).toEqual([]);
  });
});

function query(overrides: Partial<InvoiceCandidateQuery> = {}): InvoiceCandidateQuery {
  return {
    caseId: 'case-1',
    customerId: 'customer-1',
    customerPhoneNormalized: null,
    customerCodeNormalized: null,
    customerNameRaw: null,
    branchNameRaw: null,
    windowStartIso: '2026-09-01T00:00:00.000Z',
    windowEndIso: '2026-09-10T00:00:00.000Z',
    limit: 3,
    ...overrides,
  };
}

function invoiceClient(rowsByIdentity: Record<string, Array<Record<string, unknown>>>) {
  return {
    from() {
      const builder: any = {
        select() { return builder; },
        gte() { return builder; },
        lte() { return builder; },
        eq(column: string, value: string) {
          builder.column = column;
          builder.value = value;
          return builder;
        },
        async limit(limit: number) {
          const rows = rowsByIdentity[`${builder.column}:${builder.value}`] ?? [];
          return { data: rows.slice(0, limit), error: null };
        },
      };
      return builder;
    },
  };
}

describe('invoice candidate retrieval completeness', () => {
  it('marks a single identity lookup at the row cap as incomplete', async () => {
    const result = await fetchInvoiceCandidates(invoiceClient({
      'customer_code:18663': [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    }), query({ customerId: null, customerCodeNormalized: '18663' }));

    expect(result).toHaveLength(3);
    expect(result.candidatePoolComplete).toBe(false);
  });

  it('marks a merged identity pool over the cap as incomplete instead of claiming uniqueness', async () => {
    const result = await fetchInvoiceCandidates(invoiceClient({
      'customer_code:18663': [{ id: 'a' }, { id: 'b' }],
      'customer_id:customer-1': [{ id: 'c' }, { id: 'd' }],
    }), query({ customerCodeNormalized: '18663' }));

    expect(result).toHaveLength(3);
    expect(result.candidatePoolComplete).toBe(false);
  });

  it('marks an under-cap deduplicated identity pool complete', async () => {
    const shared = { id: 'same-invoice' };
    const result = await fetchInvoiceCandidates(invoiceClient({
      'customer_code:18663': [shared],
      'customer_id:customer-1': [shared],
    }), query({ customerCodeNormalized: '18663' }));

    expect(result).toHaveLength(1);
    expect(result.candidatePoolComplete).toBe(true);
  });
});
